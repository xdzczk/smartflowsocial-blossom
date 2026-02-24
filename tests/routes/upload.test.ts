import { beforeEach, describe, expect, it, vi } from "vitest";

import uploadRoute from "../../src/routes/upload.js";
import type { AppRequest } from "../../src/types.js";

const verifySubscriptionMock = vi.fn();
vi.mock("../../src/services/subscription.js", () => ({
  verifySubscription: (pubkey: string) => verifySubscriptionMock(pubkey),
}));

function mockRes() {
  const res = {
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(obj: unknown) {
      this.body = obj;
      return this;
    },
  };
  return res;
}

function createReq(
  overrides: Partial<{
    blossom: { verb: string; auth: { pubkey: string; tags: string[][] } };
    app: {
      db: { createBlob: (p: unknown) => { key: string; created: number } };
    };
    headers: Record<string, string>;
    pipe: (dest: unknown) => void;
  }> = {}
): AppRequest {
  const createBlobMock = vi.fn().mockReturnValue({ key: "k", created: 1 });
  return {
    blossom: {
      verb: "upload",
      auth: {
        pubkey: "pk",
        tags: [
          ["x", "abc123"],
          ["name", "x.jpg"],
        ],
      },
    },
    app: { db: { createBlob: createBlobMock } },
    headers: { "content-type": "image/jpeg" },
    pipe: vi.fn(),
    ...overrides,
  } as unknown as AppRequest;
}

describe("PUT /upload", () => {
  beforeEach(() => {
    verifySubscriptionMock.mockReset();
    vi.unstubAllEnvs();
  });

  it("throws 401 when verb is not upload", async () => {
    const req = createReq({
      blossom: { verb: "delete", auth: { pubkey: "p", tags: [["x", "h"]] } },
    });
    const res = mockRes();
    await expect(uploadRoute(req, res as never)).rejects.toMatchObject({
      message: "Expected t tag value 'upload'",
      code: 401,
    });
    expect(verifySubscriptionMock).not.toHaveBeenCalled();
  });

  it("throws 403 when subscription is inactive", async () => {
    verifySubscriptionMock.mockResolvedValue(false);
    const req = createReq();
    const res = mockRes();
    await expect(uploadRoute(req, res as never)).rejects.toMatchObject({
      message: "Subscription required",
      code: 403,
    });
    expect(verifySubscriptionMock).toHaveBeenCalledWith("pk");
  });

  it("throws 401 when x tag is missing", async () => {
    verifySubscriptionMock.mockResolvedValue(true);
    const req = createReq({
      blossom: {
        verb: "upload",
        auth: { pubkey: "p", tags: [["name", "x.jpg"]] },
      },
    });
    const res = mockRes();
    const err = await uploadRoute(req, res as never).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 401 });
    expect((err as { message: string }).message).toContain("x tag");
  });

  it("throws 401 when x tag is duplicated", async () => {
    verifySubscriptionMock.mockResolvedValue(true);
    const req = createReq({
      blossom: {
        verb: "upload",
        auth: {
          pubkey: "p",
          tags: [
            ["x", "h1"],
            ["x", "h2"],
          ],
        },
      },
    });
    const res = mockRes();
    await expect(uploadRoute(req, res as never)).rejects.toMatchObject({
      message: "Duplicate x tag",
      code: 401,
    });
  });
});
