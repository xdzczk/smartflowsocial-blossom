import type { Request } from 'express';

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

/** Express app instance with CDN extensions (typed loosely to avoid circular imports) */
export interface AppInstance {
  db: import('./sqlite/index.js').default;
  listener?: import('./listener/index.js').default;
  exchange?: import('./exchange/index.js').default;
  pubkey?: string;
}

/** Request with app and optional blossom (override Express Request.app) */
export type AppRequest = Omit<Request, 'app'> & {
  app: AppInstance;
  blossom?: BlossomContext;
};

/** Blob row from DB */
export interface BlobRow {
  sha256: string;
  type: string | null;
  ext: string | null;
  size: number;
  created: number;
}

/** Credit row from DB */
export interface CreditRow {
  id: string;
  pubkey: string;
  offer: string;
  created: number;
  gb_months: number;
  rate_usd: number;
  receipt: string | null;
  paid_at: number | null;
  paid_by: number | null;
}

/** Params for createBlob */
export interface CreateBlobParams {
  pubkey: string;
  sha256: string;
  type: string;
  size: number;
  ext: string | null;
}

/** Params for createCredit */
export interface CreateCreditParams {
  id: string;
  pubkey: string;
  rate_usd: number;
  created: number;
  gb_months: number;
  amount: number;
  offer: object;
}

/** Params for handlePayment */
export interface HandlePaymentParams {
  id: string;
  receipt: string;
  paid_at: number;
  paid_by: string;
}
