import type { Response, NextFunction } from "express";
import { verifySignature } from "nostr-tools";

import type { ApiError, BlossomAuth, AppRequest } from "../types.js";

export default function authMiddleware(
  req: AppRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    if (!req.headers.authorization) {
      throw { code: 401, message: "Missing authorization header" } as ApiError;
    }

    req.blossom = {
      auth: JSON.parse(
        Buffer.from(
          req.headers.authorization.split(" ")[1] ?? "",
          "base64"
        ).toString()
      ) as BlossomAuth,
    };

    const authTolerance = process.env["AUTH_TOLERANCE_SECONDS"]
      ? parseInt(process.env["AUTH_TOLERANCE_SECONDS"], 10)
      : 0;

    const now = Math.floor(Date.now() / 1000);

    if (
      !verifySignature(
        req.blossom.auth as unknown as Parameters<typeof verifySignature>[0]
      ) ||
      req.blossom.auth.kind !== 24242 ||
      isNaN(req.blossom.auth.created_at) ||
      req.blossom.auth.created_at > now + authTolerance
    ) {
      throw { code: 401, message: "Invalid auth" } as ApiError;
    }

    let expires: number | undefined;

    for (const tag of req.blossom.auth.tags) {
      if (tag[0] === "expiration") {
        if (expires) {
          throw { code: 401, message: "Duplicate expires tag" } as ApiError;
        }
        expires = parseInt(tag[1] ?? "", 10);
      } else if (tag[0] === "t") {
        if (req.blossom.verb) {
          throw { code: 401, message: "Duplicate t tag" } as ApiError;
        }
        req.blossom.verb = tag[1];
      }
    }

    if (!expires || expires <= now) {
      throw { code: 401, message: "Invalid auth" } as ApiError;
    }

    next();
  } catch (err) {
    const e = err as ApiError;
    res.status(e.code ?? 500).json({ message: e.message ?? "Unknown Error" });
  }
}
