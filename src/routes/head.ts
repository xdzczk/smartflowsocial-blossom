import type { Response } from "express";
import type { Request } from "express";

import * as storage from "../services/storage.js";
import type { ApiError } from "../types.js";

export default async function head(req: Request, res: Response): Promise<void> {
  try {
    const key = req.params["key"];
    if (!key) {
      throw { code: 400, message: "Missing key" } as ApiError;
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
  } catch (err) {
    const e = err as ApiError;
    res.status(e.code ?? 500).json({ message: e.message ?? "Unknown Error" });
  }
}
