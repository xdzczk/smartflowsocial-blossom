import { describe, it, expect } from "vitest";
import type express from "express";

describe("server", () => {
  it("exports start as a function", async () => {
    const mod = await import("../src/server");
    expect(typeof mod.start).toBe("function");
  });

  it("denies metrics by default in production when no token/allowlist", async () => {
    const mod = await import("../src/server");
    const req = { headers: {}, ip: "127.0.0.1" } as express.Request;
    const allowed = mod.isMetricsRequestAllowed(req, "", [], "production");
    expect(allowed).toBe(false);
  });

  it("allows metrics by default in test env when no token/allowlist", async () => {
    const mod = await import("../src/server");
    const req = { headers: {}, ip: "127.0.0.1" } as express.Request;
    const allowed = mod.isMetricsRequestAllowed(req, "", [], "test");
    expect(allowed).toBe(true);
  });

  it("allows metrics with valid token", async () => {
    const mod = await import("../src/server");
    const req = {
      headers: { "x-metrics-token": "secret" },
      ip: "10.0.0.1",
    } as unknown as express.Request;
    const allowed = mod.isMetricsRequestAllowed(
      req,
      "secret",
      [],
      "production"
    );
    expect(allowed).toBe(true);
  });

  it("allows metrics with allowlisted IP", async () => {
    const mod = await import("../src/server");
    const req = { headers: {}, ip: "10.0.0.1" } as express.Request;
    const allowed = mod.isMetricsRequestAllowed(
      req,
      "ignored-token",
      ["10.0.0.1"],
      "production"
    );
    expect(allowed).toBe(true);
  });
});
