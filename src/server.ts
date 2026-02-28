import crypto from "crypto";
import fs from "fs";

import cors from "cors";
import * as dotenv from "dotenv";
import express from "express";
import morgan from "morgan";

import { loadConfig } from "./config.js";
import { ApiError } from "./errors.js";
import { log } from "./logger.js";
import deleteRoute from "./routes/delete.js";
import headRoute from "./routes/head.js";
import { createHealthRouter } from "./routes/health.js";
import internalDeleteRoute from "./routes/internal-delete.js";
import uploadRoute from "./routes/upload.js";
import authMiddleware from "./services/auth.js";
import { getClientIp } from "./services/client-ip.js";
import {
  flushCommitBuffer,
  startCommitReconciliation,
} from "./services/commit.js";
import Database from "./services/db.js";
import {
  initializeRateLimitProvider,
  shutdownRateLimitProvider,
} from "./services/rate-limit.js";
import {
  incrementCounter,
  observeHistogram,
  renderMetrics,
  setGauge,
} from "./services/telemetry.js";
import type { AppInstance, AppRequest } from "./types.js";

export function isCorsOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[]
): boolean {
  if (!origin) return true;
  if (allowedOrigins.length === 0) return true;
  if (allowedOrigins.includes("*")) return true;
  return allowedOrigins.includes(origin);
}

function requestIdMiddleware(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction
): void {
  const raw = req.headers["x-request-id"];
  const id =
    typeof raw === "string" && raw.trim() ? raw.trim() : crypto.randomUUID();
  req.id = id;
  next();
}

function errorHandler(
  err: unknown,
  req: express.Request,
  res: express.Response,
  _next: express.NextFunction
): void {
  const requestId = req.id ?? "unknown";
  if (err instanceof ApiError) {
    incrementCounter("gateway_api_error_total", {
      error: err.error,
      code: err.code,
    });
    const body: Record<string, unknown> = {
      error: err.error,
      message: err.message,
    };
    if (typeof err.retryAfter === "number") {
      body["retry_after"] = err.retryAfter;
      res.setHeader("Retry-After", String(err.retryAfter));
    }
    res.status(err.code).json(body);
    return;
  }
  log.error("Unhandled error", {
    requestId,
    err: err instanceof Error ? err.message : String(err),
  });
  incrementCounter("gateway_unhandled_error_total");
  if (err instanceof Error && err.stack) {
    log.error("Stack", { requestId, stack: err.stack });
  }
  res.status(500).json({
    message: "Internal Server Error",
    requestId,
  });
}

function asyncHandler(
  fn: (req: AppRequest, res: express.Response) => Promise<void>
): express.RequestHandler {
  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    void (async () => {
      try {
        await fn(req as AppRequest, res);
      } catch (e) {
        next(e);
      }
    })();
  };
}

const TEMP_DIR = "/tmp/sfs-blossom";
const SHUTDOWN_FLUSH_TIMEOUT_MS = 8_000;

export function isMetricsRequestAllowed(
  req: express.Request,
  metricsToken: string,
  metricsAllowlist: string[],
  nodeEnv: string
): boolean {
  const requesterIp = getClientIp(req);
  if (metricsAllowlist.length > 0 && metricsAllowlist.includes(requesterIp)) {
    return true;
  }
  if (!metricsToken) {
    return (
      metricsAllowlist.length === 0 &&
      (nodeEnv === "development" || nodeEnv === "test")
    );
  }
  const provided = req.headers["x-metrics-token"];
  const token = typeof provided === "string" ? provided : "";
  return token.length > 0 && token === metricsToken;
}

export async function start(): Promise<void> {
  dotenv.config();
  const config = loadConfig();
  await initializeRateLimitProvider();

  fs.mkdirSync(TEMP_DIR, { recursive: true });

  const app = express() as express.Application & AppInstance;
  app.set("trust proxy", config.trustProxy);
  app.use(morgan("tiny"));
  app.use(requestIdMiddleware);
  app.use((req, res, next) => {
    const started = performance.now();
    res.on("finish", () => {
      incrementCounter("gateway_http_requests_total", {
        method: req.method,
        route: req.path || "unknown",
        status: res.statusCode,
      });
      observeHistogram(
        "gateway_http_request_duration_ms",
        performance.now() - started,
        {
          method: req.method,
          route: req.path || "unknown",
        }
      );
    });
    next();
  });

  app.db = new Database({
    dbPath: config.dbPath,
    nativeBindingsPath: config.nativeBindingsPath,
  });

  app.use(createHealthRouter(app));

  const commitReconcileInterval = startCommitReconciliation(app);

  const publicCors = cors({
    origin: (origin, callback) => {
      callback(null, isCorsOriginAllowed(origin, config.corsAllowedOrigins));
    },
    methods: ["PUT", "HEAD", "OPTIONS"],
  });

  app.options("/upload", publicCors);
  app.options("/:key", publicCors);
  app.put("/upload", publicCors, asyncHandler(uploadRoute));
  app.head("/:key", publicCors, asyncHandler(headRoute));
  app.delete(
    "/:key",
    authMiddleware as express.RequestHandler,
    asyncHandler(deleteRoute)
  );
  app.delete("/internal/blob/:key", asyncHandler(internalDeleteRoute));
  app.get("/metrics", (req, res) => {
    if (
      !isMetricsRequestAllowed(
        req,
        config.observability.metricsToken,
        config.observability.metricsAllowlist,
        config.nodeEnv
      )
    ) {
      res.status(401).json({ message: "Unauthorized metrics access" });
      return;
    }
    setGauge(
      "gateway_pending_commits",
      app.db.countRetryableUncommitted(Math.floor(Date.now() / 1000))
    );
    setGauge(
      "gateway_dead_letter_commits",
      app.db.countDeadLetterUncommitted()
    );
    res.type("text/plain").send(renderMetrics());
  });

  app.use((_req, res) => {
    res.status(404).send();
  });

  app.use(errorHandler);

  const host = process.env["HOST"]?.trim() ?? "0.0.0.0";
  const server = app.listen(config.port, host, () => {
    log.info("Listening", { host, port: config.port });
  });

  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("Shutting down", { signal });
    clearInterval(commitReconcileInterval);
    const flushResult = await Promise.race([
      flushCommitBuffer(app).then(() => "flushed"),
      new Promise<"timed_out">((resolve) => {
        setTimeout(() => resolve("timed_out"), SHUTDOWN_FLUSH_TIMEOUT_MS);
      }),
    ]);
    if (flushResult === "timed_out") {
      log.warn("Commit flush timed out during shutdown", {
        timeoutMs: SHUTDOWN_FLUSH_TIMEOUT_MS,
      });
    }

    server.close((err?: Error) => {
      if (err) {
        log.error("Server close failed", { err: err.message });
        process.exit(1);
        return;
      }
      void (async () => {
        try {
          await shutdownRateLimitProvider();
        } catch (shutdownError) {
          log.warn("Rate-limit provider shutdown failed", {
            err:
              shutdownError instanceof Error
                ? shutdownError.message
                : String(shutdownError),
          });
        }
        app.db.close();
        log.info("Server closed");
        process.exit(0);
      })();
    });
  }

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}
