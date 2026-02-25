import { beforeEach, describe, it, expect, vi } from "vitest";

import { resetConfig } from "../../src/config.js";
import { verifySubscription } from "../../src/services/subscription.js";

describe("verifySubscription", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env["SFS_UPLOAD_TOKEN_SECRET"] = "test-secret";
    resetConfig();
    vi.stubGlobal("fetch", fetchMock);
    process.env["SFS_INTERNAL_URL"] = "https://sfs.example";
    process.env["SFS_INTERNAL_SECRET"] = "secret123";
  });

  it("returns true when response is 200 and active is true", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ active: true }),
    });
    const result = await verifySubscription("pubkey");
    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://sfs.example/internal/subscription-status?pubkey=pubkey",
      expect.objectContaining({
        method: "GET",
        headers: { "x-internal-secret": "secret123" },
      })
    );
  });

  it("returns false when response is 200 but active is false", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ active: false }),
    });
    const result = await verifySubscription("pk");
    expect(result).toBe(false);
  });

  it("returns false when response is not ok", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });
    const result = await verifySubscription("pk");
    expect(result).toBe(false);
  });

  it("returns false when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));
    const result = await verifySubscription("pk");
    expect(result).toBe(false);
  });

  it("returns false when SFS_INTERNAL_URL is empty", async () => {
    delete process.env["SFS_INTERNAL_URL"];
    process.env["SFS_UPLOAD_TOKEN_SECRET"] = "test-secret";
    resetConfig();
    fetchMock.mockClear();
    const result = await verifySubscription("pk");
    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns false when SFS_INTERNAL_SECRET is empty", async () => {
    delete process.env["SFS_INTERNAL_SECRET"];
    process.env["SFS_UPLOAD_TOKEN_SECRET"] = "test-secret";
    resetConfig();
    fetchMock.mockClear();
    const result = await verifySubscription("pk");
    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
