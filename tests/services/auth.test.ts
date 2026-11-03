import { beforeEach, describe, it, expect, vi } from "vitest";

import { ApiError } from "../../src/errors.js";
import { resetConfig } from "../../src/config.js";
import authMiddleware from "../../src/services/auth.js";
import type { AppRequest } from "../../src/types.js";

const verifyEventMock = vi.fn();
vi.mock("nostr-tools", () => ({
  verifyEvent: (payload: unknown) => verifyEventMock(payload),
}));

function makeAuthHeader(payload: Record<string, unknown>): string {
  return `Bearer ${Buffer.from(JSON.stringify(payload)).toString("base64")}`;
}

function createMockReq(overrides: Partial<AppRequest> = {}): AppRequest {
  return {
    headers: {},
    ...overrides,
  } as unknown as AppRequest;
}

function createMockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

function createMockNext() {
  return vi.fn();
}

describe("authMiddleware", () => {
  beforeEach(() => {
    process.env["SFS_UPLOAD_TOKEN_SECRET"] = "test-secret";
    resetConfig();
    verifyEventMock.mockReset().mockReturnValue(true);
  });

  it("calls next(ApiError) when Authorization header is missing", () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = createMockNext();
    authMiddleware(req, res as never, next as never);
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0] as unknown;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      message: "Missing authorization header",
      code: 401,
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next(err) when payload is invalid JSON", () => {
    const req = createMockReq({
      headers: { authorization: "Bearer not-valid-base64-json!!" },
    });
    const res = createMockRes();
    const next = createMockNext();
    authMiddleware(req, res as never, next as never);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next(ApiError) when verifySignature returns false", () => {
    verifyEventMock.mockReturnValue(false);
    const now = Math.floor(Date.now() / 1000);
    const req = createMockReq({
      headers: {
        authorization: makeAuthHeader({
          kind: 24242,
          pubkey: "pk",
          created_at: now,
          tags: [
            ["expiration", String(now + 60)],
            ["t", "upload"],
          ],
        }),
      },
    });
    const res = createMockRes();
    const next = createMockNext();
    authMiddleware(req, res as never, next as never);
    expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    expect(next.mock.calls[0]?.[0]).toMatchObject({
      message: "Invalid auth",
      code: 401,
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next(ApiError) when kind is not 24242", () => {
    const now = Math.floor(Date.now() / 1000);
    const req = createMockReq({
      headers: {
        authorization: makeAuthHeader({
          kind: 1,
          pubkey: "pk",
          created_at: now,
          tags: [
            ["expiration", String(now + 60)],
            ["t", "upload"],
          ],
        }),
      },
    });
    const res = createMockRes();
    const next = createMockNext();
    authMiddleware(req, res as never, next as never);
    expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    expect(next.mock.calls[0]?.[0]).toMatchObject({
      message: "Invalid auth",
      code: 401,
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next(ApiError) when expiration is missing or past", () => {
    const now = Math.floor(Date.now() / 1000);
    const req = createMockReq({
      headers: {
        authorization: makeAuthHeader({
          kind: 24242,
          pubkey: "pk",
          created_at: now,
          tags: [["t", "upload"]], // no expiration
        }),
      },
    });
    const res = createMockRes();
    const next = createMockNext();
    authMiddleware(req, res as never, next as never);
    expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    expect(next.mock.calls[0]?.[0]).toMatchObject({
      message: "Invalid auth",
      code: 401,
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next() when auth is valid", () => {
    const now = Math.floor(Date.now() / 1000);
    const req = createMockReq({
      headers: {
        authorization: makeAuthHeader({
          kind: 24242,
          pubkey: "pk",
          created_at: now,
          tags: [
            ["expiration", String(now + 60)],
            ["t", "upload"],
          ],
        }),
      },
    });
    const res = createMockRes();
    const next = createMockNext();
    authMiddleware(req, res as never, next as never);
    expect(next).toHaveBeenCalled();
    expect(req.blossom?.auth.pubkey).toBe("pk");
    expect(req.blossom?.verb).toBe("upload");
  });

  it("calls next(ApiError) on duplicate t tag", () => {
    const now = Math.floor(Date.now() / 1000);
    const req = createMockReq({
      headers: {
        authorization: makeAuthHeader({
          kind: 24242,
          pubkey: "pk",
          created_at: now,
          tags: [
            ["expiration", String(now + 60)],
            ["t", "upload"],
            ["t", "delete"],
          ],
        }),
      },
    });
    const res = createMockRes();
    const next = createMockNext();
    authMiddleware(req, res as never, next as never);
    expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    expect(next.mock.calls[0]?.[0]).toMatchObject({
      message: "Duplicate t tag",
      code: 401,
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("accepts small future clock skew within tolerance", () => {
    process.env["AUTH_TOLERANCE_SECONDS"] = "60";
    resetConfig();
    const now = Math.floor(Date.now() / 1000);
    const req = createMockReq({
      headers: {
        authorization: makeAuthHeader({
          kind: 24242,
          pubkey: "pk",
          created_at: now + 30,
          tags: [
            ["expiration", String(now + 120)],
            ["t", "upload"],
          ],
        }),
      },
    });
    const res = createMockRes();
    const next = createMockNext();
    authMiddleware(req, res as never, next as never);
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects future clock skew beyond tolerance", () => {
    process.env["AUTH_TOLERANCE_SECONDS"] = "60";
    resetConfig();
    const now = Math.floor(Date.now() / 1000);
    const req = createMockReq({
      headers: {
        authorization: makeAuthHeader({
          kind: 24242,
          pubkey: "pk",
          created_at: now + 61,
          tags: [
            ["expiration", String(now + 120)],
            ["t", "upload"],
          ],
        }),
      },
    });
    const res = createMockRes();
    const next = createMockNext();
    authMiddleware(req, res as never, next as never);
    expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    expect(next.mock.calls[0]?.[0]).toMatchObject({
      message: "Invalid auth",
      code: 401,
    });
  });
});
