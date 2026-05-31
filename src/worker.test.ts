import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { createTestStore } from "#test-helpers.test.ts";
import type { WorkerRunner, WorkerRunContext } from "#types.ts";
import { WorkerService } from "#worker.ts";

class SuccessfulRunner implements WorkerRunner {
  readonly contexts: WorkerRunContext[] = [];

  async run(context: WorkerRunContext): Promise<void> {
    this.contexts.push(context);
    context.appendEvent("assistant", "working", { outputDir: context.outputDir });
    writeFileSync(join(context.outputDir, `${context.input.drug}_research_report.md`), "# report");
  }
}

class FailingRunner implements WorkerRunner {
  async run(context: WorkerRunContext): Promise<void> {
    context.appendEvent("assistant", "about to fail");
    throw new Error("model unavailable");
  }
}

class PausingRunner implements WorkerRunner {
  private readonly pause: () => void;

  constructor(pause: () => void) {
    this.pause = pause;
  }

  async run(context: WorkerRunContext): Promise<void> {
    this.pause();
    assert.equal(context.refreshLock(), false);
  }
}

test("WorkerService processes a queued task and marks it succeeded", async () => {
  const context = createTestStore();
  try {
    context.store.createTask({ id: "task-1", input: { drug: "ABC-123" } });
    const runner = new SuccessfulRunner();
    const worker = new WorkerService({
      store: context.store,
      workerId: "worker-a",
      lockTtlMs: 60_000,
      pollIntervalMs: 1,
      runner,
    });

    assert.equal(await worker.runOnce(), true);
    const task = context.store.getTask("task-1");
    assert.equal(task?.status, "succeeded");
    assert.equal(task?.attemptCount, 1);
    assert.equal(task?.lockedBy, null);
    assert.deepEqual(
      context.store.listEvents("task-1").map((event) => event.type),
      ["task_created", "task_started", "assistant", "task_succeeded"],
    );
    assert.deepEqual(
      context.store.listOutputFiles("task-1").map((file) => file.path),
      ["ABC-123_research_report.md"],
    );
    assert.equal(runner.contexts[0]?.sessionDir, context.store.getTaskSessionDir("task-1"));
  } finally {
    context.cleanup();
  }
});

test("WorkerService marks failed tasks as retryable for a later worker", async () => {
  const context = createTestStore();
  try {
    context.store.createTask({ id: "task-1", input: { drug: "ABC-123" } });
    const failingWorker = new WorkerService({
      store: context.store,
      workerId: "worker-a",
      lockTtlMs: 60_000,
      pollIntervalMs: 1,
      runner: new FailingRunner(),
    });
    assert.equal(await failingWorker.runOnce(), true);
    assert.equal(context.store.getTask("task-1")?.status, "failed");
    assert.equal(context.store.getTask("task-1")?.errorMessage, "model unavailable");

    const successfulWorker = new WorkerService({
      store: context.store,
      workerId: "worker-b",
      lockTtlMs: 60_000,
      pollIntervalMs: 1,
      runner: new SuccessfulRunner(),
    });
    assert.equal(await successfulWorker.runOnce(), true);
    const task = context.store.getTask("task-1");
    assert.equal(task?.status, "succeeded");
    assert.equal(task?.attemptCount, 2);
  } finally {
    context.cleanup();
  }
});

test("TaskStore rejects completion after another worker reclaims an expired lock", () => {
  const context = createTestStore();
  try {
    context.store.createTask({ id: "task-1", input: { drug: "ABC-123" } });
    const claim = context.store.claimNextTask({ workerId: "worker-a", lockTtlMs: 1000 });
    assert.ok(claim);
    context.clock.advance(1001);
    const reclaimed = context.store.claimNextTask({ workerId: "worker-b", lockTtlMs: 1000 });
    assert.ok(reclaimed);

    assert.equal(context.store.markSucceeded("task-1", "worker-a"), false);
    const task = context.store.getTask("task-1");
    assert.equal(task?.status, "running");
    assert.equal(task?.lockedBy, "worker-b");
    assert.equal(context.store.listEvents("task-1").some((event) => event.type === "task_succeeded"), false);
  } finally {
    context.cleanup();
  }
});

test("WorkerService does not mark a task after it is paused", async () => {
  const context = createTestStore();
  try {
    context.store.createTask({ id: "task-1", input: { drug: "ABC-123" } });
    const worker = new WorkerService({
      store: context.store,
      workerId: "worker-a",
      lockTtlMs: 60_000,
      pollIntervalMs: 1,
      runner: new PausingRunner(() => {
        context.store.pauseTask("task-1");
      }),
    });

    assert.equal(await worker.runOnce(), true);
    const task = context.store.getTask("task-1");
    assert.equal(task?.status, "paused");
    assert.equal(task?.lockedBy, null);
    assert.equal(context.store.listEvents("task-1").some((event) => event.type === "task_succeeded"), false);
    assert.equal(context.store.listEvents("task-1").some((event) => event.type === "task_failed"), false);
  } finally {
    context.cleanup();
  }
});
