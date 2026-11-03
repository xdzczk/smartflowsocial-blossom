import { describe, expect, it } from "vitest";

import {
  incrementCounter,
  observeHistogram,
  renderMetrics,
  setGauge,
  withTiming,
} from "../../src/services/telemetry.js";

describe("telemetry", () => {
  it("renders counters, gauges, and histograms with labels", async () => {
    incrementCounter("gateway_test_total", { route: "b", method: "GET" }, 2);
    incrementCounter("gateway_test_total", { method: "GET", route: "b" });
    setGauge("gateway_queue", 4);
    setGauge("gateway_labeled", 1, { lane: "compat" });
    observeHistogram("gateway_latency_ms", 1.5);
    observeHistogram("gateway_latency_ms", 2.5);

    const rendered = renderMetrics();
    expect(rendered).toContain("# TYPE gateway_test_total counter");
    expect(rendered).toContain("gateway_test_total{method=GET,route=b} 3");
    expect(rendered).toContain("# TYPE gateway_queue gauge");
    expect(rendered).toContain("gateway_queue 4");
    expect(rendered).toContain("# TYPE gateway_latency_ms histogram");
    expect(rendered).toContain("gateway_latency_ms_count 2");
    expect(rendered).toContain("gateway_latency_ms_sum 4.000");

    const timed = await withTiming("gateway_op_ms", async () => "ok", {
      op: "read",
    });
    expect(timed).toBe("ok");
    expect(renderMetrics()).toContain("gateway_op_ms{op=read}_count 1");
  });

  it("keeps only the latest histogram samples", () => {
    for (let i = 0; i < 1001; i += 1) {
      observeHistogram("gateway_bounded_ms", i);
    }
    const rendered = renderMetrics();
    expect(rendered).toContain("gateway_bounded_ms_count 1000");
  });

  it("still records timing when the operation fails", async () => {
    await expect(
      withTiming("gateway_failed_ms", async () => {
        throw new Error("nope");
      })
    ).rejects.toThrow("nope");
    expect(renderMetrics()).toContain("gateway_failed_ms_count 1");
  });
});
