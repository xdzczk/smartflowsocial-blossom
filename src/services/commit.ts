import { loadConfig } from "../config.js";
import { log } from "../logger.js";
import type { AppInstance } from "../types.js";

import { fetchJsonWithRetry } from "./http-client.js";
import { incrementCounter } from "./telemetry.js";

interface CommitItem {
  jti: string;
  pubkey: string;
  sha256: string;
  size: number;
  type: string;
  url: string;
}

let flushing = false;
let reconciling = false;

async function sendCommitBatch(
  batchId: string,
  items: CommitItem[]
): Promise<{
  ok: boolean;
  failedJtis: string[];
}> {
  const cfg = loadConfig();
  if (!cfg.sfs.commitBatchUrl || !cfg.sfs.internalSecret) {
    return { ok: false, failedJtis: items.map((i) => i.jti) };
  }

  const response = await fetchJsonWithRetry<{
    statuses?: Array<{ jti: string; status: string }>;
  }>(cfg.sfs.commitBatchUrl, "POST", {
    timeoutMs: 4_000,
    retries: 2,
    retryOnStatus: [408, 425, 429, 502, 503, 504],
    headers: {
      "content-type": "application/json",
      "x-internal-secret": cfg.sfs.internalSecret,
    },
    body: JSON.stringify({
      batchId,
      items,
    }),
  });
  if (!response.ok) {
    return { ok: false, failedJtis: items.map((i) => i.jti) };
  }

  const data = response.data;
  const failedJtis =
    data?.statuses
      ?.filter((s) => s.status === "failed")
      .map((s) => s.jti)
      .filter(Boolean) ?? [];
  return { ok: true, failedJtis };
}

async function flushPendingUncommitted(
  app: AppInstance,
  batchSize: number
): Promise<number> {
  const commitMaxAttempts = Math.max(1, loadConfig().sfs.commitMaxAttempts);
  const safeBatchSize = Math.max(1, batchSize);
  const pending = app.db.listRetryableUncommitted(
    Math.floor(Date.now() / 1000),
    Math.max(safeBatchSize * 10, 100)
  );
  if (pending.length === 0) return 0;

  const grouped = new Map<string, typeof pending>();
  for (const row of pending) {
    const list = grouped.get(row.batchId) ?? [];
    list.push(row);
    grouped.set(row.batchId, list);
  }

  let processed = 0;
  for (const [batchId, rows] of grouped.entries()) {
    for (let idx = 0; idx < rows.length; idx += safeBatchSize) {
      const chunk = rows.slice(idx, idx + safeBatchSize);
      const items: CommitItem[] = chunk.map((row) => ({
        jti: row.jti,
        pubkey: row.pubkey,
        sha256: row.sha256,
        size: row.size,
        type: row.type,
        url: row.url,
      }));
      const result = await sendCommitBatch(batchId, items);
      const failedSet = new Set(result.failedJtis);
      for (const row of chunk) {
        processed += 1;
        if (result.ok && !failedSet.has(row.jti)) {
          app.db.markUncommittedSuccess(row.id);
          continue;
        }
        const failureReason = result.ok
          ? "upstream_reported_failed"
          : "upstream_request_failed";
        const nextAttempt = row.attempts + 1;
        if (nextAttempt >= commitMaxAttempts) {
          app.db.markUncommittedDeadLetter(row.id, failureReason);
          incrementCounter("gateway_commit_dead_letter_total", {
            reason: failureReason,
          });
          continue;
        }
        const backoffSec = Math.min(900, Math.max(30, 2 ** (row.attempts + 1)));
        app.db.markUncommittedFailure(
          row.id,
          Math.floor(Date.now() / 1000) + backoffSec,
          failureReason
        );
      }
    }
  }

  return processed;
}

async function flushInternal(app: AppInstance): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const cfg = loadConfig();
    while (true) {
      const processed = await flushPendingUncommitted(
        app,
        cfg.sfs.commitBatchSize
      );
      if (processed === 0) break;
    }
  } catch (error) {
    log.warn("Commit flush failed", {
      err: error instanceof Error ? error.message : String(error),
    });
  } finally {
    flushing = false;
  }
}

export function enqueueCommitItem(
  app: AppInstance,
  batchId: string,
  item: CommitItem
): void {
  app.db.enqueueUncommitted({
    jti: item.jti,
    batchId,
    pubkey: item.pubkey,
    sha256: item.sha256,
    size: item.size,
    type: item.type,
    url: item.url,
  });
  void flushInternal(app);
}

export function flushCommitBuffer(app: AppInstance): Promise<void> {
  return flushInternal(app);
}

async function runReconciliationTick(app: AppInstance): Promise<void> {
  if (reconciling) {
    log.warn("Commit reconciliation already running; skipping tick");
    return;
  }
  reconciling = true;
  try {
    app.db.cleanupExpiredJti();
    const pending = app.db.listRetryableUncommitted();
    log.info("Commit reconciliation tick", { pendingCount: pending.length });
    if (pending.length === 0) return;
    await flushInternal(app);
  } finally {
    reconciling = false;
  }
}

export function startCommitReconciliation(
  app: AppInstance
): ReturnType<typeof setInterval> {
  const interval = setInterval(() => {
    void runReconciliationTick(app);
  }, 60_000);
  interval.unref();
  return interval;
}
