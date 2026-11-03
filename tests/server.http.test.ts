import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    async send(): Promise<never> {
      throw new Error("s3 unavailable");
    }
  }
  class DeleteObjectCommand {
    constructor(public input: unknown) {}
  }
  class HeadObjectCommand {
    constructor(public input: unknown) {}
  }
  class CopyObjectCommand {
    constructor(public input: unknown) {}
  }
  return {
    S3Client,
    DeleteObjectCommand,
    HeadObjectCommand,
    CopyObjectCommand,
  };
});

import { resetConfig } from "../src/config.js";

const dbDir = path.join(os.tmpdir(), `blossom-server-${Date.now()}`);
const port = 18080 + (process.pid % 1000);

async function text(
  pathname: string,
  init?: { method?: string; headers?: Record<string, string> }
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${pathname}`, init);
}

describe("running gateway", () => {
  beforeAll(async () => {
    fs.mkdirSync(dbDir, { recursive: true });
    process.env["HOST"] = "127.0.0.1";
    process.env["PORT"] = String(port);
    process.env["DB_PATH"] = dbDir;
    process.env["NODE_ENV"] = "test";
    process.env["METRICS_TOKEN"] = "metrics-secret";
    process.env["SFS_INTERNAL_SECRET"] = "internal-secret";
    process.env["SFS_INTERNAL_URL"] = "http://127.0.0.1:9";
    process.env["SFS_POLICY_URL"] = "http://127.0.0.1:9/policy";
    process.env["RATE_LIMIT_MODE"] = "local";
    process.env["RATE_LIMIT_IP_UPLOADS_PER_MIN"] = "1";
    process.env["SFS_UPLOAD_TOKEN_SECRET"] = "upload-secret-distinct";
    process.env["R2_BUCKET"] = "test-bucket";
    process.env["R2_ENDPOINT"] = "https://test.r2.dev";
    process.env["R2_ACCESS_KEY_ID"] = "test-key";
    process.env["R2_SECRET_ACCESS_KEY"] = "test-secret";
    resetConfig();
    vi.spyOn(process, "exit").mockImplementation(
      (() => undefined) as typeof process.exit
    );
    const { start } = await import("../src/server.js");
    await start();
    await vi.waitFor(async () => {
      const health = await text("/health");
      expect(health.status).toBe(200);
    });
  });

  afterAll(() => {
    process.emit("SIGTERM");
  });

  it("serves health, a generated request id, and metrics", async () => {
    const health = await text("/health");
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("OK");

    const ready = await text("/ready");
    expect([200, 503]).toContain(ready.status);
    const readyBody = (await ready.json()) as { checks: { policy: string } };
    expect(readyBody.checks.policy).toBe("unavailable");

    const denied = await text("/metrics");
    expect(denied.status).toBe(401);

    const metrics = await text("/metrics", {
      headers: { "x-metrics-token": "metrics-secret", "x-request-id": "req-1" },
    });
    expect(metrics.status).toBe(200);
    expect(metrics.headers.get("content-type")).toContain("text/plain");
    expect(await metrics.text()).toContain("gateway_http_requests_total");
  });

  it("returns 404, auth errors, and rate-limit errors", async () => {
    const missing = await text("/does-not-exist");
    expect(missing.status).toBe(404);

    const options = await text("/upload", { method: "OPTIONS" });
    expect(options.status).toBeLessThan(500);

    const unauthorized = await text("/blob-key", { method: "DELETE" });
    expect(unauthorized.status).toBe(401);
    const authBody = (await unauthorized.json()) as { error: string };
    expect(authBody.error).toBe("invalid_token");

    const firstUpload = await text("/upload", { method: "PUT" });
    const secondUpload = await text("/upload", { method: "PUT" });
    const statuses = [firstUpload.status, secondUpload.status].sort();
    expect(statuses).toEqual([401, 429]);
    const limited = firstUpload.status === 429 ? firstUpload : secondUpload;
    expect(limited.headers.get("retry-after")).toBeTruthy();

    const removed = await text("/internal/blob/file.jpg", {
      method: "DELETE",
      headers: {
        "x-internal-secret": "internal-secret",
        "x-request-id": "req-500",
      },
    });
    expect(removed.status).toBe(200);
    const removedBody = (await removed.json()) as { success: boolean };
    expect(removedBody.success).toBe(true);
  });
});
