import { Response } from "express";
import type { AppRequest } from "../types.js";
import type { ApiError } from "../types.js";

export default async function GetList(
  req: AppRequest,
  res: Response
): Promise<void> {
  try {
    const { auth, verb } = req.blossom!;

    if (verb !== "list") {
      throw { code: 401, message: "Expected t tag value 'list'" } as ApiError;
    }

    if (req.params.pubkey !== req.blossom!.auth.pubkey) {
      throw {
        code: 401,
        message:
          "Auth must be signed by the pubkey whose files you are trying to list",
      } as ApiError;
    }

    const files = req.app.db.listBlobs(req.blossom!.auth.pubkey);

    res.json(
      files.map((file) => ({
        created: file.created,
        infohash: file.sha256,
        type: file.type,
        sha256: file.sha256,
        size: file.size,
        url: `${process.env.CDN_ENDPOINT}/${file.sha256}${file.ext ? `.${file.ext}` : ""}`,
      }))
    );
  } catch (err) {
    const e = err as ApiError;
    console.log(err);
    res.status(e.code ?? 500).json({ message: e.message ?? "Unknown Error" });
  }
}
