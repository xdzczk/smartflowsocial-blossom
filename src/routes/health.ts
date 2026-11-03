import express from "express";

import { loadConfig } from "../config.js";
import { fetchJsonWithRetry } from "../services/http-client.js";
import { headObject } from "../services/storage.js";
import type { AppInstance } from "../types.js";

export function createHealthRouter(
  app: express.Application & AppInstance
): express.Router {
  const router = express.Router();
  router.get("/health", (_req, res) => {
    res.status(200).send("OK");
  });

  router.get("/ready", (_req, res) => {
    void (async () => {
      const config = loadConfig();
      const checks: Record<string, unknown> = {
        db: app.db.ping(),
        storage: false,
        pendingCommits: app.db.countRetryableUncommitted(),
        deadLetterCommits: app.db.countDeadLetterUncommitted(),
        policy: "not_configured",
      };

      if (config.nodeEnv === "test") {
        checks["storage"] = true;
      } else {
        try {
          await headObject("__readiness_probe__");
          checks["storage"] = true;
        } catch {
          checks["storage"] = false;
        }
      }

      if (config.sfs.policyUrl && config.sfs.internalSecret) {
        const response = await fetchJsonWithRetry<unknown>(
          `${config.sfs.policyUrl.replace(/\/$/, "")}?pubkey=readiness_probe`,
          "GET",
          {
            timeoutMs: 1_500,
            retries: 0,
            headers: {
              "x-internal-secret": config.sfs.internalSecret,
            },
          }
        );
        checks["policy"] = response.ok ? "ok" : "unavailable";
      }

      const pendingCommits = checks["pendingCommits"] as number;
      const deadLetterCommits = checks["deadLetterCommits"] as number;
      const ready =
        checks["db"] === true &&
        checks["storage"] === true &&
        pendingCommits <= config.sfs.readinessMaxPendingCommits &&
        deadLetterCommits <= config.sfs.readinessMaxDeadLetterCommits &&
        checks["policy"] !== "unavailable";

      if (ready) {
        res.status(200).json({ status: "ready", checks });
        return;
      }

      res.status(503).json({ status: "not_ready", checks });
    })();
  });
  return router;
}
