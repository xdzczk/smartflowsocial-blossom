import { loadConfig } from "../config.js";
import { log } from "../logger.js";

interface TokenBucketState {
  tokens: number;
  lastRefillMs: number;
  lastSeenMs: number;
}

interface RateLimitProvider {
  enforceIpRateLimit(ip: string): { allowed: boolean; retryAfterSec: number };
  enforcePubkeyRateLimits(
    pubkey: string,
    bytes: number
  ): { allowed: boolean; retryAfterSec: number };
  enforceCompatPubkeyRateLimits(
    pubkey: string,
    bytes: number
  ): { allowed: boolean; retryAfterSec: number };
}

const pubkeyUploadBuckets = new Map<string, TokenBucketState>();
const pubkeyBytesBuckets = new Map<string, TokenBucketState>();
const compatPubkeyUploadBuckets = new Map<string, TokenBucketState>();
const compatPubkeyBytesBuckets = new Map<string, TokenBucketState>();
const ipBuckets = new Map<string, TokenBucketState>();
const BUCKET_IDLE_TTL_MS = 15 * 60 * 1000;
let lastSweepMs = 0;
let didWarnRedisFallback = false;

function sweepExpiredBuckets(
  map: Map<string, TokenBucketState>,
  nowMs: number
): void {
  for (const [key, state] of map.entries()) {
    if (nowMs - state.lastSeenMs > BUCKET_IDLE_TTL_MS) {
      map.delete(key);
    }
  }
}

function maybeSweepBuckets(nowMs: number): void {
  if (nowMs - lastSweepMs < 60_000) return;
  lastSweepMs = nowMs;
  sweepExpiredBuckets(pubkeyUploadBuckets, nowMs);
  sweepExpiredBuckets(pubkeyBytesBuckets, nowMs);
  sweepExpiredBuckets(compatPubkeyUploadBuckets, nowMs);
  sweepExpiredBuckets(compatPubkeyBytesBuckets, nowMs);
  sweepExpiredBuckets(ipBuckets, nowMs);
}

function refillBucket(
  bucket: TokenBucketState,
  nowMs: number,
  capacity: number,
  refillPerSecond: number
): void {
  const elapsedSec = Math.max(0, (nowMs - bucket.lastRefillMs) / 1000);
  const refill = elapsedSec * refillPerSecond;
  bucket.tokens = Math.min(capacity, bucket.tokens + refill);
  bucket.lastRefillMs = nowMs;
}

function consumeTokens(
  map: Map<string, TokenBucketState>,
  key: string,
  amount: number,
  capacity: number,
  refillPerSecond: number
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  maybeSweepBuckets(now);
  let bucket = map.get(key);
  if (!bucket) {
    bucket = { tokens: capacity, lastRefillMs: now, lastSeenMs: now };
    map.set(key, bucket);
  }
  bucket.lastSeenMs = now;

  refillBucket(bucket, now, capacity, refillPerSecond);
  if (bucket.tokens >= amount) {
    bucket.tokens -= amount;
    return { allowed: true, retryAfterSec: 0 };
  }

  const missing = amount - bucket.tokens;
  const retryAfterSec = Math.ceil(missing / refillPerSecond);
  return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
}

const localRateLimitProvider: RateLimitProvider = {
  enforceIpRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
    const cfg = loadConfig().rateLimit;
    const capacity = Math.max(1, cfg.ipUploadsPerMin);
    const refillPerSecond = capacity / 60;
    return consumeTokens(ipBuckets, ip, 1, capacity, refillPerSecond);
  },
  enforcePubkeyRateLimits(
    pubkey: string,
    bytes: number
  ): { allowed: boolean; retryAfterSec: number } {
    const cfg = loadConfig().rateLimit;
    const uploads = consumeTokens(
      pubkeyUploadBuckets,
      pubkey,
      1,
      Math.max(1, cfg.uploadsBurst),
      Math.max(1, cfg.uploadsPerMin) / 60
    );
    if (!uploads.allowed) return uploads;

    return consumeTokens(
      pubkeyBytesBuckets,
      pubkey,
      Math.max(1, bytes),
      Math.max(1, cfg.bytesBurst),
      Math.max(1, cfg.bytesPerMin) / 60
    );
  },
  enforceCompatPubkeyRateLimits(
    pubkey: string,
    bytes: number
  ): { allowed: boolean; retryAfterSec: number } {
    const cfg = loadConfig().rateLimit;
    const uploads = consumeTokens(
      compatPubkeyUploadBuckets,
      pubkey,
      1,
      Math.max(1, cfg.compatUploadsBurst),
      Math.max(1, cfg.compatUploadsPerMin) / 60
    );
    if (!uploads.allowed) return uploads;

    return consumeTokens(
      compatPubkeyBytesBuckets,
      pubkey,
      Math.max(1, bytes),
      Math.max(1, cfg.compatBytesBurst),
      Math.max(1, cfg.compatBytesPerMin) / 60
    );
  },
};

function getRateLimitProvider(): RateLimitProvider {
  const mode = loadConfig().rateLimit.mode;
  if (mode === "redis" && !didWarnRedisFallback) {
    didWarnRedisFallback = true;
    log.warn("RATE_LIMIT_MODE=redis requested, falling back to local provider");
  }
  return localRateLimitProvider;
}

export function enforceIpRateLimit(ip: string): {
  allowed: boolean;
  retryAfterSec: number;
} {
  return getRateLimitProvider().enforceIpRateLimit(ip);
}

export function enforcePubkeyRateLimits(
  pubkey: string,
  bytes: number
): { allowed: boolean; retryAfterSec: number } {
  return getRateLimitProvider().enforcePubkeyRateLimits(pubkey, bytes);
}

export function enforceCompatPubkeyRateLimits(
  pubkey: string,
  bytes: number
): { allowed: boolean; retryAfterSec: number } {
  return getRateLimitProvider().enforceCompatPubkeyRateLimits(pubkey, bytes);
}
