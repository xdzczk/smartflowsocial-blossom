import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (error: unknown) => void>();
const redisClient = {
  on(event: string, callback: (error: unknown) => void) {
    handlers.set(event, callback);
    return this;
  },
  connect: vi.fn(async () => undefined),
  quit: vi.fn(async () => {
    throw new Error("quit failed");
  }),
  disconnect: vi.fn(async () => undefined),
  eval: vi.fn(async () => [1, 0] as [number, number]),
};

vi.mock("redis", () => ({
  createClient: vi.fn(() => redisClient),
}));

import { resetConfig } from "../../src/config.js";
import {
  enforceCompatPubkeyRateLimits,
  enforceIpRateLimit,
  enforcePubkeyRateLimits,
  initializeRateLimitProvider,
  resetRateLimitStateForTests,
  shutdownRateLimitProvider,
} from "../../src/services/rate-limit.js";

describe("redis rate limits", () => {
  beforeEach(async () => {
    handlers.clear();
    redisClient.connect.mockClear();
    redisClient.quit.mockClear();
    redisClient.disconnect.mockClear();
    redisClient.eval.mockReset();
    redisClient.eval.mockResolvedValue([1, 0]);
    process.env["RATE_LIMIT_MODE"] = "redis";
    process.env["RATE_LIMIT_REDIS_URL"] = "redis://127.0.0.1:6379";
    process.env["RATE_LIMIT_REDIS_KEY_PREFIX"] = "sfs:test";
    process.env["SFS_UPLOAD_TOKEN_SECRET"] = "test-secret";
    resetConfig();
    await resetRateLimitStateForTests();
  });

  it("enforces each lane through the redis script", async () => {
    await initializeRateLimitProvider();
    expect(redisClient.connect).toHaveBeenCalledOnce();

    handlers.get("error")?.(new Error("socket closed"));
    handlers.get("error")?.("string failure");

    await expect(enforceIpRateLimit("203.0.113.5")).resolves.toEqual({
      allowed: true,
      retryAfterSec: 0,
    });
    redisClient.eval.mockResolvedValueOnce([0, 3]);
    await expect(enforcePubkeyRateLimits("pk", 20)).resolves.toEqual({
      allowed: false,
      retryAfterSec: 3,
    });
    redisClient.eval.mockResolvedValueOnce([1, 0]);
    redisClient.eval.mockResolvedValueOnce([0, 0]);
    await expect(enforceCompatPubkeyRateLimits("pk", 0)).resolves.toEqual({
      allowed: false,
      retryAfterSec: 0,
    });

    await shutdownRateLimitProvider();
    expect(redisClient.disconnect).toHaveBeenCalled();
  });
});
