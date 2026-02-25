import { setTimeout as sleep } from "timers/promises";

import { log } from "../logger.js";

export interface RetryFetchOptions {
  timeoutMs: number;
  retries: number;
  retryBaseDelayMs?: number;
  retryOnStatus?: number[];
  headers?: Record<string, string>;
  body?: string;
  requestId?: string;
}

function shouldRetryStatus(status: number, retryOnStatus: number[]): boolean {
  return retryOnStatus.includes(status) || status >= 500;
}

function computeBackoffMs(baseDelayMs: number, attempt: number): number {
  const jitter = Math.floor(Math.random() * 100);
  return Math.min(5_000, baseDelayMs * 2 ** attempt) + jitter;
}

export async function fetchJsonWithRetry<T>(
  url: string,
  method: "GET" | "POST",
  options: RetryFetchOptions
): Promise<{
  ok: boolean;
  status: number;
  data?: T;
}> {
  const retryOnStatus = options.retryOnStatus ?? [408, 425, 429];
  const baseDelayMs = options.retryBaseDelayMs ?? 200;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const headers = {
        ...(options.headers ?? {}),
        ...(options.requestId ? { "x-request-id": options.requestId } : {}),
      };
      const response = await fetch(url, {
        method,
        headers,
        body: options.body,
        signal: controller.signal,
      });
      if (!response.ok) {
        if (
          attempt < options.retries &&
          shouldRetryStatus(response.status, retryOnStatus)
        ) {
          await sleep(computeBackoffMs(baseDelayMs, attempt));
          continue;
        }
        return { ok: false, status: response.status };
      }

      const contentType =
        typeof response.headers?.get === "function"
          ? response.headers.get("content-type")
          : undefined;
      if (
        contentType?.includes("application/json") ||
        typeof response.json === "function"
      ) {
        const data = (await response.json()) as T;
        return { ok: true, status: response.status, data };
      }
      return { ok: true, status: response.status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isAbort =
        error instanceof DOMException && error.name === "AbortError";
      if (attempt >= options.retries) {
        log.warn("HTTP fetch failed after retries", {
          url,
          method,
          attempt,
          isAbort,
          err: message,
        });
        return { ok: false, status: 0 };
      }
      await sleep(computeBackoffMs(baseDelayMs, attempt));
    } finally {
      clearTimeout(timeout);
    }
  }

  return { ok: false, status: 0 };
}
