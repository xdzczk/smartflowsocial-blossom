import type { Response, NextFunction } from "express";
import { verifyEvent, type Event as NostrEvent } from "nostr-tools";

import { loadConfig } from "../config.js";
import { ApiError } from "../errors.js";
import type { BlossomAuth, AppRequest } from "../types.js";

function parseEncodedAuthPayload(authorization: string): string {
  const [schemeRaw, encoded] = authorization.trim().split(/\s+/, 2);
  const scheme = schemeRaw?.toLowerCase();
  if (!encoded || (scheme !== "nostr" && scheme !== "bearer")) {
    throw new ApiError("Invalid auth header format", 401, {
      error: "invalid_token",
    });
  }
  return Buffer.from(encoded, "base64").toString();
}

export function parseBlossomAuthorizationHeader(authorization: string): {
  auth: BlossomAuth;
  verb?: string;
} {
  const rawPayload = parseEncodedAuthPayload(authorization);
  const auth = JSON.parse(rawPayload) as BlossomAuth;

  const authTolerance = loadConfig().authToleranceSeconds;
  const now = Math.floor(Date.now() / 1000);

  if (
    !verifyEvent(auth as unknown as NostrEvent) ||
    auth.kind !== 24242 ||
    isNaN(auth.created_at) ||
    auth.created_at > now + authTolerance
  ) {
    throw new ApiError("Invalid auth", 401, { error: "invalid_token" });
  }

  let expires: number | undefined;
  let verb: string | undefined;

  for (const tag of auth.tags) {
    if (tag[0] === "expiration") {
      if (expires) {
        throw new ApiError("Duplicate expires tag", 401, {
          error: "invalid_token",
        });
      }
      expires = parseInt(tag[1] ?? "", 10);
    } else if (tag[0] === "t") {
      if (verb) {
        throw new ApiError("Duplicate t tag", 401, { error: "invalid_token" });
      }
      verb = tag[1];
    }
  }

  if (!expires || expires <= now) {
    throw new ApiError("Invalid auth", 401, { error: "token_expired" });
  }

  return { auth, verb };
}

export default function authMiddleware(
  req: AppRequest,
  _res: Response,
  next: NextFunction
): void {
  try {
    if (!req.headers.authorization) {
      next(
        new ApiError("Missing authorization header", 401, {
          error: "invalid_token",
        })
      );
      return;
    }
    const parsed = parseBlossomAuthorizationHeader(req.headers.authorization);
    req.blossom = { auth: parsed.auth, verb: parsed.verb };
    next();
  } catch (err) {
    next(err);
  }
}
