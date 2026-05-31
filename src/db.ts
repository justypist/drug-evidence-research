import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";

export interface AppDatabase {
  sqlite: SqliteDatabase;
  close: () => void;
}

export function openDatabase(databasePath: string): AppDatabase {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite);
  return {
    sqlite,
    close: () => sqlite.close(),
  };
}

export function migrate(sqlite: SqliteDatabase): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')),
      input_json TEXT NOT NULL,
      output_dir TEXT NOT NULL,
      error_message TEXT,
      locked_by TEXT,
      locked_until TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status_lock
      ON tasks(status, locked_until, created_at);

    CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(task_id, seq)
    );

    CREATE INDEX IF NOT EXISTS idx_task_events_task_seq
      ON task_events(task_id, seq);
  `);
  addColumnIfMissing(sqlite, "tasks", "failure_retryable", "INTEGER NOT NULL DEFAULT 1");
}

function addColumnIfMissing(sqlite: SqliteDatabase, tableName: string, columnName: string, definition: string): void {
  const rows = sqlite.prepare(`PRAGMA table_info(${tableName})`).all<{ name: string }>();
  if (rows.some((row) => row.name === columnName)) {
    return;
  }
  sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}
