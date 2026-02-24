import express from "express";

import type { AppInstance } from "../types.js";

export function createHealthRouter(
  app: express.Application & AppInstance
): express.Router {
  const router = express.Router();
  router.get("/health", (_req, res) => {
    res.status(200).send("OK");
  });
  router.get("/ready", (_req, res) => {
    if (app.db.ping()) {
      res.status(200).end();
    } else {
      res.status(503).end();
    }
  });
  return router;
}
