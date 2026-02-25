import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";

import { Upload } from "@aws-sdk/lib-storage";
import type { Response } from "express";
import { fileTypeFromStream } from "file-type";

import { loadConfig } from "../config.js";
import { ApiError } from "../errors.js";
import { log } from "../logger.js";
import { parseBlossomAuthorizationHeader } from "../services/auth.js";
import { enqueueCommitItem } from "../services/commit.js";
import {
  enforceCompatPubkeyRateLimits,
  enforceIpRateLimit,
  enforcePubkeyRateLimits,
} from "../services/rate-limit.js";
import * as storage from "../services/storage.js";
import { verifyUploadToken } from "../services/upload-token.js";
import type { AppRequest } from "../types.js";
import { isAllowedMime, getExtension } from "../utils/mime.js";

const TEMP_DIR = "/tmp/sfs-blossom";
const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
type UploadLane = "authoritative" | "compat";

interface UploadContext {
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

export default async function upload(
  req: AppRequest,
  res: Response
): Promise<void> {
  let tempPath: string | undefined;
  let tempKey: string | undefined;
  let bytesRead = 0;
  let lane: UploadLane = "authoritative";
  let lanePubkey: string | undefined;
  let laneJti: string | undefined;
  let laneBatchId: string | undefined;
  let laneExpectedSize: number | undefined;
  let laneMaxBytes = MAX_UPLOAD_BYTES;
  const config = loadConfig();
  const client = storage.getR2Client();
  const bucket = config.r2.bucket;

  try {
    const ip =
      (typeof req.headers["x-forwarded-for"] === "string"
        ? req.headers["x-forwarded-for"].split(",")[0]?.trim()
        : undefined) ??
      req.ip ??
      "unknown";
    const ipRate = enforceIpRateLimit(ip);
    if (!ipRate.allowed) {
      throw new ApiError("Too many requests", 429, {
        error: "rate_limited",
        retryAfter: ipRate.retryAfterSec,
      });
    }

    const rawToken = req.headers["x-sfs-upload-token"];
    const tokenHeader = Array.isArray(rawToken) ? rawToken[0] : rawToken;
    let context: UploadContext;

    if (tokenHeader) {
      const token = verifyUploadToken(tokenHeader);
      req.uploadToken = token;
      if (req.headers.authorization) {
        const parsed = parseBlossomAuthorizationHeader(
          req.headers.authorization
        );
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

      context = {
        lane: "authoritative",
        pubkey: token.sub,
        expectedHash: token.sha256,
        expectedSize: token.size,
        expectedMimeType: token.type,
        batchId: token.batchId,
        jti: token.jti,
        tokenExp: token.exp,
      };
    } else {
      lane = "compat";
      context = parseCompatContext(req);
    }

    lane = context.lane;
    lanePubkey = context.pubkey;
    laneJti = context.jti;
    laneBatchId = context.batchId;
    laneExpectedSize = context.expectedSize;
    laneMaxBytes =
      lane === "compat"
        ? Math.min(
            MAX_UPLOAD_BYTES,
            config.sfs.compatibilityMode.maxUploadBytes
          )
        : MAX_UPLOAD_BYTES;

    const headerLenRaw = req.headers["content-length"];
    const headerLen = headerLenRaw ? parseInt(headerLenRaw, 10) : NaN;
    const rateBytes =
      context.expectedSize ??
      (Number.isFinite(headerLen) && headerLen > 0 ? headerLen : 1);
    const rate =
      lane === "authoritative"
        ? enforcePubkeyRateLimits(context.pubkey, rateBytes)
        : enforceCompatPubkeyRateLimits(context.pubkey, rateBytes);
    if (!rate.allowed) {
      throw new ApiError("Rate limited", 429, {
        error: "rate_limited",
        retryAfter: rate.retryAfterSec,
      });
    }

    if (lane === "authoritative" && context.jti && context.tokenExp) {
      const jtiAccepted = req.app.db.markJtiUsed({
        jti: context.jti,
        pubkey: context.pubkey,
        expires: context.tokenExp,
      });
      if (!jtiAccepted) {
        throw new ApiError("Upload token already used", 401, {
          error: "invalid_token",
        });
      }
    }

    const contentLength = req.headers["content-length"];
    if (contentLength) {
      const len = parseInt(contentLength, 10);
      if (!isNaN(len) && len > laneMaxBytes) {
        throw new ApiError("Payload too large", 413, {
          error: "payload_too_large",
        });
      }
      if (!isNaN(len) && laneExpectedSize && len > laneExpectedSize) {
        throw new ApiError("Payload larger than expected size", 413, {
          error: "payload_too_large",
        });
      }
    }
    const expectedHash = context.expectedHash;

    tempKey = `${crypto.randomBytes(20).toString("hex")}.temp`;
    tempPath = path.join(TEMP_DIR, tempKey);

    const fileStream = fs.createWriteStream(tempPath);
    const hash = crypto.createHash("sha256").setEncoding("hex");
    const passThrough = new PassThrough();

    let savedLocal = false;
    let sha256: string | undefined;

    fileStream.on("finish", () => {
      savedLocal = true;
    });

    hash.on("finish", () => {
      hash.end();
      sha256 = hash.read() as string;
    });

    passThrough.on("data", (chunk: Buffer) => {
      bytesRead += chunk.length;
      if (
        bytesRead > laneMaxBytes ||
        (laneExpectedSize !== undefined && bytesRead > laneExpectedSize)
      ) {
        passThrough.destroy(new Error("MAX_SIZE"));
      }
    });

    passThrough.pipe(fileStream);
    passThrough.pipe(hash);

    const uploading = new Upload({
      client,
      params: {
        Bucket: bucket,
        Body: passThrough,
        Key: tempKey,
      },
    });

    req.pipe(passThrough);

    await uploading.done();

    if (
      bytesRead > laneMaxBytes ||
      (laneExpectedSize !== undefined && bytesRead > laneExpectedSize)
    ) {
      throw new ApiError("Payload too large", 413, {
        error: "payload_too_large",
      });
    }
    if (laneExpectedSize !== undefined && bytesRead !== laneExpectedSize) {
      throw new ApiError("Payload size does not match expected size", 400, {
        error: "invalid_request",
      });
    }

    if (!sha256 && savedLocal) {
      throw new ApiError("Hash not computed", 500);
    }

    if (expectedHash !== undefined && expectedHash !== sha256) {
      throw new ApiError("SHA-256 mismatch", 400, { error: "sha256_mismatch" });
    }

    let ext: string | null = null;
    let mimeType: string | undefined;
    mimeType = context.expectedMimeType;
    ext = context.expectedMimeType
      ? (getExtension(context.expectedMimeType) ?? null)
      : null;

    const headerMime = req.headers["content-type"];
    const headerMimeStr =
      typeof headerMime === "string" ? headerMime : undefined;
    if (headerMimeStr && headerMimeStr !== "application/octet-stream") {
      mimeType = headerMimeStr.split(";")[0]?.trim();
      if (!ext && mimeType) ext = getExtension(mimeType);
    }

    if (!mimeType && tempPath) {
      const readStream = fs.createReadStream(tempPath);
      // Node ReadStream is not typed as AnyWebByteStream; file-type accepts it at runtime
      const fileInfo = await fileTypeFromStream(
        readStream as unknown as Parameters<typeof fileTypeFromStream>[0]
      );
      if (fileInfo) {
        mimeType = fileInfo.mime;
        ext = fileInfo.ext ?? getExtension(fileInfo.mime);
      }
    }

    if (!mimeType) {
      mimeType = "application/octet-stream";
      ext = null;
    }

    if (!isAllowedMime(mimeType)) {
      throw new ApiError("Only image and video types are allowed", 400, {
        error: "invalid_request",
      });
    }

    if (sha256 === undefined) {
      throw new ApiError("Hash not computed", 500);
    }
    const finalKey = ext ? `${sha256}.${ext}` : sha256;
    await storage.copyObject(tempKey, finalKey, mimeType);

    const stat = await fs.promises.stat(tempPath);
    const size = stat.size;

    req.app.db.createBlob({
      key: finalKey,
      pubkey: context.pubkey,
      type: mimeType,
      size,
    });

    await storage.deleteObject(tempKey);

    const url = `${config.blossomPublicUrl.replace(/\/$/, "")}/${finalKey}`;
    if (context.lane === "authoritative" && context.batchId && context.jti) {
      enqueueCommitItem(req.app, context.batchId, {
        jti: context.jti,
        pubkey: context.pubkey,
        sha256,
        size,
        type: mimeType,
        url,
      });
    } else {
      req.app.db.createCompatUpload({
        pubkey: context.pubkey,
        sha256,
        size,
        type: mimeType,
        url,
      });
    }
    log.info("upload_completed", {
      requestId: req.id,
      lane: context.lane,
      pubkey: context.pubkey,
      sha256,
      size,
      jti: context.jti,
      batchId: context.batchId,
      result: "ok",
    });

    // Nostrify BlossomUploader expects { url, sha256, size, type }; include x/m for NIP-94 compatibility
    res.json({
      url,
      sha256,
      size,
      type: mimeType,
      x: sha256,
      m: mimeType,
    });
  } catch (err) {
    log.warn("upload_failed", {
      requestId: req.id,
      lane,
      reason: err instanceof Error ? err.message : String(err),
      bytesRead,
      pubkey: lanePubkey ?? req.uploadToken?.sub,
      jti: laneJti ?? req.uploadToken?.jti,
      batchId: laneBatchId ?? req.uploadToken?.batchId,
    });
    if (
      bytesRead > laneMaxBytes ||
      (laneExpectedSize !== undefined && bytesRead > laneExpectedSize)
    ) {
      throw new ApiError("Payload too large", 413, {
        error: "payload_too_large",
      });
    }
    throw err;
  } finally {
    if (tempPath) {
      await fs.promises.unlink(tempPath).catch((err: unknown) => {
        log.warn("Upload cleanup: failed to unlink temp file", {
          tempPath,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }
    if (tempKey) {
      await storage.deleteObject(tempKey).catch((err: unknown) => {
        log.warn("Upload cleanup: failed to delete temp object", {
          tempKey,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }
}
