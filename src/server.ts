import fs from "fs";

import cors from "cors";
import * as dotenv from "dotenv";
import express from "express";
import morgan from "morgan";

import deleteRoute from "./routes/delete.js";
import headRoute from "./routes/head.js";
import uploadRoute from "./routes/upload.js";
import authMiddleware from "./services/auth.js";
import Database from "./services/db.js";
import type { AppInstance, AppRequest } from "./types.js";

const TEMP_DIR = "/tmp/sfs-blossom";

/** In-memory rate limit: max 10 uploads per minute per pubkey */
const RATE_LIMIT_UPLOADS_PER_MIN = 10;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

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

  fs.mkdirSync(TEMP_DIR, { recursive: true });

  const app = express() as unknown as express.Application & AppInstance;
  app.use(morgan("tiny"));
  app.use(cors());

  app.db = new Database();

  app.use((req: express.Request, _res, next) => {
    (req as unknown as AppRequest).app = app;
    next();
  });

  app.put(
    "/upload",
    authMiddleware as unknown as express.RequestHandler,
    rateLimitUpload,
    uploadRoute as unknown as express.RequestHandler
  );
  app.head("/:key", headRoute as unknown as express.RequestHandler);
  app.delete(
    "/:key",
    authMiddleware as unknown as express.RequestHandler,
    deleteRoute as unknown as express.RequestHandler
  );

  app.use((_req, res) => {
    res.status(404).send();
  });

  const port = Number(process.env["PORT"]) || 5050;
  app.listen(port, () => {
    console.info(`Listening on port ${port}`);
  });
}
