import { createHmac } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { resetConfig } from "../../src/config.js";
import { verifyUploadToken } from "../../src/services/upload-token.js";

function base64UrlEncode(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function createToken(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const content = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret)
    .update(content)
    .digest("base64url");
  return `${content}.${signature}`;
}

describe("verifyUploadToken", () => {
  beforeEach(() => {
    process.env["SFS_UPLOAD_TOKEN_SECRET"] = "test-secret";
    resetConfig();
  });

  it("accepts valid token", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = createToken(
      {
        sub: "pk",
        sha256: "a".repeat(64),
        size: 123,
        type: "image/jpeg",
        iat: now,
        exp: now + 60,
        jti: "jti-1",
        batchId: "batch-1",
      },
      "test-secret"
    );
    const payload = verifyUploadToken(token);
    expect(payload.sub).toBe("pk");
    expect(payload.jti).toBe("jti-1");
  });

  it("rejects old iat token", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = createToken(
      {
        sub: "pk",
        sha256: "a".repeat(64),
        size: 123,
        type: "image/jpeg",
        iat: now - 90_000,
        exp: now + 60,
        jti: "jti-1",
        batchId: "batch-1",
      },
      "test-secret"
    );
    expect(() => verifyUploadToken(token)).toThrow("Upload token too old");
  });
});
