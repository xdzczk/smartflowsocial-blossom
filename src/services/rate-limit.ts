import { createClient } from "redis";

import { loadConfig } from "../config.js";
import { log } from "../logger.js";

interface TokenBucketState {
  tokens: number;
  lastRefillMs: number;
  lastSeenMs: number;
}

interface RateLimitProvider {
  enforceIpRateLimit(
    ip: string
  ): Promise<{ allowed: boolean; retryAfterSec: number }>;
  enforcePubkeyRateLimits(
    pubkey: string,
    bytes: number
  ): Promise<{ allowed: boolean; retryAfterSec: number }>;
  enforceCompatPubkeyRateLimits(
    pubkey: string,
    bytes: number
  ): Promise<{ allowed: boolean; retryAfterSec: number }>;
}

const pubkeyUploadBuckets = new Map<string, TokenBucketState>();
const pubkeyBytesBuckets = new Map<string, TokenBucketState>();
const compatPubkeyUploadBuckets = new Map<string, TokenBucketState>();
const compatPubkeyBytesBuckets = new Map<string, TokenBucketState>();
const ipBuckets = new Map<string, TokenBucketState>();
const BUCKET_IDLE_TTL_MS = 15 * 60 * 1000;
const REDIS_BUCKET_IDLE_TTL_MS = 15 * 60 * 1000;
let lastSweepMs = 0;
let activeProvider: RateLimitProvider | null = null;
type RedisLikeClient = ReturnType<typeof createClient>;
let redisClient: RedisLikeClient | null = null;

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
  async enforceIpRateLimit(
    ip: string
  ): Promise<{ allowed: boolean; retryAfterSec: number }> {
    const cfg = loadConfig().rateLimit;
    const capacity = Math.max(1, cfg.ipUploadsPerMin);
    const refillPerSecond = capacity / 60;
    return consumeTokens(ipBuckets, ip, 1, capacity, refillPerSecond);
  },
  async enforcePubkeyRateLimits(
    pubkey: string,
    bytes: number
  ): Promise<{ allowed: boolean; retryAfterSec: number }> {
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
  async enforceCompatPubkeyRateLimits(
    pubkey: string,
    bytes: number
  ): Promise<{ allowed: boolean; retryAfterSec: number }> {
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

function redisBucketKey(kind: string, id: string): string {
  const cfg = loadConfig().rateLimit;
  return `${cfg.redisKeyPrefix}:${kind}:${id}`;
}

async function consumeTokensRedis(
  client: RedisLikeClient,
  key: string,
  amount: number,
  capacity: number,
  refillPerSecond: number
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const now = Date.now();
  const script = `
local key = KEYS[1]
local nowMs = tonumber(ARGV[1])
local amount = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])
local refillPerSec = tonumber(ARGV[4])
local ttlMs = tonumber(ARGV[5])
local tokens = tonumber(redis.call("HGET", key, "tokens"))
local lastMs = tonumber(redis.call("HGET", key, "lastMs"))
if tokens == nil then tokens = capacity end
if lastMs == nil then lastMs = nowMs end
local elapsedSec = math.max(0, (nowMs - lastMs) / 1000.0)
local refill = elapsedSec * refillPerSec
tokens = math.min(capacity, tokens + refill)
local allowed = 0
local retryAfterSec = 0
if tokens >= amount then
  tokens = tokens - amount
  allowed = 1
else
  local missing = amount - tokens
  retryAfterSec = math.ceil(missing / refillPerSec)
  if retryAfterSec < 1 then retryAfterSec = 1 end
end
redis.call("HSET", key, "tokens", tostring(tokens), "lastMs", tostring(nowMs))
redis.call("PEXPIRE", key, ttlMs)
return {allowed, retryAfterSec}
`;
  const result = (await client.eval(script, {
    keys: [key],
    arguments: [
      String(now),
      String(amount),
      String(capacity),
      String(refillPerSecond),
      String(REDIS_BUCKET_IDLE_TTL_MS),
    ],
  })) as [number | string, number | string];
  const allowedRaw = Number(result[0] ?? 0);
  const retryAfterRaw = Number(result[1] ?? 0);
  return {
    allowed: allowedRaw === 1,
    retryAfterSec: Math.max(0, Math.floor(retryAfterRaw)),
  };
}

function createRedisRateLimitProvider(
  client: RedisLikeClient
): RateLimitProvider {
  return {
    async enforceIpRateLimit(
      ip: string
    ): Promise<{ allowed: boolean; retryAfterSec: number }> {
      const cfg = loadConfig().rateLimit;
      const capacity = Math.max(1, cfg.ipUploadsPerMin);
      return consumeTokensRedis(
        client,
        redisBucketKey("ip", ip),
        1,
        capacity,
        capacity / 60
      );
    },
    async enforcePubkeyRateLimits(
      pubkey: string,
      bytes: number
    ): Promise<{ allowed: boolean; retryAfterSec: number }> {
      const cfg = loadConfig().rateLimit;
      const uploads = await consumeTokensRedis(
        client,
        redisBucketKey("pubkey_uploads", pubkey),
        1,
        Math.max(1, cfg.uploadsBurst),
        Math.max(1, cfg.uploadsPerMin) / 60
      );
      if (!uploads.allowed) return uploads;
      return consumeTokensRedis(
        client,
        redisBucketKey("pubkey_bytes", pubkey),
        Math.max(1, bytes),
        Math.max(1, cfg.bytesBurst),
        Math.max(1, cfg.bytesPerMin) / 60
      );
    },
    async enforceCompatPubkeyRateLimits(
      pubkey: string,
      bytes: number
    ): Promise<{ allowed: boolean; retryAfterSec: number }> {
      const cfg = loadConfig().rateLimit;
      const uploads = await consumeTokensRedis(
        client,
        redisBucketKey("compat_uploads", pubkey),
        1,
        Math.max(1, cfg.compatUploadsBurst),
        Math.max(1, cfg.compatUploadsPerMin) / 60
      );
      if (!uploads.allowed) return uploads;
      return consumeTokensRedis(
        client,
        redisBucketKey("compat_bytes", pubkey),
        Math.max(1, bytes),
        Math.max(1, cfg.compatBytesBurst),
        Math.max(1, cfg.compatBytesPerMin) / 60
      );
    },
  };
}

export async function initializeRateLimitProvider(): Promise<void> {
  const mode = loadConfig().rateLimit.mode;
  if (mode === "local") {
    activeProvider = localRateLimitProvider;
    return;
  }
  const redisUrl = loadConfig().rateLimit.redisUrl;
  if (!redisUrl) {
    throw new Error(
      "RATE_LIMIT_MODE=redis requires RATE_LIMIT_REDIS_URL to be configured"
    );
  }
  const client = createClient({ url: redisUrl });
  client.on("error", (error: unknown) => {
    log.warn("Redis rate-limit client error", {
      err: error instanceof Error ? error.message : String(error),
    });
  });
  await client.connect();
  redisClient = client;
  activeProvider = createRedisRateLimitProvider(client);
}

export async function shutdownRateLimitProvider(): Promise<void> {
  if (redisClient) {
    await redisClient.quit().catch(async () => {
      await redisClient?.disconnect();
    });
    redisClient = null;
  }
  activeProvider = null;
}

function getRateLimitProvider(): RateLimitProvider {
  if (activeProvider) return activeProvider;
  const mode = loadConfig().rateLimit.mode;
  if (mode === "local") {
    activeProvider = localRateLimitProvider;
    return activeProvider;
  }
  throw new Error(
    "RATE_LIMIT_MODE=redis is configured but provider is not initialized"
  );
}

export async function resetRateLimitStateForTests(): Promise<void> {
  pubkeyUploadBuckets.clear();
  pubkeyBytesBuckets.clear();
  compatPubkeyUploadBuckets.clear();
  compatPubkeyBytesBuckets.clear();
  ipBuckets.clear();
  lastSweepMs = 0;
  await shutdownRateLimitProvider();
}

export async function enforceIpRateLimit(ip: string): Promise<{
  allowed: boolean;
  retryAfterSec: number;
}> {
  return getRateLimitProvider().enforceIpRateLimit(ip);
}

export async function enforcePubkeyRateLimits(
  pubkey: string,
  bytes: number
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  return getRateLimitProvider().enforcePubkeyRateLimits(pubkey, bytes);
}

export async function enforceCompatPubkeyRateLimits(
  pubkey: string,
  bytes: number
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  return getRateLimitProvider().enforceCompatPubkeyRateLimits(pubkey, bytes);
}
