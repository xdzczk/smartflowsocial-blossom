import type { Server } from "http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetConfig } from "../../src/config.js";
import { ApiError } from "../../src/errors.js";
import { createHealthRouter } from "../../src/routes/health.js";
import uploadRoute from "../../src/routes/upload.js";
import type { AppRequest } from "../../src/types.js";

function makeTestApp(dbHealthy = true) {
  const app = express();
  (
    app as unknown as {
      db: {
        ping: () => boolean;
        countRetryableUncommitted: () => number;
        countDeadLetterUncommitted: () => number;
      };
    }
  ).db = {
    ping: () => dbHealthy,
    countRetryableUncommitted: () => 0,
    countDeadLetterUncommitted: () => 0,
  };
  app.use(createHealthRouter(app as never));
  app.put("/upload", (req, res, next) => {
    void uploadRoute(req as AppRequest, res).catch(next);
  });
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (err instanceof ApiError) {
        res.status(err.code).json({ error: err.error, message: err.message });
        return;
      }
      res.status(500).json({ message: "Internal Server Error" });
    }
  );
  return app;
}

async function withServer<T>(
  app: express.Application,
  fn: (baseUrl: string) => Promise<T>
): Promise<T> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Missing server address");
    }
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

describe("integration http routes", () => {
  beforeEach(() => {
    process.env["SFS_UPLOAD_TOKEN_SECRET"] = "test-secret";
    process.env["DB_PATH"] = "/tmp/vibe-cdn-integration";
    process.env["R2_BUCKET"] = "test-bucket";
    process.env["R2_ENDPOINT"] = "https://test.r2.dev";
    process.env["R2_ACCESS_KEY_ID"] = "test-key";
    process.env["R2_SECRET_ACCESS_KEY"] = "test-secret";
    resetConfig();
  });

  afterEach(() => {
    process.env["SFS_UPLOAD_TOKEN_SECRET"] = "test-secret";
    resetConfig();
  });

  it("serves health and readiness endpoints", async () => {
    const app = makeTestApp(true);
    await withServer(app, async (baseUrl) => {
      const health = await fetch(`${baseUrl}/health`);
      expect(health.status).toBe(200);
      const ready = await fetch(`${baseUrl}/ready`);
      expect(ready.status).toBe(200);
    });
  });

  it("returns 401 for upload with missing auth/token", async () => {
    const app = makeTestApp(true);
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/upload`, { method: "PUT" });
      expect(response.status).toBe(401);
      const body = (await response.json()) as { error?: string };
      expect(body.error).toBe("invalid_auth");
    });
  });
});
