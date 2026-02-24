import { Response } from "express";
import type { AppRequest } from "../types.js";
import type { ApiError } from "../types.js";

export default async function HeadItem(
  req: AppRequest,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;

    if (!id) {
      throw { code: 400, message: "Missing hash" } as ApiError;
    }

    const blob = req.app.db.getBlob(id.split(".")[0]);
    res.status(blob ? 200 : 404).end();
  } catch (err) {
    const e = err as ApiError;
    res.status(e.code ?? 500).json({ message: e.message ?? "Unknown Error" });
  }
}
