import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/auth.js", () => ({
  parseBlossomAuthorizationHeader: vi.fn().mockReturnValue({
    verb: "upload",
    auth: {
      pubkey: "pk",
      tags: [
        [
          "x",
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        ],
        ["size", "10"],
      ],
    },
  }),
}));

vi.mock("../../src/services/policy.js", () => ({
  getCompatPolicyForPubkey: vi.fn(),
}));

import uploadRoute from "../../src/routes/upload.js";
import { getCompatPolicyForPubkey } from "../../src/services/policy.js";
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

function createReq(headers: Record<string, string>): AppRequest {
  return {
    app: {
      db: {
        createBlob: vi.fn(),
        markJtiUsed: vi.fn(),
        createCompatUpload: vi.fn(),
      },
    },
    headers,
    pipe: vi.fn(),
  } as unknown as AppRequest;
}

describe("PUT /upload policy gate", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    process.env["SFS_COMPAT_MODE_ENABLED"] = "true";
    process.env["SFS_UPLOAD_TOKEN_SECRET"] = "secret";
    (getCompatPolicyForPubkey as ReturnType<typeof vi.fn>).mockReset();
  });

  it("rejects compat upload for free/inactive policy", async () => {
    (getCompatPolicyForPubkey as ReturnType<typeof vi.fn>).mockResolvedValue({
      state: "deny_free_or_inactive",
    });
    const req = createReq({
      "content-type": "image/jpeg",
      authorization: "Nostr any",
    });
    await expect(uploadRoute(req, mockRes() as never)).rejects.toMatchObject({
      code: 403,
      error: "subscription_required",
    });
  });

  it("fails closed when policy service unavailable", async () => {
    (getCompatPolicyForPubkey as ReturnType<typeof vi.fn>).mockResolvedValue({
      state: "unavailable",
    });
    const req = createReq({
      "content-type": "image/jpeg",
      authorization: "Nostr any",
    });
    await expect(uploadRoute(req, mockRes() as never)).rejects.toMatchObject({
      code: 503,
      error: "service_unavailable",
    });
  });
});
