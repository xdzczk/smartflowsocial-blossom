import type { Response } from "express";

import { ApiError } from "../errors.js";
import * as storage from "../services/storage.js";
import type { AppRequest } from "../types.js";

function isValidBlobKey(key: string): boolean {
  if (!key || key.length === 0) return false;
  if (key.includes("..") || key.includes("/") || key.includes("\\"))
    return false;
  return true;
}

export default async function head(
  req: AppRequest,
  res: Response
): Promise<void> {
  const keyParam = req.params["key"];
  const key = typeof keyParam === "string" ? keyParam : "";
  if (!key || !isValidBlobKey(key)) {
    throw new ApiError("Missing or invalid key", 400);
  }

  const meta = await storage.headObject(key);
  if (!meta.exists) {
    res.status(404).end();
    return;
  }

  res.status(200);
  if (meta.contentType) res.setHeader("Content-Type", meta.contentType);
  if (meta.contentLength != null)
    res.setHeader("Content-Length", String(meta.contentLength));
  res.end();
}
