import path from "path";

import Sqlite3 from "better-sqlite3";

const DB_NAME = "blossom";

export interface BlobRow {
  key: string;
  pubkey: string;
  type: string;
  size: number;
  created: number;
}

export interface UncommittedRow {
  id: number;
  jti: string;
  batchId: string;
  pubkey: string;
  sha256: string;
  size: number;
  type: string;
  url: string;
  attempts: number;
  nextRetryAt: number;
  status: "pending" | "dead_letter";
  lastError: string | null;
  failedAt: number | null;
  created: number;
  updated: number;
}

export interface CompatUploadRow {
  id: number;
  pubkey: string;
  sha256: string;
  size: number;
  type: string;
  url: string;
  created: number;
}

export interface DatabaseOptions {
  dbPath: string;
  nativeBindingsPath?: string;
}

class Database {
  db: Sqlite3.Database;

  constructor(options: DatabaseOptions) {
    const mainPath = path.join(options.dbPath, `${DB_NAME}.db`);
    const nativeBinding = options.nativeBindingsPath
      ? path.join(
          options.nativeBindingsPath,
          `${process.arch === "arm64" ? "arm64" : "x64"}/better_sqlite3.node`
        )
      : undefined;
    this.db = new Sqlite3(mainPath, { nativeBinding });
    this.db.pragma("journal_mode = WAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blobs (
        key TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL,
        type TEXT NOT NULL,
        size INTEGER NOT NULL,
        created INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_blobs_pubkey ON blobs(pubkey);
      CREATE INDEX IF NOT EXISTS idx_blobs_pubkey_created ON blobs(pubkey, created);
      CREATE TABLE IF NOT EXISTS used_jti (
        jti TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL,
        expires INTEGER NOT NULL,
        created INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_used_jti_expires ON used_jti(expires);
      CREATE TABLE IF NOT EXISTS uncommitted_uploads (
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
        status TEXT NOT NULL DEFAULT 'pending',
        last_error TEXT,
        failed_at INTEGER,
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_uncommitted_retry ON uncommitted_uploads(next_retry_at);
      CREATE TABLE IF NOT EXISTS compat_uploads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pubkey TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size INTEGER NOT NULL,
        type TEXT NOT NULL,
        url TEXT NOT NULL,
        created INTEGER NOT NULL,
        UNIQUE(pubkey, sha256, url)
      );
      CREATE INDEX IF NOT EXISTS idx_compat_uploads_pubkey_created ON compat_uploads(pubkey, created);
    `);
    this.ensureColumnExists(
      "uncommitted_uploads",
      "status",
      "TEXT NOT NULL DEFAULT 'pending'"
    );
    this.ensureColumnExists("uncommitted_uploads", "last_error", "TEXT");
    this.ensureColumnExists("uncommitted_uploads", "failed_at", "INTEGER");
  }

  private ensureColumnExists(
    tableName: string,
    columnName: string,
    columnDef: string
  ): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name?: string }>;
    if (columns.some((c) => c.name === columnName)) {
      return;
    }
    this.db.exec(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`
    );
  }

  createBlob(params: {
    key: string;
    pubkey: string;
    type: string;
    size: number;
  }): { key: string; created: number } {
    const created = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO blobs (key, pubkey, type, size, created) VALUES (?, ?, ?, ?, ?)`
      )
      .run([params.key, params.pubkey, params.type, params.size, created]);
    return { key: params.key, created };
  }

  getBlobByKey(key: string): BlobRow | null {
    const row = this.db
      .prepare(
        `SELECT key, pubkey, type, size, created FROM blobs WHERE key = ?`
      )
      .get(key) as BlobRow | undefined;
    return row ?? null;
  }

  getStoredBytes(pubkey: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(size), 0) as bytes
         FROM blobs
         WHERE pubkey = ?`
      )
      .get(pubkey) as { bytes?: number } | undefined;
    return row?.bytes ?? 0;
  }

  getUploadedBytesSince(pubkey: string, createdAfter: number): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(size), 0) as bytes
         FROM blobs
         WHERE pubkey = ? AND created >= ?`
      )
      .get(pubkey, createdAfter) as { bytes?: number } | undefined;
    return row?.bytes ?? 0;
  }

  deleteBlob(key: string, pubkey: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM blobs WHERE key = ? AND pubkey = ?`)
      .run(key, pubkey);
    return result.changes > 0;
  }

  /** Internal/admin delete by key only (used by trusted SFS internal API). */
  deleteBlobByKey(key: string): boolean {
    const result = this.db.prepare(`DELETE FROM blobs WHERE key = ?`).run(key);
    return result.changes > 0;
  }

  /** Returns true if the database is open and responsive (for readiness checks). */
  ping(): boolean {
    try {
      this.db.prepare("SELECT 1").get();
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.db.close();
  }

  markJtiUsed(params: {
    jti: string;
    pubkey: string;
    expires: number;
  }): boolean {
    const created = Math.floor(Date.now() / 1000);
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO used_jti (jti, pubkey, expires, created) VALUES (?, ?, ?, ?)`
      )
      .run(params.jti, params.pubkey, params.expires, created);
    return result.changes > 0;
  }

  cleanupExpiredJti(now = Math.floor(Date.now() / 1000)): number {
    const result = this.db
      .prepare(`DELETE FROM used_jti WHERE expires <= ?`)
      .run(now);
    return result.changes;
  }

  enqueueUncommitted(params: {
    jti: string;
    batchId: string;
    pubkey: string;
    sha256: string;
    size: number;
    type: string;
    url: string;
  }): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `INSERT INTO uncommitted_uploads
          (jti, batch_id, pubkey, sha256, size, type, url, attempts, next_retry_at, status, last_error, failed_at, created, updated)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending', NULL, NULL, ?, ?)
          ON CONFLICT(jti) DO NOTHING`
      )
      .run(
        params.jti,
        params.batchId,
        params.pubkey,
        params.sha256,
        params.size,
        params.type,
        params.url,
        now,
        now,
        now
      );
  }

  listRetryableUncommitted(
    now = Math.floor(Date.now() / 1000),
    limit = 100
  ): UncommittedRow[] {
    return this.db
      .prepare(
        `SELECT id, jti, batch_id as batchId, pubkey, sha256, size, type, url, attempts, next_retry_at as nextRetryAt, created, updated
         , status, last_error as lastError, failed_at as failedAt
         FROM uncommitted_uploads
         WHERE next_retry_at <= ? AND status = 'pending'
         ORDER BY id ASC
         LIMIT ?`
      )
      .all(now, limit) as UncommittedRow[];
  }

  countRetryableUncommitted(now = Math.floor(Date.now() / 1000)): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(1) as count
         FROM uncommitted_uploads
         WHERE next_retry_at <= ? AND status = 'pending'`
      )
      .get(now) as { count?: number } | undefined;
    return row?.count ?? 0;
  }

  countDeadLetterUncommitted(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(1) as count
         FROM uncommitted_uploads
         WHERE status = 'dead_letter'`
      )
      .get() as { count?: number } | undefined;
    return row?.count ?? 0;
  }

  markUncommittedSuccess(id: number): void {
    this.db.prepare(`DELETE FROM uncommitted_uploads WHERE id = ?`).run(id);
  }

  markUncommittedFailure(
    id: number,
    nextRetryAt: number,
    lastError?: string
  ): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `UPDATE uncommitted_uploads
         SET attempts = attempts + 1, next_retry_at = ?, last_error = ?, updated = ?
         WHERE id = ?`
      )
      .run(nextRetryAt, lastError ?? null, now, id);
  }

  markUncommittedDeadLetter(id: number, lastError?: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `UPDATE uncommitted_uploads
         SET attempts = attempts + 1, status = 'dead_letter', failed_at = ?, last_error = ?, updated = ?
         WHERE id = ?`
      )
      .run(now, lastError ?? null, now, id);
  }

  createCompatUpload(params: {
    pubkey: string;
    sha256: string;
    size: number;
    type: string;
    url: string;
  }): void {
    const created = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO compat_uploads (pubkey, sha256, size, type, url, created)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.pubkey,
        params.sha256,
        params.size,
        params.type,
        params.url,
        created
      );
  }

  listCompatUploads(pubkey: string, limit = 100): CompatUploadRow[] {
    return this.db
      .prepare(
        `SELECT id, pubkey, sha256, size, type, url, created
         FROM compat_uploads
         WHERE pubkey = ?
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(pubkey, limit) as CompatUploadRow[];
  }

  getCompatUsageSince(
    pubkey: string,
    createdAfter: number
  ): { uploads: number; bytes: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(1) as uploads, COALESCE(SUM(size), 0) as bytes
         FROM compat_uploads
         WHERE pubkey = ? AND created >= ?`
      )
      .get(pubkey, createdAfter) as
      { uploads?: number; bytes?: number } | undefined;
    return {
      uploads: row?.uploads ?? 0,
      bytes: row?.bytes ?? 0,
    };
  }
}

export default Database;
