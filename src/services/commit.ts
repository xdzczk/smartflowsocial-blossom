import { loadConfig } from "../config.js";
import { log } from "../logger.js";
import type { AppInstance } from "../types.js";

interface CommitItem {
  jti: string;
  pubkey: string;
  sha256: string;
  size: number;
  type: string;
  url: string;
}

interface BufferedItem {
  batchId: string;
  item: CommitItem;
}

let buffer: BufferedItem[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

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

  try {
    const response = await fetch(cfg.sfs.commitBatchUrl, {
      method: "POST",
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

    const data = (await response.json()) as {
      statuses?: Array<{ jti: string; status: string }>;
    };
    const failedJtis =
      data.statuses
        ?.filter((s) => s.status === "failed")
        .map((s) => s.jti)
        .filter(Boolean) ?? [];
    return { ok: true, failedJtis };
  } catch (error) {
    log.warn("Commit-batch request failed", {
      err: error instanceof Error ? error.message : String(error),
      batchId,
      items: items.length,
    });
    return { ok: false, failedJtis: items.map((i) => i.jti) };
  }
}

async function flushInternal(app: AppInstance): Promise<void> {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  try {
    const cfg = loadConfig();
    while (buffer.length > 0) {
      const chunk = buffer.splice(0, cfg.sfs.commitBatchSize);
      const grouped = new Map<string, CommitItem[]>();
      for (const entry of chunk) {
        const list = grouped.get(entry.batchId) ?? [];
        list.push(entry.item);
        grouped.set(entry.batchId, list);
      }

      for (const [batchId, items] of grouped.entries()) {
        const result = await sendCommitBatch(batchId, items);
        if (!result.ok) {
          for (const item of items) {
            app.db.enqueueUncommitted({
              jti: item.jti,
              batchId,
              pubkey: item.pubkey,
              sha256: item.sha256,
              size: item.size,
              type: item.type,
              url: item.url,
            });
          }
          continue;
        }

        if (result.failedJtis.length > 0) {
          const failedSet = new Set(result.failedJtis);
          for (const item of items) {
            if (!failedSet.has(item.jti)) continue;
            app.db.enqueueUncommitted({
              jti: item.jti,
              batchId,
              pubkey: item.pubkey,
              sha256: item.sha256,
              size: item.size,
              type: item.type,
              url: item.url,
            });
          }
        }
      }
    }
  } finally {
    flushing = false;
  }
}

export function enqueueCommitItem(
  app: AppInstance,
  batchId: string,
  item: CommitItem
): void {
  buffer.push({ batchId, item });
  const cfg = loadConfig();
  if (buffer.length >= cfg.sfs.commitBatchSize) {
    void flushInternal(app);
    return;
  }
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushInternal(app);
    }, cfg.sfs.commitFlushMs);
    flushTimer.unref();
  }
}

export function flushCommitBuffer(app: AppInstance): Promise<void> {
  return flushInternal(app);
}

export function startCommitReconciliation(
  app: AppInstance
): ReturnType<typeof setInterval> {
  const interval = setInterval(() => {
    void (async () => {
      app.db.cleanupExpiredJti();
      const pending = app.db.listRetryableUncommitted();
      if (pending.length === 0) return;

      const grouped = new Map<string, typeof pending>();
      for (const row of pending) {
        const list = grouped.get(row.batchId) ?? [];
        list.push(row);
        grouped.set(row.batchId, list);
      }

      for (const [batchId, rows] of grouped.entries()) {
        const items: CommitItem[] = rows.map((row) => ({
          jti: row.jti,
          pubkey: row.pubkey,
          sha256: row.sha256,
          size: row.size,
          type: row.type,
          url: row.url,
        }));
        const result = await sendCommitBatch(batchId, items);
        const failedSet = new Set(result.failedJtis);
        for (const row of rows) {
          if (result.ok && !failedSet.has(row.jti)) {
            app.db.markUncommittedSuccess(row.id);
            continue;
          }
          const backoffSec = Math.min(
            900,
            Math.max(30, 2 ** (row.attempts + 1))
          );
          app.db.markUncommittedFailure(
            row.id,
            Math.floor(Date.now() / 1000) + backoffSec
          );
        }
      }
    })();
  }, 60_000);
  interval.unref();
  return interval;
}
