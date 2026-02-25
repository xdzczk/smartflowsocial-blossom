import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetConfig } from "../../src/config.js";
import {
  clearCompatPolicyCache,
  getCompatPolicyForPubkey,
} from "../../src/services/policy.js";

describe("compat policy service", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.unstubAllEnvs();
    process.env["SFS_UPLOAD_TOKEN_SECRET"] = "test-secret";
    process.env["SFS_INTERNAL_URL"] = "https://smartflow.example";
    process.env["SFS_INTERNAL_SECRET"] = "secret123";
    process.env["SFS_POLICY_URL"] =
      "https://smartflow.example/internal/blossom/policy";
    process.env["SFS_POLICY_CACHE_TTL_SEC"] = "60";
    resetConfig();
    clearCompatPolicyCache();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("returns allow when policy allows compat upload", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          active: true,
          planId: "pro",
          allowCompatUpload: true,
        }),
    });
    const result = await getCompatPolicyForPubkey("pk");
    expect(result.state).toBe("allow");
  });

  it("returns deny when policy rejects compat upload", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          active: true,
          planId: "free",
          allowCompatUpload: false,
        }),
    });
    const result = await getCompatPolicyForPubkey("pk");
    expect(result.state).toBe("deny_free_or_inactive");
  });

  it("returns unavailable when policy service fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    const result = await getCompatPolicyForPubkey("pk");
    expect(result.state).toBe("unavailable");
  });
});
