import { loadConfig } from "../config.js";
import { log } from "../logger.js";

import { fetchJsonWithRetry } from "./http-client.js";

interface CachedPolicy {
  expiresAtMs: number;
  result: CompatPolicyResult;
}

const policyCache = new Map<string, CachedPolicy>();

export interface CompatPolicyResult {
  state: "allow" | "deny_free_or_inactive" | "unavailable";
  active?: boolean;
  planId?: string | null;
  allowCompatUpload?: boolean;
}

export function clearCompatPolicyCache(): void {
  policyCache.clear();
}

export async function getCompatPolicyForPubkey(
  pubkey: string,
  options?: { requestId?: string }
): Promise<CompatPolicyResult> {
  const normalized = pubkey.trim().toLowerCase();
  if (!normalized) {
    return { state: "deny_free_or_inactive", active: false, planId: null };
  }

  const now = Date.now();
  const cached = policyCache.get(normalized);
  if (cached && cached.expiresAtMs > now) {
    return cached.result;
  }

  const { sfs } = loadConfig();
  if (!sfs.internalSecret || !sfs.policyUrl) {
    log.warn("Policy check unavailable: missing SFS policy config", {
      hasInternalSecret: !!sfs.internalSecret,
      hasPolicyUrl: !!sfs.policyUrl,
    });
    return { state: "unavailable" };
  }

  try {
    const url = `${sfs.policyUrl.replace(/\/$/, "")}?pubkey=${encodeURIComponent(normalized)}`;
    const response = await fetchJsonWithRetry<{
      active?: boolean;
      planId?: string | null;
      allowCompatUpload?: boolean;
    }>(url, "GET", {
      timeoutMs: 3_000,
      retries: 2,
      retryOnStatus: [408, 425, 429, 502, 503, 504],
      requestId: options?.requestId,
      headers: {
        "x-internal-secret": sfs.internalSecret,
      },
    });

    if (!response.ok || !response.data) {
      log.warn("Policy check failed: non-OK response", {
        status: response.status || 0,
        pubkeyLength: normalized.length,
      });
      return { state: "unavailable" };
    }

    const data = response.data;
    const allow = data.allowCompatUpload === true;
    const result: CompatPolicyResult = allow
      ? {
          state: "allow",
          active: data.active,
          planId: data.planId ?? null,
          allowCompatUpload: true,
        }
      : {
          state: "deny_free_or_inactive",
          active: data.active,
          planId: data.planId ?? null,
          allowCompatUpload: false,
        };

    const ttlMs = Math.max(1, sfs.policyCacheTtlSec) * 1000;
    policyCache.set(normalized, { expiresAtMs: now + ttlMs, result });
    return result;
  } catch (error) {
    log.warn("Policy check failed: fetch error", {
      err: error instanceof Error ? error.message : String(error),
      pubkeyLength: normalized.length,
    });
    return { state: "unavailable" };
  }
}
