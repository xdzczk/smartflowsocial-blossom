import { describe, expect, it } from "vitest";

import { fetchJsonWithRetry } from "../../src/services/http-client.js";

describe("performance baseline", () => {
  it("returns quickly when endpoint is unavailable", async () => {
    const started = Date.now();
    await fetchJsonWithRetry("http://127.0.0.1:1/unreachable", "GET", {
      timeoutMs: 150,
      retries: 1,
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(2_500);
  });
});
