import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetConfig } from "../../src/config.js";
import { flushCommitBuffer } from "../../src/services/commit.js";
import type { UncommittedRow } from "../../src/services/db.js";
import type { AppInstance } from "../../src/types.js";

interface MockFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

interface CommitBatchBody {
  items: unknown[];
}

type MockFetchInput = string;
type MockFetchInit = { body?: unknown };

function getCommitBatchBodyFromCall(
  calls: Array<[MockFetchInput, MockFetchInit?]>,
  callIndex: number
): CommitBatchBody {
  const body = calls[callIndex]?.[1]?.body;
  return JSON.parse(typeof body === "string" ? body : "") as CommitBatchBody;
}

function makeRow(
  id: number,
  batchId = "batch-1",
  attempts = 0
): UncommittedRow {
  return {
    id,
    jti: `jti-${id}`,
    batchId,
    pubkey: "pk",
    sha256: `sha-${id}`,
    size: 100 + id,
    type: "image/jpeg",
    url: `https://cdn.test/${id}`,
    attempts,
    nextRetryAt: 0,
    status: "pending",
    lastError: null,
    failedAt: null,
    created: 1,
    updated: 1,
  };
}

function makeApp(rows: UncommittedRow[]): {
  app: AppInstance;
  markUncommittedSuccess: ReturnType<typeof vi.fn>;
  markUncommittedFailure: ReturnType<typeof vi.fn>;
  markUncommittedDeadLetter: ReturnType<typeof vi.fn>;
  listRetryableUncommitted: ReturnType<typeof vi.fn>;
} {
  const listRetryableUncommitted = vi
    .fn()
    .mockReturnValueOnce(rows)
    .mockReturnValueOnce([]);
  const markUncommittedSuccess = vi.fn();
  const markUncommittedFailure = vi.fn();
  const markUncommittedDeadLetter = vi.fn();
  return {
    app: {
      db: {
        listRetryableUncommitted,
        markUncommittedSuccess,
        markUncommittedFailure,
        markUncommittedDeadLetter,
      },
    } as unknown as AppInstance,
    markUncommittedSuccess,
    markUncommittedFailure,
    markUncommittedDeadLetter,
    listRetryableUncommitted,
  };
}

describe("commit reconciliation chunking", () => {
  const fetchMock =
    vi.fn<
      (
        input: MockFetchInput,
        init?: MockFetchInit
      ) => Promise<MockFetchResponse>
    >();

  beforeEach(() => {
    vi.unstubAllEnvs();
    process.env["DB_PATH"] = "/tmp";
    process.env["R2_BUCKET"] = "bucket";
    process.env["R2_ENDPOINT"] = "https://r2.example";
    process.env["R2_ACCESS_KEY_ID"] = "key";
    process.env["R2_SECRET_ACCESS_KEY"] = "secret";
    process.env["SFS_UPLOAD_TOKEN_SECRET"] = "upload-secret";
    process.env["SFS_INTERNAL_SECRET"] = "internal-secret";
    process.env["SFS_COMMIT_BATCH_URL"] = "https://smartflow.example/commit";
    process.env["SFS_COMMIT_BATCH_SIZE"] = "2";
    process.env["SFS_COMMIT_MAX_ATTEMPTS"] = "3";
    resetConfig();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends reconciliation in commitBatchSize chunks per batchId", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ statuses: [] }),
    });
    const rows = [makeRow(1), makeRow(2), makeRow(3), makeRow(4), makeRow(5)];
    const {
      app,
      markUncommittedSuccess,
      markUncommittedFailure,
      markUncommittedDeadLetter,
    } = makeApp(rows);

    await flushCommitBuffer(app);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const calls = fetchMock.mock.calls as Array<
      [MockFetchInput, MockFetchInit?]
    >;
    const firstBody = getCommitBatchBodyFromCall(calls, 0);
    const secondBody = getCommitBatchBodyFromCall(calls, 1);
    const thirdBody = getCommitBatchBodyFromCall(calls, 2);
    expect(firstBody.items).toHaveLength(2);
    expect(secondBody.items).toHaveLength(2);
    expect(thirdBody.items).toHaveLength(1);
    expect(markUncommittedSuccess).toHaveBeenCalledTimes(5);
    expect(markUncommittedFailure).not.toHaveBeenCalled();
    expect(markUncommittedDeadLetter).not.toHaveBeenCalled();
  });

  it("marks only failed JTIs in a partially failed chunk", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            statuses: [{ jti: "jti-2", status: "failed" }],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ statuses: [] }),
      });
    const {
      app,
      markUncommittedSuccess,
      markUncommittedFailure,
      markUncommittedDeadLetter,
    } = makeApp([makeRow(1), makeRow(2), makeRow(3)]);

    await flushCommitBuffer(app);

    expect(markUncommittedSuccess).toHaveBeenCalledTimes(2);
    expect(markUncommittedSuccess).toHaveBeenCalledWith(1);
    expect(markUncommittedSuccess).toHaveBeenCalledWith(3);
    expect(markUncommittedFailure).toHaveBeenCalledTimes(1);
    expect(markUncommittedFailure.mock.calls[0]?.[0]).toBe(2);
    expect(markUncommittedDeadLetter).not.toHaveBeenCalled();
  });

  it("marks all rows in a failed chunk for retry", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ statuses: [] }),
      });
    const {
      app,
      markUncommittedSuccess,
      markUncommittedFailure,
      markUncommittedDeadLetter,
    } = makeApp([makeRow(1), makeRow(2), makeRow(3)]);

    await flushCommitBuffer(app);

    expect(markUncommittedFailure).toHaveBeenCalledTimes(2);
    expect(markUncommittedFailure.mock.calls[0]?.[0]).toBe(1);
    expect(markUncommittedFailure.mock.calls[1]?.[0]).toBe(2);
    expect(markUncommittedSuccess).toHaveBeenCalledTimes(1);
    expect(markUncommittedSuccess).toHaveBeenCalledWith(3);
    expect(markUncommittedDeadLetter).not.toHaveBeenCalled();
  });

  it("moves commits to dead-letter when max attempts is reached", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });
    const { app, markUncommittedFailure, markUncommittedDeadLetter } = makeApp([
      makeRow(1, "batch-1", 2),
    ]);

    await flushCommitBuffer(app);

    expect(markUncommittedDeadLetter).toHaveBeenCalledTimes(1);
    expect(markUncommittedDeadLetter).toHaveBeenCalledWith(
      1,
      "upstream_request_failed"
    );
    expect(markUncommittedFailure).not.toHaveBeenCalled();
  });
});
