import type { Request } from "express";

/**
 * Resolve client IP from Express after trust-proxy processing.
 * Falls back to "unknown" to keep limiter keys deterministic.
 */
export function getClientIp(req: Request): string {
  const ip = req.ip?.trim();
  return ip && ip.length > 0 ? ip : "unknown";
}
