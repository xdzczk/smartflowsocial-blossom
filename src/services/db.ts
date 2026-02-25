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
    `);
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
}

export default Database;
