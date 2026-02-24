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

/** API error thrown in route handlers */
export interface ApiError extends Error {
  code?: number;
  message: string;
}

/** Express app instance with CDN extensions */
export interface AppInstance {
  db: Database;
}

/** Request with app and optional blossom (override Express Request.app) */
export type AppRequest = Omit<Request, "app"> & {
  app: AppInstance;
  blossom?: BlossomContext;
};
