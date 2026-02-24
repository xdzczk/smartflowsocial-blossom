import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import Database from "../../src/services/db.js";

let dbWorks = false;
try {
  const dir = path.join(os.tmpdir(), `vibe-cdn-db-probe-${Date.now()}`);
  const probe = new Database({ dbPath: dir });
  probe.close();
  dbWorks = true;
} catch {
  // better-sqlite3 native bindings not available (e.g. in some CI)
}

describe.skipIf(!dbWorks)("Database", () => {
  let db: Database;
  let dbDir: string;

  beforeEach(() => {
    dbDir = path.join(
      os.tmpdir(),
      `vibe-cdn-db-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    db = new Database({ dbPath: dbDir });
  });

  afterEach(() => {
    db.close();
  });

  it("creates a blob and returns key and created", () => {
    const out = db.createBlob({
      key: "abc123.jpg",
      pubkey: "pubkey1",
      type: "image/jpeg",
      size: 100,
    });
    expect(out.key).toBe("abc123.jpg");
    expect(out.created).toBeGreaterThan(0);
  });

  it("getBlobByKey returns the blob after create", () => {
    db.createBlob({
      key: "key1.png",
      pubkey: "pk",
      type: "image/png",
      size: 200,
    });
    const row = db.getBlobByKey("key1.png");
    expect(row).not.toBeNull();
    expect(row?.key).toBe("key1.png");
    expect(row?.pubkey).toBe("pk");
    expect(row?.type).toBe("image/png");
    expect(row?.size).toBe(200);
    expect(row?.created).toBeGreaterThan(0);
  });

  it("getBlobByKey returns null for missing key", () => {
    expect(db.getBlobByKey("nonexistent")).toBeNull();
  });

  it("createBlob is idempotent (INSERT OR IGNORE)", () => {
    db.createBlob({
      key: "idem.jpg",
      pubkey: "p",
      type: "image/jpeg",
      size: 1,
    });
    const first = db.getBlobByKey("idem.jpg")?.created ?? 0;
    db.createBlob({
      key: "idem.jpg",
      pubkey: "p",
      type: "image/jpeg",
      size: 1,
    });
    const second = db.getBlobByKey("idem.jpg")?.created ?? 0;
    expect(first).toBe(second);
  });

  it("deleteBlob removes only when key and pubkey match", () => {
    db.createBlob({
      key: "del.key",
      pubkey: "owner1",
      type: "image/jpeg",
      size: 10,
    });
    expect(db.deleteBlob("del.key", "owner2")).toBe(false);
    expect(db.getBlobByKey("del.key")).not.toBeNull();
    expect(db.deleteBlob("del.key", "owner1")).toBe(true);
    expect(db.getBlobByKey("del.key")).toBeNull();
  });
});
