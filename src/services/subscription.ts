import { loadConfig } from "../config.js";
import { log } from "../logger.js";

import { fetchJsonWithRetry } from "./http-client.js";

export async function verifySubscription(pubkey: string): Promise<boolean> {
  const { sfs } = loadConfig();
  if (!sfs.internalUrl || !sfs.internalSecret) {
    log.warn(
      "Subscription check skipped: SFS_INTERNAL_URL or SFS_INTERNAL_SECRET not set",
      {
        hasUrl: !!sfs.internalUrl,
        hasSecret: !!sfs.internalSecret,
      }
    );
    return false;
  }
  const url = `${sfs.internalUrl.replace(/\/$/, "")}/internal/subscription-status?pubkey=${encodeURIComponent(pubkey)}`;
  try {
    const res = await fetchJsonWithRetry<{ active?: boolean }>(url, "GET", {
      timeoutMs: 3_000,
      retries: 2,
      retryOnStatus: [408, 425, 429, 502, 503, 504],
      headers: {
        "x-internal-secret": sfs.internalSecret,
      },
    });
    if (!res.ok || !res.data) {
      log.warn("Subscription check failed: SFS returned non-OK status", {
        status: res.status,
        pubkeyLength: pubkey.length,
      });
      return false;
    }
    const data = res.data;
    if (data.active !== true) {
      log.info("Subscription check: SFS returned active false or missing", {
        active: data.active,
        pubkeyLength: pubkey.length,
      });
      return false;
    }
    return true;
  } catch (err) {
    log.warn("Subscription check failed: fetch error", {
      err: err instanceof Error ? err.message : String(err),
      pubkeyLength: pubkey.length,
    });
    return false;
  }
}
