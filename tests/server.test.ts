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

  it("does not trust spoofed x-forwarded-for for metrics allowlist", async () => {
    const mod = await import("../src/server");
    const req = {
      headers: { "x-forwarded-for": "203.0.113.9" },
      ip: "10.0.0.2",
    } as unknown as express.Request;
    const allowed = mod.isMetricsRequestAllowed(
      req,
      "ignored-token",
      ["203.0.113.9"],
      "production"
    );
    expect(allowed).toBe(false);
  });

  it("allows request with no origin for CORS checks", async () => {
    const mod = await import("../src/server");
    expect(mod.isCorsOriginAllowed(undefined, ["https://app.example"])).toBe(
      true
    );
  });

  it("allows explicit origin in CORS allowlist", async () => {
    const mod = await import("../src/server");
    expect(
      mod.isCorsOriginAllowed("https://app.example", [
        "https://app.example",
        "https://admin.example",
      ])
    ).toBe(true);
  });

  it("denies explicit origin outside CORS allowlist", async () => {
    const mod = await import("../src/server");
    expect(
      mod.isCorsOriginAllowed("https://evil.example", ["https://app.example"])
    ).toBe(false);
  });

  it("allows explicit origin when CORS allowlist is empty", async () => {
    const mod = await import("../src/server");
    expect(mod.isCorsOriginAllowed("https://app.example", [])).toBe(true);
  });

  it("allows explicit origin when CORS allowlist contains wildcard", async () => {
    const mod = await import("../src/server");
    expect(mod.isCorsOriginAllowed("https://app.example", ["*"])).toBe(true);
  });
});
