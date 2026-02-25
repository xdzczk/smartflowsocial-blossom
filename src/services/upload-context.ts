import { loadConfig } from "../config.js";
import { ApiError } from "../errors.js";
import { parseBlossomAuthorizationHeader } from "../services/auth.js";
import { verifyUploadToken } from "../services/upload-token.js";
import type { AppRequest } from "../types.js";

export type UploadLane = "authoritative" | "compat";

export interface UploadContext {
  lane: UploadLane;
  pubkey: string;
  expectedHash?: string;
  expectedSize?: number;
  expectedMimeType?: string;
  batchId?: string;
  jti?: string;
  tokenExp?: number;
}

function getAuthTagValue(
  tags: string[][],
  key: "x" | "ox" | "size" | "m"
): string | undefined {
  const found = tags.find(
    (tag) => Array.isArray(tag) && tag[0] === key && typeof tag[1] === "string"
  );
  return found?.[1];
}

function parseCompatContext(req: AppRequest): UploadContext {
  const cfg = loadConfig();
  if (!cfg.sfs.compatibilityMode.enabled) {
    throw new ApiError("Compatibility mode disabled", 403, {
      error: "compat_disabled",
    });
  }
  if (!req.headers.authorization) {
    throw new ApiError("Missing Blossom authorization", 401, {
      error: "invalid_auth",
    });
  }

  let parsed: ReturnType<typeof parseBlossomAuthorizationHeader>;
  try {
    parsed = parseBlossomAuthorizationHeader(req.headers.authorization);
  } catch (error) {
    if (error instanceof ApiError && error.error === "token_expired") {
      throw error;
    }
    throw new ApiError("Invalid Blossom authorization", 401, {
      error: "invalid_auth",
    });
  }

  if (parsed.verb !== "upload") {
    throw new ApiError("Expected t tag value 'upload'", 401, {
      error: "invalid_auth",
    });
  }

  req.blossom = { auth: parsed.auth, verb: parsed.verb };
  const expectedHashRaw =
    getAuthTagValue(parsed.auth.tags, "x") ??
    getAuthTagValue(parsed.auth.tags, "ox");
  const expectedHash =
    expectedHashRaw && /^[0-9a-f]{64}$/i.test(expectedHashRaw)
      ? expectedHashRaw.toLowerCase()
      : undefined;
  const expectedSizeRaw = getAuthTagValue(parsed.auth.tags, "size");
  const expectedSizeParsed = expectedSizeRaw
    ? parseInt(expectedSizeRaw, 10)
    : NaN;
  const expectedSize =
    Number.isFinite(expectedSizeParsed) && expectedSizeParsed > 0
      ? expectedSizeParsed
      : undefined;
  const expectedMimeType = getAuthTagValue(parsed.auth.tags, "m");

  return {
    lane: "compat",
    pubkey: parsed.auth.pubkey,
    expectedHash,
    expectedSize,
    expectedMimeType,
  };
}

export function resolveUploadContext(req: AppRequest): UploadContext {
  const rawToken = req.headers["x-sfs-upload-token"];
  const tokenHeader = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  if (!tokenHeader) return parseCompatContext(req);

  const token = verifyUploadToken(tokenHeader);
  req.uploadToken = token;

  if (req.headers.authorization) {
    const parsed = parseBlossomAuthorizationHeader(req.headers.authorization);
    if (parsed.verb !== "upload") {
      throw new ApiError("Expected t tag value 'upload'", 401, {
        error: "invalid_token",
      });
    }
    if (parsed.auth.pubkey !== token.sub) {
      throw new ApiError("Auth pubkey does not match upload token", 401, {
        error: "invalid_token",
      });
    }
    req.blossom = { auth: parsed.auth, verb: parsed.verb };
  }

  return {
    lane: "authoritative",
    pubkey: token.sub,
    expectedHash: token.sha256,
    expectedSize: token.size,
    expectedMimeType: token.type,
    batchId: token.batchId,
    jti: token.jti,
    tokenExp: token.exp,
  };
}
