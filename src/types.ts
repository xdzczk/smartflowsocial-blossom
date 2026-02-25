import type { Request } from "express";

import type Database from "./services/db.js";

/** Nostr auth event (kind 24242) parsed from Blossom auth header */
export interface BlossomAuth {
  kind: number;
  pubkey: string;
  created_at: number;
  tags: string[][];
  [key: string]: unknown;
}

/** Blossom auth + verb attached to req by Auth middleware */
export interface BlossomContext {
  auth: BlossomAuth;
  verb?: string;
}

export interface UploadTokenContext {
  sub: string;
  sha256: string;
  size: number;
  type: string;
  iat: number;
  exp: number;
  jti: string;
  batchId: string;
  rateClass?: string;
}

/** Express app instance with CDN extensions */
export interface AppInstance {
  db: Database;
}

declare global {
  namespace Express {
    interface Application extends AppInstance {}
    interface Request {
      blossom?: BlossomContext;
      uploadToken?: UploadTokenContext;
      id?: string;
    }
  }
}

/** Request with gateway extensions. */
export type AppRequest = Request & {
  app: AppInstance;
};
