import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetConfig } from "../../src/config.js";
import {
  enforceCompatPubkeyRateLimits,
  enforcePubkeyRateLimits,
} from "../../src/services/rate-limit.js";

describe("rate-limit lanes", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    process.env["SFS_UPLOAD_TOKEN_SECRET"] = "test-secret";
    process.env["RATE_LIMIT_UPLOADS_BURST"] = "1";
    process.env["RATE_LIMIT_UPLOADS_PER_MIN"] = "1";
    process.env["RATE_LIMIT_BYTES_BURST"] = "100";
    process.env["RATE_LIMIT_BYTES_PER_MIN"] = "100";
    process.env["RATE_LIMIT_COMPAT_UPLOADS_BURST"] = "2";
    process.env["RATE_LIMIT_COMPAT_UPLOADS_PER_MIN"] = "2";
    process.env["RATE_LIMIT_COMPAT_BYTES_BURST"] = "200";
    process.env["RATE_LIMIT_COMPAT_BYTES_PER_MIN"] = "200";
    resetConfig();
  });

  it("uses separate buckets for authoritative and compatibility lanes", () => {
    const pubkey = "npub_test";

    const firstAuthoritative = enforcePubkeyRateLimits(pubkey, 50);
    const firstCompat = enforceCompatPubkeyRateLimits(pubkey, 50);
    const secondCompat = enforceCompatPubkeyRateLimits(pubkey, 50);
    const secondAuthoritative = enforcePubkeyRateLimits(pubkey, 50);

    expect(firstAuthoritative.allowed).toBe(true);
    expect(firstCompat.allowed).toBe(true);
    expect(secondCompat.allowed).toBe(true);
    expect(secondAuthoritative.allowed).toBe(false);
  });
});
