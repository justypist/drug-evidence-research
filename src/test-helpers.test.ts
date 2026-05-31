import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "#db.ts";
import type { Clock } from "#time.ts";
import { TaskStore } from "#task-store.ts";

export class ManualClock implements Clock {
  private value: Date;

  constructor(initial: string = "2026-05-31T00:00:00.000Z") {
    this.value = new Date(initial);
  }

  now(): Date {
    return new Date(this.value);
  }

  advance(milliseconds: number): void {
    this.value = new Date(this.value.getTime() + milliseconds);
  }
}

export interface TestStoreContext {
  tempDir: string;
  store: TaskStore;
  clock: ManualClock;
  cleanup: () => void;
}

export function createTestStore(): TestStoreContext {
  const tempDir = mkdtempSync(join(tmpdir(), "drug-evidence-research-"));
  const database = openDatabase(join(tempDir, "tasks.sqlite"));
  const clock = new ManualClock();
  const store = new TaskStore({
    sqlite: database.sqlite,
    dataDir: join(tempDir, "data"),
    clock,
  });
  return {
    tempDir,
    store,
    clock,
    cleanup: () => {
      database.close();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}
