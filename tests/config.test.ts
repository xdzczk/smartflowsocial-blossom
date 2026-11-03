import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig, resetConfig } from "../src/config.js";

const REQUIRED = {
  DB_PATH: "/tmp/blossom-config-test",
  R2_BUCKET: "bucket",
  R2_ENDPOINT: "https://r2.example",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  SFS_UPLOAD_TOKEN_SECRET: "upload-secret",
} as const;

function applyRequired(): void {
  for (const [key, value] of Object.entries(REQUIRED)) {
    process.env[key] = value;
  }
}

describe("loadConfig", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    applyRequired();
    delete process.env["SFS_INTERNAL_SECRET"];
    delete process.env["PORT"];
    delete process.env["TRUST_PROXY"];
    delete process.env["RATE_LIMIT_MODE"];
    delete process.env["SFS_COMPAT_MODE_ENABLED"];
    delete process.env["AUTH_TOLERANCE_SECONDS"];
    delete process.env["CORS_ALLOWED_ORIGINS"];
    delete process.env["METRICS_TOKEN"];
    delete process.env["METRICS_ALLOWLIST"];
    delete process.env["NATIVE_BINDINGS_PATH"];
    resetConfig();
  });

  it("returns the cached config and applies optional overrides", () => {
    process.env["PORT"] = "not-a-number";
    process.env["AUTH_TOLERANCE_SECONDS"] = "";
    process.env["TRUST_PROXY"] = "2";
    process.env["RATE_LIMIT_MODE"] = "redis";
    process.env["SFS_COMPAT_MODE_ENABLED"] = "off";
    process.env["CORS_ALLOWED_ORIGINS"] =
      " https://a.example , ,https://b.example ";
    process.env["METRICS_TOKEN"] = "metrics";
    process.env["METRICS_ALLOWLIST"] = " 10.0.0.1, 10.0.0.2 ";
    process.env["NATIVE_BINDINGS_PATH"] = " /opt/native ";
    process.env["SFS_INTERNAL_URL"] = "https://sfs.example/";
    resetConfig();

    const first = loadConfig();
    const second = loadConfig();
    expect(second).toBe(first);
    expect(first.port).toBe(5050);
    expect(first.trustProxy).toBe(2);
    expect(first.rateLimit.mode).toBe("redis");
    expect(first.sfs.compatibilityMode.enabled).toBe(false);
    expect(first.corsAllowedOrigins).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
    expect(first.observability.metricsAllowlist).toEqual([
      "10.0.0.1",
      "10.0.0.2",
    ]);
    expect(first.nativeBindingsPath).toBe("/opt/native");
    expect(first.sfs.commitBatchUrl).toBe(
      "https://sfs.example/internal/blossom/commit-batch"
    );
  });

  it("accepts boolean and raw trust-proxy values", () => {
    process.env["TRUST_PROXY"] = "yes";
    resetConfig();
    expect(loadConfig().trustProxy).toBe(true);

    process.env["TRUST_PROXY"] = "loopback";
    resetConfig();
    expect(loadConfig().trustProxy).toBe("loopback");

    process.env["TRUST_PROXY"] = "false";
    resetConfig();
    expect(loadConfig().trustProxy).toBe(false);

    process.env["SFS_COMPAT_MODE_ENABLED"] = "maybe";
    process.env["RATE_LIMIT_MODE"] = "other";
    resetConfig();
    expect(loadConfig().sfs.compatibilityMode.enabled).toBe(true);
    expect(loadConfig().rateLimit.mode).toBe("local");
  });

  it("exits when a required variable is missing", () => {
    delete process.env["DB_PATH"];
    resetConfig();
    const exit = vi.spyOn(process, "exit").mockImplementation(((
      code?: number
    ) => {
      throw new Error(`exit:${String(code ?? "")}`);
    }) as typeof process.exit);
    expect(() => loadConfig()).toThrow("exit:1");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits when the upload token secret matches the internal secret", () => {
    process.env["SFS_INTERNAL_SECRET"] = REQUIRED.SFS_UPLOAD_TOKEN_SECRET;
    resetConfig();
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${String(code ?? "")}`);
    }) as typeof process.exit);
    expect(() => loadConfig()).toThrow("exit:1");
  });
});
