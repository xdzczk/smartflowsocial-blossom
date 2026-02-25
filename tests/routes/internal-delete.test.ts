import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetConfig } from "../../src/config.js";
import internalDeleteRoute from "../../src/routes/internal-delete.js";
import type { AppRequest } from "../../src/types.js";

const deleteObjectMock = vi.fn();
vi.mock("../../src/services/storage.js", () => ({
  deleteObject: (key: string) => deleteObjectMock(key),
}));

function createReq(secret?: string): AppRequest {
  return {
    params: { key: "abc.jpg" },
    headers: secret ? { "x-internal-secret": secret } : {},
    app: {
      db: {
        deleteBlobByKey: vi.fn(),
      },
    },
  } as unknown as AppRequest;
}

function createRes() {
  return {
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

describe("DELETE /internal/blob/:key", () => {
  beforeEach(() => {
    process.env["SFS_UPLOAD_TOKEN_SECRET"] = "test-token-secret";
    process.env["SFS_INTERNAL_SECRET"] = "test-internal-secret";
    resetConfig();
    deleteObjectMock.mockReset().mockResolvedValue(undefined);
  });

  it("rejects invalid secret", async () => {
    const req = createReq("bad-secret");
    await expect(
      internalDeleteRoute(req, createRes() as never)
    ).rejects.toMatchObject({
      code: 401,
    });
  });

  it("deletes object for valid secret", async () => {
    const req = createReq("test-internal-secret");
    const res = createRes();
    await internalDeleteRoute(req, res as never);
    expect(deleteObjectMock).toHaveBeenCalledWith("abc.jpg");
    expect(req.app.db.deleteBlobByKey).toHaveBeenCalledWith("abc.jpg");
    expect(res.statusCode).toBe(200);
  });
});
