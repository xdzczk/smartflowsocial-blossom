import { Response } from "express";
import type { AppRequest } from "../types.js";
import type { ApiError } from "../types.js";

export default function GetItem(req: AppRequest, res: Response): void {
  try {
    const { id } = req.params;

    if (!id) {
      throw { code: 400, message: "Missing hash" } as ApiError;
    }

    res.redirect(301, `${process.env.BLOB_ENDPOINT}/${id.split(".")[0]}`);
  } catch (err) {
    const e = err as ApiError;
    res.status(e.code ?? 500).json({ message: e.message ?? "Unknown Error" });
  }
}
