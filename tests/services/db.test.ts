import fs from "fs";
import os from "os";
import path from "path";

import Sqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import Database from "../../src/services/db.js";

let dbWorks = false;
try {
  const dir = path.join(os.tmpdir(), `vibe-cdn-db-probe-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
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
    fs.mkdirSync(dbDir, { recursive: true });
    db = new Database({ dbPath: dbDir });
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // A test may already have closed the handle to assert ping fails.
    }
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

  it("tracks stored and recent bytes, and deletes by key", () => {
    db.createBlob({
      key: "a.bin",
      pubkey: "owner",
      type: "image/png",
      size: 40,
    });
    db.createBlob({
      key: "b.bin",
      pubkey: "owner",
      type: "image/png",
      size: 60,
    });
    expect(db.getStoredBytes("owner")).toBe(100);
    expect(db.getStoredBytes("nobody")).toBe(0);
    expect(db.getUploadedBytesSince("owner", 0)).toBe(100);
    expect(
      db.getUploadedBytesSince("owner", Math.floor(Date.now() / 1000) + 10)
    ).toBe(0);
    expect(db.deleteBlobByKey("missing")).toBe(false);
    expect(db.deleteBlobByKey("a.bin")).toBe(true);
    expect(db.getBlobByKey("a.bin")).toBeNull();
  });

  it("answers ping and closes", () => {
    expect(db.ping()).toBe(true);
    db.close();
    expect(db.ping()).toBe(false);
  });

  it("records, ignores, and expires upload jti values", () => {
    expect(db.markJtiUsed({ jti: "j1", pubkey: "pk", expires: 50 })).toBe(true);
    expect(db.markJtiUsed({ jti: "j1", pubkey: "pk", expires: 50 })).toBe(
      false
    );
    expect(db.cleanupExpiredJti(49)).toBe(0);
    expect(db.cleanupExpiredJti(50)).toBe(1);
  });

  it("queues uncommitted uploads and moves them through retry and dead letter", () => {
    db.enqueueUncommitted({
      jti: "jti-1",
      batchId: "batch",
      pubkey: "pk",
      sha256: "aa",
      size: 12,
      type: "image/png",
      url: "https://cdn.example/a",
    });
    db.enqueueUncommitted({
      jti: "jti-1",
      batchId: "batch",
      pubkey: "pk",
      sha256: "aa",
      size: 12,
      type: "image/png",
      url: "https://cdn.example/a",
    });
    const now = Math.floor(Date.now() / 1000) + 5;
    expect(db.countRetryableUncommitted(now)).toBe(1);
    expect(db.countDeadLetterUncommitted()).toBe(0);
    const rows = db.listRetryableUncommitted(now, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.jti).toBe("jti-1");
    db.markUncommittedFailure(rows[0]!.id, now + 30, "upstream");
    const retried = db.listRetryableUncommitted(now + 30, 10);
    expect(retried[0]?.attempts).toBe(1);
    expect(retried[0]?.lastError).toBe("upstream");
    db.markUncommittedFailure(rows[0]!.id, now + 30);
    db.markUncommittedDeadLetter(rows[0]!.id, "gave-up");
    expect(db.countDeadLetterUncommitted()).toBe(1);
    expect(db.listRetryableUncommitted(now + 100, 10)).toHaveLength(0);
    db.markUncommittedSuccess(rows[0]!.id);
    expect(db.countDeadLetterUncommitted()).toBe(0);
  });

  it("stores compatibility uploads and reports usage", () => {
    db.createCompatUpload({
      pubkey: "pk",
      sha256: "bb",
      size: 25,
      type: "video/mp4",
      url: "https://cdn.example/v",
    });
    db.createCompatUpload({
      pubkey: "pk",
      sha256: "bb",
      size: 25,
      type: "video/mp4",
      url: "https://cdn.example/v",
    });
    const listed = db.listCompatUploads("pk", 5);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.size).toBe(25);
    const usage = db.getCompatUsageSince("pk", 0);
    expect(usage).toEqual({ uploads: 1, bytes: 25 });
    expect(
      db.getCompatUsageSince("pk", Math.floor(Date.now() / 1000) + 10)
    ).toEqual({
      uploads: 0,
      bytes: 0,
    });
  });

  it("adds missing columns when opening an older schema", () => {
    const legacyDir = path.join(
      os.tmpdir(),
      `vibe-cdn-legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    fs.mkdirSync(legacyDir, { recursive: true });
    const raw = new Sqlite3(path.join(legacyDir, "blossom.db"));
    raw.exec(`
      CREATE TABLE uncommitted_uploads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jti TEXT NOT NULL UNIQUE,
        batch_id TEXT NOT NULL,
        pubkey TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size INTEGER NOT NULL,
        type TEXT NOT NULL,
        url TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_retry_at INTEGER NOT NULL,
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL
      );
    `);
    raw.close();

    const legacy = new Database({ dbPath: legacyDir });
    legacy.enqueueUncommitted({
      jti: "legacy",
      batchId: "b",
      pubkey: "pk",
      sha256: "cc",
      size: 1,
      type: "image/gif",
      url: "https://cdn.example/old",
    });
    const row = legacy.listRetryableUncommitted(
      Math.floor(Date.now() / 1000) + 5
    )[0];
    expect(row?.status).toBe("pending");
    expect(row?.lastError).toBeNull();
    legacy.close();
  });
});
