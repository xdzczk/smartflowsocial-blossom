import { createHmac, timingSafeEqual } from "crypto";

import { loadConfig } from "../config.js";
import { ApiError } from "../errors.js";

export interface UploadTokenPayload {
  sub: string;
  sha256: string;
  size: number;
  type: string;
  iat: number;
  exp: number;
  jti: string;
  batchId: string;
  rateClass?: string;
}

function base64UrlToBuffer(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, "base64");
}

function verifySignature(
  content: string,
  providedSig: string,
  secret: string
): boolean {
  const expected = createHmac("sha256", secret).update(content).digest();
  const provided = base64UrlToBuffer(providedSig);
  if (expected.length !== provided.length) {
    return false;
  }
  return timingSafeEqual(expected, provided);
}

export function verifyUploadToken(rawToken: string): UploadTokenPayload {
  const secret = loadConfig().sfs.uploadTokenSecret;
  if (!secret) {
    throw new ApiError("Upload token secret is not configured", 503, {
      error: "service_unavailable",
    });
  }

  const parts = rawToken.split(".");
  if (parts.length !== 3) {
    throw new ApiError("Invalid upload token", 401, { error: "invalid_token" });
  }
  const [encodedHeader, encodedPayload, encodedSig] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSig) {
    throw new ApiError("Invalid upload token", 401, { error: "invalid_token" });
  }

  const header = JSON.parse(
    base64UrlToBuffer(encodedHeader).toString("utf8")
  ) as { alg?: string; typ?: string };
  if (header.alg !== "HS256") {
    throw new ApiError("Unsupported upload token algorithm", 401, {
      error: "invalid_token",
    });
  }
  if (header.typ && header.typ !== "JWT") {
    throw new ApiError("Invalid upload token type", 401, {
      error: "invalid_token",
    });
  }

  const content = `${encodedHeader}.${encodedPayload}`;
  if (!verifySignature(content, encodedSig, secret)) {
    throw new ApiError("Invalid upload token signature", 401, {
      error: "invalid_token",
    });
  }

  const payload = JSON.parse(
    base64UrlToBuffer(encodedPayload).toString("utf8")
  ) as UploadTokenPayload;

  const now = Math.floor(Date.now() / 1000);
  if (!payload.iat || payload.iat > now + 60) {
    throw new ApiError("Invalid upload token issue time", 401, {
      error: "invalid_token",
    });
  }
  if (now - payload.iat > 86_400) {
    throw new ApiError("Upload token too old", 401, {
      error: "invalid_token",
    });
  }
  if (!payload.exp || payload.exp <= now) {
    throw new ApiError("Upload token expired", 401, { error: "token_expired" });
  }

  if (
    !payload.sub ||
    !payload.sha256 ||
    !payload.jti ||
    !payload.batchId ||
    !Number.isFinite(payload.size) ||
    payload.size <= 0
  ) {
    throw new ApiError("Invalid upload token payload", 401, {
      error: "invalid_token",
    });
  }

  return payload;
}
