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
import {
  flushCommitBuffer,
  startCommitReconciliation,
} from "./services/commit.js";
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

  const commitReconcileInterval = startCommitReconciliation(app);

  app.put("/upload", asyncHandler(uploadRoute));
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

  const host = process.env["HOST"]?.trim() ?? "0.0.0.0";
  const server = app.listen(config.port, host, () => {
    log.info("Listening", { host, port: config.port });
  });

  function shutdown(signal: string): void {
    log.info("Shutting down", { signal });
    clearInterval(commitReconcileInterval);
    void flushCommitBuffer(app);
    server.close(() => {
      app.db.close();
      log.info("Server closed");
      process.exit(0);
    });
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
