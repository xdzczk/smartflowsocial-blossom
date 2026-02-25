import type { Response } from "express";

import { loadConfig } from "../config.js";
import { ApiError } from "../errors.js";
import { deleteObject } from "../services/storage.js";
import type { AppRequest } from "../types.js";

export default async function internalDelete(
  req: AppRequest,
  res: Response
): Promise<void> {
  const cfg = loadConfig();
  const secret = req.headers["x-internal-secret"];
  const provided =
    typeof secret === "string"
      ? secret
      : Array.isArray(secret)
        ? secret[0]
        : "";

  if (!cfg.sfs.internalSecret || provided !== cfg.sfs.internalSecret) {
    throw new ApiError("Unauthorized", 401);
  }

  const keyParam = req.params["key"];
  const key = typeof keyParam === "string" ? decodeURIComponent(keyParam) : "";
  if (!key || key.includes("..")) {
    throw new ApiError("Invalid key", 400);
  }

  // Idempotent delete: deleting a missing object should not fail the workflow.
  await deleteObject(key).catch(() => undefined);
  req.app.db.deleteBlobByKey(key);
  res.status(200).json({ success: true, key });
}
