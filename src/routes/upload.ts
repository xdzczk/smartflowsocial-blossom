import fs from "fs";

import type { Response } from "express";

import { loadConfig } from "../config.js";
import { ApiError } from "../errors.js";
import { log } from "../logger.js";
import {
  getHostedMediaPolicy,
  mapLegacyRateClassToCommercialPlanType,
} from "../planPolicy.js";
import { getClientIp } from "../services/client-ip.js";
import { enqueueCommitItem } from "../services/commit.js";
import { getCompatPolicyForPubkey } from "../services/policy.js";
import {
  enforceCompatPubkeyRateLimits,
  enforceIpRateLimit,
  enforcePubkeyRateLimits,
} from "../services/rate-limit.js";
import * as storage from "../services/storage.js";
import { incrementCounter } from "../services/telemetry.js";
import {
  resolveUploadContext,
  type UploadContext,
  type UploadLane,
} from "../services/upload-context.js";
import { resolveUploadMime } from "../services/upload-mime.js";
import {
  laneMaxBytesFor,
  uploadRequestStream,
} from "../services/upload-stream.js";
import type { AppRequest } from "../types.js";

const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
const COMPAT_QUOTA_WINDOW_SECONDS = 24 * 60 * 60;

function getMonthStartUtcEpochSeconds(date = new Date()): number {
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000
  );
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
    const ip = getClientIp(req);
    const ipRate = await enforceIpRateLimit(ip);
    if (!ipRate.allowed) {
      throw new ApiError("Too many requests", 429, {
        error: "rate_limited",
        retryAfter: ipRate.retryAfterSec,
      });
    }

    const context: UploadContext = resolveUploadContext(req);

    lane = context.lane;
    lanePubkey = context.pubkey;
    laneJti = context.jti;
    laneBatchId = context.batchId;
    laneExpectedSize = context.expectedSize;
    laneMaxBytes = laneMaxBytesFor(
      lane,
      config.sfs.compatibilityMode.maxUploadBytes
    );
    const contentLength = req.headers["content-length"];
    const parsedContentLength = contentLength
      ? parseInt(contentLength, 10)
      : NaN;
    const hasValidContentLength =
      Number.isFinite(parsedContentLength) && parsedContentLength > 0;

    if (lane === "compat") {
      const compatPolicy = await getCompatPolicyForPubkey(context.pubkey, {
        requestId: req.id,
      });
      if (compatPolicy.state === "unavailable") {
        incrementCounter("gateway_compat_precheck_denied_total", {
          reason: "policy_unavailable",
        });
        throw new ApiError("Policy service unavailable", 503, {
          error: "service_unavailable",
        });
      }
      if (compatPolicy.state !== "allow") {
        incrementCounter("gateway_compat_precheck_denied_total", {
          reason: "subscription_required",
        });
        throw new ApiError("Subscription required", 403, {
          error: "subscription_required",
        });
      }
      // Compat uploads are harder to pre-authorize, so require a bounded size
      // before streaming if auth did not include an explicit expected size.
      if (context.expectedSize === undefined && !hasValidContentLength) {
        incrementCounter("gateway_compat_precheck_denied_total", {
          reason: "unbounded_size",
        });
        throw new ApiError(
          "Content-Length required for compatibility uploads",
          411,
          { error: "invalid_request" }
        );
      }

      const requestBytes = Math.max(
        1,
        context.expectedSize ??
          (hasValidContentLength ? parsedContentLength : 0)
      );
      const compatDailyBytesLimit = Math.max(
        0,
        config.sfs.compatibilityMode.dailyBytesLimit
      );
      if (compatDailyBytesLimit > 0) {
        const windowStart =
          Math.floor(Date.now() / 1000) - COMPAT_QUOTA_WINDOW_SECONDS;
        const usage = req.app.db.getCompatUsageSince(
          context.pubkey,
          windowStart
        );
        if (usage.bytes + requestBytes > compatDailyBytesLimit) {
          incrementCounter("gateway_compat_precheck_denied_total", {
            reason: "daily_bytes_limit",
          });
          throw new ApiError("Compatibility daily byte quota exceeded", 429, {
            error: "rate_limited",
            retryAfter: 60,
          });
        }
      }
    }

    if (lane === "authoritative") {
      const commercialPlanType = mapLegacyRateClassToCommercialPlanType(
        req.uploadToken?.rateClass
      );
      const policy = getHostedMediaPolicy(commercialPlanType);
      if (!policy.canUseSfsBlossomStorage) {
        throw new ApiError("Plan not allowed", 403, {
          error: "plan_not_allowed",
        });
      }
      if (policy.maxFileBytes != null) {
        laneMaxBytes = Math.min(laneMaxBytes, policy.maxFileBytes);
      }

      const requestBytes =
        context.expectedSize ??
        (hasValidContentLength ? parsedContentLength : undefined);
      if (
        requestBytes &&
        policy.maxFileBytes != null &&
        requestBytes > policy.maxFileBytes
      ) {
        throw new ApiError("Payload too large", 413, {
          error: "payload_too_large",
        });
      }

      if (
        requestBytes &&
        policy.monthlyStorageBytes != null &&
        policy.monthlyUploadBytes != null
      ) {
        const storedBytes = req.app.db.getStoredBytes(context.pubkey);
        const monthStart = getMonthStartUtcEpochSeconds();
        const uploadedBytes = req.app.db.getUploadedBytesSince(
          context.pubkey,
          monthStart
        );
        const storageAllowed =
          BigInt(storedBytes) + BigInt(requestBytes) <=
          policy.monthlyStorageBytes;
        const uploadAllowed =
          BigInt(uploadedBytes) + BigInt(requestBytes) <=
          policy.monthlyUploadBytes;
        if (!storageAllowed || !uploadAllowed) {
          throw new ApiError("Quota exceeded", 403, {
            error: "quota_exceeded",
          });
        }
      }
    }

    const rateBytes =
      context.expectedSize ?? (hasValidContentLength ? parsedContentLength : 1);
    const rate =
      lane === "authoritative"
        ? await enforcePubkeyRateLimits(context.pubkey, rateBytes)
        : await enforceCompatPubkeyRateLimits(context.pubkey, rateBytes);
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

    if (contentLength) {
      const len = parsedContentLength;
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
    const streamResult = await uploadRequestStream({
      req,
      client,
      bucket,
      laneMaxBytes,
      laneExpectedSize,
    });
    tempPath = streamResult.tempPath;
    tempKey = streamResult.tempKey;
    bytesRead = streamResult.bytesRead;
    const sha256 = streamResult.sha256;

    const expectedHash = context.expectedHash;

    if (expectedHash !== undefined && expectedHash !== sha256) {
      throw new ApiError("SHA-256 mismatch", 400, { error: "sha256_mismatch" });
    }

    const headerMime = req.headers["content-type"];
    const headerMimeStr =
      typeof headerMime === "string" ? headerMime : undefined;
    const mime = await resolveUploadMime({
      tempPath,
      expectedMimeType: context.expectedMimeType,
      headerContentType: headerMimeStr,
    });
    const finalKey = mime.extension ? `${sha256}.${mime.extension}` : sha256;
    await storage.copyObject(tempKey, finalKey, mime.mimeType);

    const stat = await fs.promises.stat(tempPath);
    const size = stat.size;

    req.app.db.createBlob({
      key: finalKey,
      pubkey: context.pubkey,
      type: mime.mimeType,
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
        type: mime.mimeType,
        url,
      });
    } else {
      req.app.db.createCompatUpload({
        pubkey: context.pubkey,
        sha256,
        size,
        type: mime.mimeType,
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
    incrementCounter("gateway_upload_success_total", { lane: context.lane });

    // Nostrify BlossomUploader expects { url, sha256, size, type }; include x/m for NIP-94 compatibility
    res.json({
      url,
      sha256,
      size,
      type: mime.mimeType,
      x: sha256,
      m: mime.mimeType,
    });
  } catch (err) {
    incrementCounter("gateway_upload_failure_total", {
      lane,
      reason: err instanceof Error ? err.name : "unknown",
    });
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
