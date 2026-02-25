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
import Database from "./services/db.js";
import type { AppInstance, AppRequest } from "./types.js";

function requestIdMiddleware(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction
): void {
  const raw = req.headers["x-request-id"];
  const id =
    typeof raw === "string" && raw.trim() ? raw.trim() : crypto.randomUUID();
  (req as unknown as AppRequest).id = id;
  next();
}

function errorHandler(
  err: unknown,
  req: express.Request,
  res: express.Response,
  _next: express.NextFunction
): void {
  const appReq = req as unknown as AppRequest;
  const requestId = appReq.id ?? "unknown";
  if (err instanceof ApiError) {
    res.status(err.code).json({ message: err.message });
    return;
  }
  log.error("Unhandled error", {
    requestId,
    err: err instanceof Error ? err.message : String(err),
  });
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
        await fn(req as unknown as AppRequest, res);
      } catch (e) {
        next(e);
      }
    })();
  };
}

const TEMP_DIR = "/tmp/sfs-blossom";

/** In-memory rate limit: max 10 uploads per minute per pubkey. Per-process only; not shared across instances. */
const RATE_LIMIT_UPLOADS_PER_MIN = 10;
const RATE_LIMIT_CLEANUP_MS = 90 * 1000;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function cleanupRateLimitMap(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now >= entry.resetAt) {
      rateLimitMap.delete(key);
    }
  }
}

function rateLimitUpload(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const req = _req as unknown as AppRequest;
  const pubkey = req.blossom?.auth?.pubkey;
  if (!pubkey) {
    next();
    return;
  }
  const now = Date.now();
  const windowMs = 60 * 1000;
  let entry = rateLimitMap.get(pubkey);
  if (!entry) {
    entry = { count: 0, resetAt: now + windowMs };
    rateLimitMap.set(pubkey, entry);
  }
  if (now >= entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_UPLOADS_PER_MIN) {
    res.status(429).json({ message: "Too many uploads; try again later" });
    return;
  }
  next();
}

export async function start(): Promise<void> {
  dotenv.config();
  const config = loadConfig();

  fs.mkdirSync(TEMP_DIR, { recursive: true });

  const app = express() as unknown as express.Application & AppInstance;
  app.use(morgan("tiny"));
  app.use(cors());
  app.use(requestIdMiddleware);

  app.db = new Database({
    dbPath: config.dbPath,
    nativeBindingsPath: config.nativeBindingsPath,
  });

  app.use((req: express.Request, _res, next) => {
    (req as unknown as AppRequest).app = app;
    next();
  });

  app.use(createHealthRouter(app));

  const rateLimitCleanupInterval = setInterval(
    cleanupRateLimitMap,
    RATE_LIMIT_CLEANUP_MS
  );
  rateLimitCleanupInterval.unref();

  app.put(
    "/upload",
    authMiddleware as unknown as express.RequestHandler,
    rateLimitUpload,
    asyncHandler(uploadRoute)
  );
  app.head(
    "/:key",
    asyncHandler(
      headRoute as unknown as (
        req: AppRequest,
        res: express.Response
      ) => Promise<void>
    )
  );
  app.delete(
    "/:key",
    authMiddleware as unknown as express.RequestHandler,
    asyncHandler(deleteRoute)
  );
  app.delete("/internal/blob/:key", asyncHandler(internalDeleteRoute));

  app.use((_req, res) => {
    res.status(404).send();
  });

  app.use(errorHandler);

  const host = process.env.HOST?.trim() || "0.0.0.0";
  const server = app.listen(config.port, host, () => {
    log.info("Listening", { host, port: config.port });
  });

  function shutdown(signal: string): void {
    log.info("Shutting down", { signal });
    clearInterval(rateLimitCleanupInterval);
    server.close(() => {
      app.db.close();
      log.info("Server closed");
      process.exit(0);
    });
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
