import { parseTaskInput, TaskStore } from "#task-store.ts";
import type { TaskClaim, WorkerRunner, WorkerRunContext } from "#types.ts";

export interface WorkerServiceOptions {
  store: TaskStore;
  workerId: string;
  lockTtlMs: number;
  pollIntervalMs: number;
  runner: WorkerRunner;
}

export class WorkerService {
  private readonly store: TaskStore;
  private readonly workerId: string;
  private readonly lockTtlMs: number;
  private readonly pollIntervalMs: number;
  private readonly runner: WorkerRunner;

  constructor(options: WorkerServiceOptions) {
    this.store = options.store;
    this.workerId = options.workerId;
    this.lockTtlMs = options.lockTtlMs;
    this.pollIntervalMs = options.pollIntervalMs;
    this.runner = options.runner;
  }

  async runOnce(): Promise<boolean> {
    const claim = this.store.claimNextTask({
      workerId: this.workerId,
      lockTtlMs: this.lockTtlMs,
    });
    if (!claim) {
      return false;
    }
    await this.runClaim(claim);
    return true;
  }

  async runLoop(signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      const processed = await this.runOnce();
      if (!processed) {
        await sleep(this.pollIntervalMs, signal);
      }
    }
  }

  private async runClaim(claim: TaskClaim): Promise<void> {
    const abortController = new AbortController();
    const refreshInterval = setInterval(() => {
      const refreshed = this.store.refreshLock(claim.task.id, this.workerId, this.lockTtlMs);
      if (!refreshed) {
        abortController.abort();
      }
    }, Math.max(1000, Math.floor(this.lockTtlMs / 3)));
    const context: WorkerRunContext = {
      task: claim.task,
      input: parseTaskInput(claim.task.input_json),
      workdir: claim.workdir,
      outputDir: claim.outputDir,
      sessionDir: claim.sessionDir,
      signal: abortController.signal,
      appendEvent: (type, message, payload) => {
        const seq = this.store.appendEvent(claim.task.id, type, message, payload);
        return seq;
      },
      refreshLock: () => {
        const refreshed = this.store.refreshLock(claim.task.id, this.workerId, this.lockTtlMs);
        if (!refreshed) {
          abortController.abort();
        }
        return refreshed;
      },
    };

    try {
      await this.runner.run(context);
      if (!this.store.isTaskOwnedByWorker(claim.task.id, this.workerId)) {
        return;
      }
      this.store.markSucceeded(claim.task.id, this.workerId);
    } catch (error) {
      if (!this.store.isTaskOwnedByWorker(claim.task.id, this.workerId)) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.store.markFailed(claim.task.id, this.workerId, message);
    } finally {
      clearInterval(refreshInterval);
    }
  }
}

async function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0 || signal?.aborted) {
    return;
  }
  await new Promise<void>((resolvePromise) => {
    const timeout = setTimeout(resolvePromise, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolvePromise();
      },
      { once: true },
    );
  });
}
