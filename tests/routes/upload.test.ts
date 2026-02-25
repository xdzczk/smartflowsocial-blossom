import { beforeEach, describe, expect, it, vi } from "vitest";

import uploadRoute from "../../src/routes/upload.js";
import type { AppRequest } from "../../src/types.js";

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
    vi.unstubAllEnvs();
    process.env["SFS_UPLOAD_TOKEN_SECRET"] = "test-secret";
    process.env["SFS_COMPAT_MODE_ENABLED"] = "true";
  });

  it("throws 401 when token and Blossom auth are both missing", async () => {
    const req = createReq();
    const res = mockRes();
    await expect(uploadRoute(req, res as never)).rejects.toMatchObject({
      code: 401,
      error: "invalid_auth",
    });
  });

  it("throws 401 when upload token is malformed", async () => {
    const req = createReq({
      headers: {
        "content-type": "image/jpeg",
        "x-sfs-upload-token": "not.a.valid.jwt",
      },
    });
    const res = mockRes();
    await expect(uploadRoute(req, res as never)).rejects.toMatchObject({
      code: 401,
      error: "invalid_token",
    });
  });

  it("does not downgrade malformed token into compat mode", async () => {
    const req = createReq({
      headers: {
        "content-type": "image/jpeg",
        "x-sfs-upload-token": "not.a.valid.jwt",
        authorization: "Nostr any",
      },
    });
    const res = mockRes();
    await expect(uploadRoute(req, res as never)).rejects.toMatchObject({
      code: 401,
      error: "invalid_token",
    });
  });

  it("throws 401 when compat auth header is invalid", async () => {
    const req = createReq({
      headers: {
        "content-type": "image/jpeg",
        authorization: "Nostr bad-base64",
      },
    });
    const res = mockRes();
    await expect(uploadRoute(req, res as never)).rejects.toMatchObject({
      code: 401,
      error: "invalid_auth",
    });
  });
});
