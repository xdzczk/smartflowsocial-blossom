import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetConfig } from "../../src/config.js";
import {
  enforceCompatPubkeyRateLimits,
  enforceIpRateLimit,
  enforcePubkeyRateLimits,
  initializeRateLimitProvider,
  resetRateLimitStateForTests,
  shutdownRateLimitProvider,
} from "../../src/services/rate-limit.js";

describe("rate-limit lanes", () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    process.env["SFS_UPLOAD_TOKEN_SECRET"] = "test-secret";
    process.env["RATE_LIMIT_MODE"] = "local";
    process.env["RATE_LIMIT_UPLOADS_BURST"] = "1";
    process.env["RATE_LIMIT_UPLOADS_PER_MIN"] = "1";
    process.env["RATE_LIMIT_BYTES_BURST"] = "100";
    process.env["RATE_LIMIT_BYTES_PER_MIN"] = "100";
    process.env["RATE_LIMIT_COMPAT_UPLOADS_BURST"] = "2";
    process.env["RATE_LIMIT_COMPAT_UPLOADS_PER_MIN"] = "2";
    process.env["RATE_LIMIT_COMPAT_BYTES_BURST"] = "200";
    process.env["RATE_LIMIT_COMPAT_BYTES_PER_MIN"] = "200";
    resetConfig();
    await resetRateLimitStateForTests();
  });

  it("uses separate buckets for authoritative and compatibility lanes", async () => {
    const pubkey = "npub_test";

    const firstAuthoritative = await enforcePubkeyRateLimits(pubkey, 50);
    const firstCompat = await enforceCompatPubkeyRateLimits(pubkey, 50);
    const secondCompat = await enforceCompatPubkeyRateLimits(pubkey, 50);
    const secondAuthoritative = await enforcePubkeyRateLimits(pubkey, 50);

    expect(firstAuthoritative.allowed).toBe(true);
    expect(firstCompat.allowed).toBe(true);
    expect(secondCompat.allowed).toBe(true);
    expect(secondAuthoritative.allowed).toBe(false);
  });

  it("fails initialization when redis mode is enabled without redis URL", async () => {
    process.env["RATE_LIMIT_MODE"] = "redis";
    delete process.env["RATE_LIMIT_REDIS_URL"];
    resetConfig();
    await expect(initializeRateLimitProvider()).rejects.toThrow(
      "RATE_LIMIT_MODE=redis requires RATE_LIMIT_REDIS_URL"
    );
  });

  it("throws when redis mode is active but provider is not initialized", async () => {
    process.env["RATE_LIMIT_MODE"] = "redis";
    process.env["RATE_LIMIT_REDIS_URL"] = "redis://127.0.0.1:6379";
    resetConfig();
    await shutdownRateLimitProvider();
    await expect(enforceIpRateLimit("1.2.3.4")).rejects.toThrow(
      "provider is not initialized"
    );
  });
});
