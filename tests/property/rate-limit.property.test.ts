import { describe, expect, it } from "vitest";

import { enforcePubkeyRateLimits } from "../../src/services/rate-limit.js";

describe("property-like rate-limit behavior", () => {
  it("never returns negative retryAfter", async () => {
    const pubkey = "npub_property";
    for (let i = 1; i <= 25; i += 1) {
      const result = await enforcePubkeyRateLimits(pubkey, i * 10);
      expect(result.retryAfterSec).toBeGreaterThanOrEqual(0);
    }
  });
});
