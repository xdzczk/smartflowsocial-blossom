import { loadConfig } from "../config.js";

interface TokenBucketState {
  tokens: number;
  lastRefillMs: number;
}

const pubkeyUploadBuckets = new Map<string, TokenBucketState>();
const pubkeyBytesBuckets = new Map<string, TokenBucketState>();
const ipBuckets = new Map<string, TokenBucketState>();

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
  let bucket = map.get(key);
  if (!bucket) {
    bucket = { tokens: capacity, lastRefillMs: now };
    map.set(key, bucket);
  }

  refillBucket(bucket, now, capacity, refillPerSecond);
  if (bucket.tokens >= amount) {
    bucket.tokens -= amount;
    return { allowed: true, retryAfterSec: 0 };
  }

  const missing = amount - bucket.tokens;
  const retryAfterSec = Math.ceil(missing / refillPerSecond);
  return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
}

export function enforceIpRateLimit(ip: string): {
  allowed: boolean;
  retryAfterSec: number;
} {
  const cfg = loadConfig().rateLimit;
  const capacity = Math.max(1, cfg.ipUploadsPerMin);
  const refillPerSecond = capacity / 60;
  return consumeTokens(ipBuckets, ip, 1, capacity, refillPerSecond);
}

export function enforcePubkeyRateLimits(
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

  const byBytes = consumeTokens(
    pubkeyBytesBuckets,
    pubkey,
    Math.max(1, bytes),
    Math.max(1, cfg.bytesBurst),
    Math.max(1, cfg.bytesPerMin) / 60
  );
  return byBytes;
}
