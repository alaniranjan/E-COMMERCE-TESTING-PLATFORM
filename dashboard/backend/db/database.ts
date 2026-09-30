import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from '../paths.ts';

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS runs (
    id                TEXT PRIMARY KEY,
    created_at        TEXT NOT NULL,
    finished_at       TEXT,
    suite             TEXT NOT NULL,
    browser           TEXT NOT NULL,
    environment       TEXT NOT NULL,
    base_url          TEXT NOT NULL,
    status            TEXT NOT NULL,
    total             INTEGER NOT NULL DEFAULT 0,
    passed            INTEGER NOT NULL DEFAULT 0,
    failed            INTEGER NOT NULL DEFAULT 0,
    skipped           INTEGER NOT NULL DEFAULT 0,
    flaky             INTEGER NOT NULL DEFAULT 0,
    duration_ms       INTEGER NOT NULL DEFAULT 0,
    ai_analysis_count INTEGER NOT NULL DEFAULT 0,
    exit_code         INTEGER,
    error_message     TEXT,
    report_url        TEXT
  );

  CREATE TABLE IF NOT EXISTS test_results (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    full_title      TEXT NOT NULL,
    file            TEXT NOT NULL,
    line            INTEGER,
    browser         TEXT NOT NULL,
    status          TEXT NOT NULL,
    duration_ms     INTEGER NOT NULL DEFAULT 0,
    retries         INTEGER NOT NULL DEFAULT 0,
    tags            TEXT NOT NULL DEFAULT '[]',
    error_message   TEXT,
    error_stack     TEXT,
    screenshot_url  TEXT,
    video_url       TEXT,
    trace_url       TEXT,
    trace_path      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_test_results_run ON test_results(run_id);
  CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);
`);

/** Additive migrations for databases created by earlier versions. */
function addColumnIfMissing(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumnIfMissing('runs', 'allure_url', 'TEXT');
