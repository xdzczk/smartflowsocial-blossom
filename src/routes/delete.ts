import type { Response } from "express";

import * as storage from "../services/storage.js";
import type { AppRequest } from "../types.js";
import type { ApiError } from "../types.js";

export default async function del(
  req: AppRequest,
  res: Response
): Promise<void> {
  try {
    if (req.blossom?.verb !== "delete") {
      throw { code: 401, message: "Expected t tag value 'delete'" } as ApiError;
    }

    const key = req.params["key"];
    if (!key) {
      throw { code: 400, message: "Missing key" } as ApiError;
    }

    let sha256FromTag: string | undefined;
    for (const tag of req.blossom.auth.tags) {
      if (tag[0] === "x") {
        sha256FromTag = tag[1];
        break;
      }
    }
    if (!sha256FromTag) {
      throw { code: 401, message: "Missing x tag" } as ApiError;
    }

    const pubkey = req.blossom.auth.pubkey;
    const deleted = req.app.db.deleteBlob(key, pubkey);
    if (deleted) {
      await storage.deleteObject(key);
    }

    res.status(204).end();
  } catch (err) {
    const e = err as ApiError;
    res.status(e.code ?? 500).json({ message: e.message ?? "Unknown Error" });
  }
}
