import type { Response } from "express";

import { ApiError } from "../errors.js";
import * as storage from "../services/storage.js";
import type { AppRequest } from "../types.js";

export default async function del(
  req: AppRequest,
  res: Response
): Promise<void> {
  if (req.blossom?.verb !== "delete") {
    throw new ApiError("Expected t tag value 'delete'", 401);
  }

  const keyParam = req.params["key"];
  const key = typeof keyParam === "string" ? keyParam : "";
  if (!key) {
    throw new ApiError("Missing key", 400);
  }

  let sha256FromTag: string | undefined;
  for (const tag of req.blossom.auth.tags) {
    if (tag[0] === "x") {
      sha256FromTag = tag[1];
      break;
    }
  }
  if (!sha256FromTag) {
    throw new ApiError("Missing x tag", 401);
  }

  const pubkey = req.blossom.auth.pubkey;
  const deleted = req.app.db.deleteBlob(key, pubkey);
  if (deleted) {
    await storage.deleteObject(key);
  }

  res.status(204).end();
}
