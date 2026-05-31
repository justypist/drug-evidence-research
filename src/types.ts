export const taskStatuses = ["queued", "running", "paused", "succeeded", "failed", "cancelled"] as const;

export type TaskStatus = (typeof taskStatuses)[number];

export class TaskRunError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "TaskRunError";
    this.retryable = retryable;
  }
}

export interface TaskInput {
  drug: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskRow {
  id: string;
  status: TaskStatus;
  input_json: string;
  output_dir: string;
  error_message: string | null;
  locked_by: string | null;
  locked_until: string | null;
  attempt_count: number;
  failure_retryable: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface TaskEventRow {
  id: number;
  task_id: string;
  seq: number;
  type: string;
  message: string;
  payload_json: string | null;
  created_at: string;
}

export interface PublicTask {
  id: string;
  status: TaskStatus;
  input: TaskInput;
  outputDir: string;
  errorMessage: string | null;
  lockedBy: string | null;
  lockedUntil: string | null;
  attemptCount: number;
  failureRetryable: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface PublicTaskEvent {
  id: number;
  taskId: string;
  seq: number;
  type: string;
  message: string;
  payload: unknown;
  createdAt: string;
}

export interface OutputFile {
  fileId: string;
  path: string;
  size: number;
  modifiedAt: string;
}

export interface TaskClaim {
  task: TaskRow;
  workdir: string;
  outputDir: string;
  sessionDir: string;
}

export interface WorkerRunContext {
  task: TaskRow;
  input: TaskInput;
  workdir: string;
  outputDir: string;
  sessionDir: string;
  signal: AbortSignal;
  appendEvent: (type: string, message: string, payload?: unknown) => number;
  refreshLock: () => boolean;
}

export interface WorkerRunner {
  run(context: WorkerRunContext): Promise<void>;
}
