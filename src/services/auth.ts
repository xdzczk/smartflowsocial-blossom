import type { Response, NextFunction } from "express";
import { verifySignature } from "nostr-tools";

import { loadConfig } from "../config.js";
import { ApiError } from "../errors.js";
import type { BlossomAuth, AppRequest } from "../types.js";

export default function authMiddleware(
  req: AppRequest,
  _res: Response,
  next: NextFunction
): void {
  try {
    if (!req.headers.authorization) {
      next(new ApiError("Missing authorization header", 401));
      return;
    }

    req.blossom = {
      auth: JSON.parse(
        Buffer.from(
          req.headers.authorization.split(" ")[1] ?? "",
          "base64"
        ).toString()
      ) as BlossomAuth,
    };

    const authTolerance = loadConfig().authToleranceSeconds;
    const now = Math.floor(Date.now() / 1000);

    if (
      !verifySignature(
        req.blossom.auth as unknown as Parameters<typeof verifySignature>[0]
      ) ||
      req.blossom.auth.kind !== 24242 ||
      isNaN(req.blossom.auth.created_at) ||
      req.blossom.auth.created_at > now + authTolerance
    ) {
      next(new ApiError("Invalid auth", 401));
      return;
    }

    let expires: number | undefined;

    for (const tag of req.blossom.auth.tags) {
      if (tag[0] === "expiration") {
        if (expires) {
          next(new ApiError("Duplicate expires tag", 401));
          return;
        }
        expires = parseInt(tag[1] ?? "", 10);
      } else if (tag[0] === "t") {
        if (req.blossom.verb) {
          next(new ApiError("Duplicate t tag", 401));
          return;
        }
        req.blossom.verb = tag[1];
      }
    }

    if (!expires || expires <= now) {
      next(new ApiError("Invalid auth", 401));
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
}
