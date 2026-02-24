import { Response } from "express";
import type { AppRequest } from "../types.js";
import type { ApiError } from "../types.js";

export default function GetAccount(req: AppRequest, res: Response): void {
  try {
    if (req.blossom?.verb !== "account") {
      throw {
        code: 401,
        message: "Expected t tag value 'account'",
      } as ApiError;
    }

    const account = req.app.db.getAccount(req.blossom.auth.pubkey);
    res.json(account);
  } catch (err) {
    const e = err as ApiError;
    console.log(err);
    res.status(e.code ?? 500).json({ message: e.message ?? "Unknown Error" });
  }
}
