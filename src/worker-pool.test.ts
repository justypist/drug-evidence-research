import test from "node:test";
import assert from "node:assert/strict";

import { createTestStore } from "#test-helpers.test.ts";
import type { WorkerRunner, WorkerRunContext } from "#types.ts";
import { WorkerPool } from "#worker-pool.ts";

class BlockingRunner implements WorkerRunner {
  private readonly started: (context: WorkerRunContext) => void;
  private readonly release: Promise<void>;

  constructor(started: (context: WorkerRunContext) => void, release: Promise<void>) {
    this.started = started;
    this.release = release;
  }

  async run(context: WorkerRunContext): Promise<void> {
    this.started(context);
    await this.release;
  }
}

class TrackingRunner implements WorkerRunner {
  private readonly release: Promise<void>;
  readonly startedTasks: string[] = [];
  readonly abortedTasks: string[] = [];

  constructor(release: Promise<void>) {
    this.release = release;
  }

  async run(context: WorkerRunContext): Promise<void> {
    this.startedTasks.push(context.task.id);
    if (context.signal.aborted) {
      this.abortedTasks.push(context.task.id);
    }
    context.signal.addEventListener(
      "abort",
      () => {
        this.abortedTasks.push(context.task.id);
      },
      { once: true },
    );
    await this.release;
  }
}

test("WorkerPool starts multiple workers up to queued task demand", async () => {
  const context = createTestStore();
  try {
    context.store.createTask({ id: "task-1", input: { drug: "ABC-1" } });
    context.store.createTask({ id: "task-2", input: { drug: "ABC-2" } });
    context.store.createTask({ id: "task-3", input: { drug: "ABC-3" } });

    let release!: () => void;
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const startedTasks: string[] = [];
    const pool = new WorkerPool({
      store: context.store,
      workerIdPrefix: "worker-test",
      minWorkers: 0,
      maxWorkers: 2,
      lockTtlMs: 60_000,
      pollIntervalMs: 5,
      scaleIntervalMs: 5,
      runnerFactory: () =>
        new BlockingRunner((runContext) => {
          startedTasks.push(runContext.task.id);
        }, releasePromise),
    });
    const abortController = new AbortController();
    const poolPromise = pool.run(abortController.signal);

    await waitFor(() => startedTasks.length >= 2);
    assert.deepEqual(startedTasks.sort(), ["task-1", "task-2"]);
    assert.equal(context.store.getTask("task-3")?.status, "queued");

    release();
    await waitFor(() => context.store.getTask("task-3")?.status === "succeeded");
    abortController.abort();
    await poolPromise;
  } finally {
    context.cleanup();
  }
});

test("WorkerPool does not stop a busy worker after claimed demand drops to zero", async () => {
  const context = createTestStore();
  try {
    context.store.createTask({ id: "task-1", input: { drug: "ABC-1" } });

    let release!: () => void;
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner = new TrackingRunner(releasePromise);
    const pool = new WorkerPool({
      store: context.store,
      workerIdPrefix: "worker-test",
      minWorkers: 0,
      maxWorkers: 1,
      lockTtlMs: 60_000,
      pollIntervalMs: 5,
      scaleIntervalMs: 5,
      runnerFactory: () => runner,
    });
    const abortController = new AbortController();
    const poolPromise = pool.run(abortController.signal);

    await waitFor(() => runner.startedTasks.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(runner.abortedTasks, []);
    assert.equal(context.store.getTask("task-1")?.status, "running");

    release();
    await waitFor(() => context.store.getTask("task-1")?.status === "succeeded");
    abortController.abort();
    await poolPromise;
  } finally {
    context.cleanup();
  }
});

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Timed out waiting for condition");
}
