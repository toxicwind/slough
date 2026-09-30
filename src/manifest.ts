#!/usr/bin/env bun
/**
 * molt — SQLite incremental manifest.
 *
 * Records every pulled file (path, size, mtime). The next run skips files
 * whose size AND mtime are unchanged — incremental by default, no flags.
 *
 * Schema:
 *   files(path PK, size, mtime, hash, pulled_at)
 *   pulls(id, started_at, completed_at, source_dir, files, bytes, status)
 */

import { Database } from "bun:sqlite";

export class ManifestDB {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        hash TEXT,
        pulled_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pulls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        source_dir TEXT NOT NULL,
        files INTEGER DEFAULT 0,
        bytes INTEGER DEFAULT 0,
        status TEXT DEFAULT 'running'
      );
      CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(mtime);
    `);
  }

  recordFile(path: string, size: number, mtime: number, hash?: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO files (path, size, mtime, hash, pulled_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(path, size, mtime, hash ?? null, Date.now());
  }

  needsPull(path: string, size: number, mtime: number): boolean {
    const row = this.db
      .prepare("SELECT size, mtime FROM files WHERE path = ?")
      .get(path) as { size: number; mtime: number } | null;
    if (!row) return true;
    return row.size !== size || row.mtime !== mtime;
  }

  /** Files recorded for a source dir — used by verify. */
  filesForDir(dir: string): { path: string; size: number }[] {
    return this.db
      .prepare("SELECT path, size FROM files WHERE path = ? OR path LIKE ?")
      .all(dir, `${dir}/%`) as { path: string; size: number }[];
  }

  startPull(sourceDir: string): number {
    const r = this.db
      .prepare("INSERT INTO pulls (started_at, source_dir) VALUES (?, ?)")
      .run(Date.now(), sourceDir);
    return Number(r.lastInsertRowid);
  }

  finishPull(id: number, files: number, bytes: number, status = "ok"): void {
    this.db
      .prepare(
        "UPDATE pulls SET completed_at = ?, files = ?, bytes = ?, status = ? WHERE id = ?"
      )
      .run(Date.now(), files, bytes, status, id);
  }

  close(): void {
    this.db.close();
  }
}
