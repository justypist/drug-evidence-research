import { mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, sep, join } from "node:path";

import type { Database as SqliteDatabase } from "better-sqlite3";

import { addMilliseconds, type Clock, systemClock, toIso } from "#time.ts";
import type {
  OutputFile,
  PublicTask,
  PublicTaskEvent,
  TaskClaim,
  TaskEventRow,
  TaskInput,
  TaskRow,
  TaskStatus,
} from "#types.ts";

export interface TaskStoreOptions {
  sqlite: SqliteDatabase;
  dataDir: string;
  clock?: Clock;
}

export interface CreateTaskOptions {
  id: string;
  input: TaskInput;
}

export interface ClaimTaskOptions {
  workerId: string;
  lockTtlMs: number;
  maxAttempts?: number;
}

export interface ListTasksOptions {
  offset?: number;
  limit?: number;
}

export interface ListTasksResult {
  tasks: PublicTask[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export class TaskStore {
  readonly dataDir: string;
  private readonly sqlite: SqliteDatabase;
  private readonly clock: Clock;

  constructor(options: TaskStoreOptions) {
    this.sqlite = options.sqlite;
    this.dataDir = resolve(options.dataDir);
    this.clock = options.clock ?? systemClock;
    mkdirSync(this.tasksRoot, { recursive: true });
  }

  get tasksRoot(): string {
    return join(this.dataDir, "tasks");
  }

  createTask(options: CreateTaskOptions): PublicTask {
    const createdAt = toIso(this.clock.now());
    const outputDir = this.getTaskOutputDir(options.id);
    mkdirSync(outputDir, { recursive: true });
    mkdirSync(this.getTaskWorkdir(options.id), { recursive: true });
    mkdirSync(this.getTaskSessionDir(options.id), { recursive: true });

    this.sqlite
      .prepare<[string, TaskStatus, string, string, string]>(`
        INSERT INTO tasks (id, status, input_json, output_dir, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(options.id, "queued", JSON.stringify(options.input), outputDir, createdAt);

    this.appendEvent(options.id, "task_created", "Task queued", { input: options.input });
    const task = this.getTaskRow(options.id);
    if (!task) {
      throw new Error(`Task ${options.id} was not created`);
    }
    return toPublicTask(task);
  }

  listTasks(): PublicTask[] {
    const rows = this.sqlite
      .prepare(`
        SELECT *
        FROM tasks
        ORDER BY created_at DESC
      `)
      .all<TaskRow>();
    return rows.map(toPublicTask);
  }

  listTasksPage(options: ListTasksOptions = {}): ListTasksResult {
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const limit = Math.max(1, Math.floor(options.limit ?? 100));
    const totalRow = this.sqlite.prepare("SELECT COUNT(*) AS count FROM tasks").get<{ count: number }>();
    const total = totalRow?.count ?? 0;
    const rows = this.sqlite
      .prepare<[number, number]>(`
        SELECT *
        FROM tasks
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `)
      .all<TaskRow>(limit, offset);
    return {
      tasks: rows.map(toPublicTask),
      total,
      offset,
      limit,
      hasMore: offset + rows.length < total,
    };
  }

  getTask(id: string): PublicTask | null {
    const row = this.getTaskRow(id);
    return row ? toPublicTask(row) : null;
  }

  getTaskRow(id: string): TaskRow | undefined {
    return this.sqlite.prepare<[string]>("SELECT * FROM tasks WHERE id = ?").get<TaskRow>(id);
  }

  appendEvent(taskId: string, type: string, message: string, payload?: unknown): number {
    const now = toIso(this.clock.now());
    const tx = this.sqlite.transaction<[string, string, string, string | null, string], number>(
      (innerTaskId, innerType, innerMessage, payloadJson, createdAt) => {
        const maxSeqRow = this.sqlite
          .prepare<[string]>("SELECT COALESCE(MAX(seq), 0) AS seq FROM task_events WHERE task_id = ?")
          .get<{ seq: number }>(innerTaskId);
        const nextSeq = (maxSeqRow?.seq ?? 0) + 1;
        this.sqlite
          .prepare<[string, number, string, string, string | null, string]>(`
            INSERT INTO task_events (task_id, seq, type, message, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `)
          .run(innerTaskId, nextSeq, innerType, innerMessage, payloadJson, createdAt);
        return nextSeq;
      },
    );
    return tx(taskId, type, message, payload === undefined ? null : JSON.stringify(payload), now);
  }

  listEvents(taskId: string, afterSeq?: number): PublicTaskEvent[] {
    const rows =
      afterSeq === undefined
        ? this.sqlite
            .prepare<[string]>("SELECT * FROM task_events WHERE task_id = ? ORDER BY seq ASC")
            .all<TaskEventRow>(taskId)
        : this.sqlite
            .prepare<[string, number]>("SELECT * FROM task_events WHERE task_id = ? AND seq > ? ORDER BY seq ASC")
            .all<TaskEventRow>(taskId, afterSeq);
    return rows.map(toPublicTaskEvent);
  }

  countClaimableTasks(maxAttempts = 3): number {
    const nowIso = toIso(this.clock.now());
    const row = this.sqlite
      .prepare<[number, number, string]>(`
        SELECT COUNT(*) AS count
        FROM tasks
        WHERE (
            status = 'queued'
            OR (status = 'running' AND attempt_count < ?)
            OR (status = 'failed' AND failure_retryable = 1 AND attempt_count < ?)
          )
          AND (locked_until IS NULL OR locked_until <= ?)
      `)
      .get<{ count: number }>(maxAttempts, maxAttempts, nowIso);
    return row?.count ?? 0;
  }

  claimNextTask(options: ClaimTaskOptions): TaskClaim | null {
    const now = this.clock.now();
    const nowIso = toIso(now);
    const lockedUntil = toIso(addMilliseconds(now, options.lockTtlMs));
    const tx = this.sqlite.transaction<[], TaskRow | null>(() => {
      const candidate = this.sqlite
        .prepare<[number, number, string]>(`
          SELECT *
          FROM tasks
          WHERE (
              status = 'queued'
              OR (status = 'running' AND attempt_count < ?)
              OR (status = 'failed' AND failure_retryable = 1 AND attempt_count < ?)
            )
            AND (locked_until IS NULL OR locked_until <= ?)
          ORDER BY created_at ASC
          LIMIT 1
        `)
        .get<TaskRow>(options.maxAttempts ?? 3, options.maxAttempts ?? 3, nowIso);
      if (!candidate) {
        return null;
      }
      const updateResult = this.sqlite
        .prepare<[TaskStatus, string, string, string, string, string]>(`
          UPDATE tasks
          SET status = ?,
              locked_by = ?,
              locked_until = ?,
              attempt_count = attempt_count + 1,
              failure_retryable = 1,
              started_at = COALESCE(started_at, ?),
              finished_at = NULL,
              error_message = NULL
          WHERE id = ? AND (locked_until IS NULL OR locked_until <= ?)
        `)
        .run("running", options.workerId, lockedUntil, nowIso, candidate.id, nowIso);
      if (updateResult.changes === 0) {
        return null;
      }
      return this.getTaskRow(candidate.id) ?? null;
    });

    const task = tx();
    if (!task) {
      return null;
    }

    mkdirSync(this.getTaskOutputDir(task.id), { recursive: true });
    mkdirSync(this.getTaskWorkdir(task.id), { recursive: true });
    mkdirSync(this.getTaskSessionDir(task.id), { recursive: true });
    this.appendEvent(task.id, "task_started", "Task claimed by worker", {
      workerId: options.workerId,
      attemptCount: task.attempt_count,
    });

    return {
      task,
      workdir: this.getTaskWorkdir(task.id),
      outputDir: this.getTaskOutputDir(task.id),
      sessionDir: this.getTaskSessionDir(task.id),
    };
  }

  refreshLock(taskId: string, workerId: string, lockTtlMs: number): boolean {
    const lockedUntil = toIso(addMilliseconds(this.clock.now(), lockTtlMs));
    const result = this.sqlite
      .prepare<[string, string, string]>(`
        UPDATE tasks
        SET locked_until = ?
        WHERE id = ? AND locked_by = ? AND status = 'running'
      `)
      .run(lockedUntil, taskId, workerId);
    return result.changes > 0;
  }

  isTaskOwnedByWorker(taskId: string, workerId: string): boolean {
    const row = this.sqlite
      .prepare<[string, string]>(`
        SELECT 1 AS owned
        FROM tasks
        WHERE id = ? AND locked_by = ? AND status = 'running'
      `)
      .get<{ owned: number }>(taskId, workerId);
    return row !== undefined;
  }

  markSucceeded(taskId: string, workerId: string): boolean {
    const finishedAt = toIso(this.clock.now());
    const result = this.sqlite
      .prepare<[TaskStatus, string, string, string]>(`
        UPDATE tasks
        SET status = ?,
            finished_at = ?,
            locked_by = NULL,
            locked_until = NULL,
            error_message = NULL
        WHERE id = ? AND locked_by = ?
      `)
      .run("succeeded", finishedAt, taskId, workerId);
    if (result.changes === 0) {
      return false;
    }
    this.appendEvent(taskId, "task_succeeded", "Task completed");
    return true;
  }

  markFailed(taskId: string, workerId: string, errorMessage: string, retryable = false): boolean {
    const finishedAt = toIso(this.clock.now());
    const result = this.sqlite
      .prepare<[TaskStatus, string, string, number, string, string]>(`
        UPDATE tasks
        SET status = ?,
            error_message = ?,
            finished_at = ?,
            failure_retryable = ?,
            locked_by = NULL,
            locked_until = NULL
        WHERE id = ? AND locked_by = ?
      `)
      .run("failed", errorMessage, finishedAt, retryable ? 1 : 0, taskId, workerId);
    if (result.changes === 0) {
      return false;
    }
    this.appendEvent(taskId, "task_failed", errorMessage, { retryable });
    return true;
  }

  cancelTask(taskId: string): PublicTask | null {
    const now = toIso(this.clock.now());
    const result = this.sqlite
      .prepare<[TaskStatus, string, string]>(`
        UPDATE tasks
        SET status = ?,
            finished_at = ?,
            locked_by = NULL,
            locked_until = NULL,
            failure_retryable = 0
        WHERE id = ? AND status IN ('queued', 'running', 'paused', 'failed')
      `)
      .run("cancelled", now, taskId);
    if (result.changes === 0) {
      return this.getTask(taskId);
    }
    this.appendEvent(taskId, "task_cancelled", "Task cancelled");
    return this.getTask(taskId);
  }

  pauseTask(taskId: string): PublicTask | null {
    const now = toIso(this.clock.now());
    const result = this.sqlite
      .prepare<[TaskStatus, string, string]>(`
        UPDATE tasks
        SET status = ?,
            finished_at = ?,
            locked_by = NULL,
            locked_until = NULL
        WHERE id = ? AND status IN ('queued', 'running', 'failed')
      `)
      .run("paused", now, taskId);
    if (result.changes === 0) {
      return this.getTask(taskId);
    }
    this.appendEvent(taskId, "task_paused", "Task paused");
    return this.getTask(taskId);
  }

  resumeTask(taskId: string): PublicTask | null {
    const result = this.sqlite
      .prepare<[TaskStatus, string]>(`
        UPDATE tasks
        SET status = ?,
            finished_at = NULL,
            locked_by = NULL,
            locked_until = NULL,
            error_message = NULL,
            failure_retryable = 1
        WHERE id = ? AND status IN ('paused', 'failed')
      `)
      .run("queued", taskId);
    if (result.changes === 0) {
      return this.getTask(taskId);
    }
    this.appendEvent(taskId, "task_resumed", "Task resumed");
    return this.getTask(taskId);
  }

  listOutputFiles(taskId: string): OutputFile[] {
    const task = this.getTaskRow(taskId);
    if (!task) {
      return [];
    }
    const outputDir = this.resolveOutputRoot(task.output_dir);
    return listFiles(outputDir).map((path) => {
      const stats = statSync(path);
      const relativePath = toPosix(relative(outputDir, path));
      return {
        fileId: encodeURIComponent(relativePath),
        path: relativePath,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      };
    });
  }

  resolveOutputFile(taskId: string, fileId: string): string | null {
    const task = this.getTaskRow(taskId);
    if (!task) {
      return null;
    }
    const outputRoot = this.resolveOutputRoot(task.output_dir);
    const decoded = decodeURIComponent(fileId);
    const fullPath = resolve(outputRoot, decoded);
    if (!isPathInside(fullPath, outputRoot)) {
      return null;
    }
    try {
      const stats = statSync(fullPath);
      if (!stats.isFile()) {
        return null;
      }
      return fullPath;
    } catch {
      return null;
    }
  }

  getTaskWorkdir(taskId: string): string {
    return join(this.tasksRoot, taskId, "workdir");
  }

  getTaskOutputDir(taskId: string): string {
    return join(this.tasksRoot, taskId, "output");
  }

  getTaskSessionDir(taskId: string): string {
    return join(this.tasksRoot, taskId, "session");
  }

  private resolveOutputRoot(outputDir: string): string {
    const outputRoot = resolve(outputDir);
    const taskRoot = resolve(this.tasksRoot);
    if (!isPathInside(outputRoot, taskRoot)) {
      throw new Error(`Task output directory is outside task root: ${outputDir}`);
    }
    return outputRoot;
  }
}

export function toPublicTask(row: TaskRow): PublicTask {
  return {
    id: row.id,
    status: row.status,
    input: parseTaskInput(row.input_json),
    outputDir: row.output_dir,
    errorMessage: row.error_message,
    lockedBy: row.locked_by,
    lockedUntil: row.locked_until,
    attemptCount: row.attempt_count,
    failureRetryable: row.failure_retryable === 1,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function toPublicTaskEvent(row: TaskEventRow): PublicTaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    seq: row.seq,
    type: row.type,
    message: row.message,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    createdAt: row.created_at,
  };
}

export function parseTaskInput(value: string): TaskInput {
  const parsed = JSON.parse(value) as unknown;
  if (!isTaskInput(parsed)) {
    throw new Error("Invalid task input stored in database");
  }
  return parsed;
}

export function isTaskInput(value: unknown): value is TaskInput {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.drug !== "string" || candidate.drug.trim() === "") {
    return false;
  }
  if (candidate.prompt !== undefined && typeof candidate.prompt !== "string") {
    return false;
  }
  if (candidate.metadata !== undefined && (!candidate.metadata || typeof candidate.metadata !== "object" || Array.isArray(candidate.metadata))) {
    return false;
  }
  return true;
}

function listFiles(root: string): string[] {
  try {
    const entries = readdirSync(root, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = join(root, entry.name);
      if (entry.isDirectory()) {
        files.push(...listFiles(fullPath));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
    return files.sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function isPathInside(target: string, root: string): boolean {
  const relativePath = relative(root, target);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith(sep));
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}
