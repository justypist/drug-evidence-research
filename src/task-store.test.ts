import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { createTestStore } from "#test-helpers.test.ts";

test("TaskStore creates tasks, appends monotonic events, and exposes public task shape", () => {
  const context = createTestStore();
  try {
    const task = context.store.createTask({
      id: "task-1",
      input: { drug: "ABC-123", metadata: { sponsor: "Example" } },
    });

    assert.equal(task.id, "task-1");
    assert.equal(task.status, "queued");
    assert.equal(task.input.drug, "ABC-123");
    assert.equal(task.attemptCount, 0);

    const seq2 = context.store.appendEvent("task-1", "progress", "step one");
    const seq3 = context.store.appendEvent("task-1", "progress", "step two");
    assert.equal(seq2, 2);
    assert.equal(seq3, 3);
    assert.deepEqual(
      context.store.listEvents("task-1").map((event) => event.seq),
      [1, 2, 3],
    );
    assert.deepEqual(
      context.store.listEvents("task-1", 1).map((event) => event.seq),
      [2, 3],
    );
  } finally {
    context.cleanup();
  }
});

test("TaskStore retries only retryable failed tasks while reusing task directories", () => {
  const context = createTestStore();
  try {
    context.store.createTask({ id: "task-1", input: { drug: "ABC-123" } });
    const firstClaim = context.store.claimNextTask({ workerId: "worker-a", lockTtlMs: 1000 });
    assert.ok(firstClaim);
    assert.equal(firstClaim.task.status, "running");
    assert.equal(firstClaim.task.attempt_count, 1);

    context.store.markFailed("task-1", "worker-a", "network failed", true);
    const failedTask = context.store.getTask("task-1");
    assert.equal(failedTask?.status, "failed");
    assert.equal(failedTask?.failureRetryable, true);

    const secondClaim = context.store.claimNextTask({ workerId: "worker-b", lockTtlMs: 1000 });
    assert.ok(secondClaim);
    assert.equal(secondClaim.task.attempt_count, 2);
    assert.equal(secondClaim.outputDir, firstClaim.outputDir);
    assert.equal(secondClaim.sessionDir, firstClaim.sessionDir);

    context.store.markFailed("task-1", "worker-b", "invalid output", false);
    assert.equal(context.store.countClaimableTasks(), 0);
    assert.equal(context.store.claimNextTask({ workerId: "worker-c", lockTtlMs: 1000 }), null);
  } finally {
    context.cleanup();
  }
});

test("TaskStore stops retrying after maxAttempts", () => {
  const context = createTestStore();
  try {
    context.store.createTask({ id: "task-1", input: { drug: "ABC-123" } });
    const firstClaim = context.store.claimNextTask({ workerId: "worker-a", lockTtlMs: 1000, maxAttempts: 2 });
    assert.ok(firstClaim);
    context.store.markFailed("task-1", "worker-a", "network failed", true);

    const secondClaim = context.store.claimNextTask({ workerId: "worker-b", lockTtlMs: 1000, maxAttempts: 2 });
    assert.ok(secondClaim);
    context.store.markFailed("task-1", "worker-b", "network failed again", true);

    assert.equal(context.store.countClaimableTasks(2), 0);
    assert.equal(context.store.claimNextTask({ workerId: "worker-c", lockTtlMs: 1000, maxAttempts: 2 }), null);
  } finally {
    context.cleanup();
  }
});

test("TaskStore allows lock recovery only after locked_until expires", () => {
  const context = createTestStore();
  try {
    context.store.createTask({ id: "task-1", input: { drug: "ABC-123" } });
    const firstClaim = context.store.claimNextTask({ workerId: "worker-a", lockTtlMs: 1000 });
    assert.ok(firstClaim);
    assert.equal(context.store.countClaimableTasks(), 0);

    assert.equal(context.store.claimNextTask({ workerId: "worker-b", lockTtlMs: 1000 }), null);
    context.clock.advance(1001);
    assert.equal(context.store.countClaimableTasks(), 1);
    const secondClaim = context.store.claimNextTask({ workerId: "worker-b", lockTtlMs: 1000 });
    assert.ok(secondClaim);
    context.store.refreshLock("task-1", "worker-b", 1000);

    assert.equal(context.store.claimNextTask({ workerId: "worker-c", lockTtlMs: 1000 }), null);
    context.store.markFailed("task-1", "worker-b", "retry later", true);
    const thirdClaim = context.store.claimNextTask({ workerId: "worker-c", lockTtlMs: 1000 });
    assert.ok(thirdClaim);
  } finally {
    context.cleanup();
  }
});

test("TaskStore pauses and resumes tasks without auto-claiming paused work", () => {
  const context = createTestStore();
  try {
    context.store.createTask({ id: "task-1", input: { drug: "ABC-123" } });
    assert.equal(context.store.countClaimableTasks(), 1);

    const paused = context.store.pauseTask("task-1");
    assert.equal(paused?.status, "paused");
    assert.equal(context.store.countClaimableTasks(), 0);
    assert.equal(context.store.claimNextTask({ workerId: "worker-a", lockTtlMs: 1000 }), null);

    const resumed = context.store.resumeTask("task-1");
    assert.equal(resumed?.status, "queued");
    assert.equal(context.store.countClaimableTasks(), 1);
    const claim = context.store.claimNextTask({ workerId: "worker-a", lockTtlMs: 1000 });
    assert.ok(claim);
    assert.equal(claim.task.status, "running");
  } finally {
    context.cleanup();
  }
});

test("TaskStore releases a running task when paused", () => {
  const context = createTestStore();
  try {
    context.store.createTask({ id: "task-1", input: { drug: "ABC-123" } });
    const claim = context.store.claimNextTask({ workerId: "worker-a", lockTtlMs: 1000 });
    assert.ok(claim);
    assert.equal(context.store.isTaskOwnedByWorker("task-1", "worker-a"), true);

    const paused = context.store.pauseTask("task-1");
    assert.equal(paused?.status, "paused");
    assert.equal(paused?.lockedBy, null);
    assert.equal(context.store.isTaskOwnedByWorker("task-1", "worker-a"), false);
    assert.equal(context.store.markSucceeded("task-1", "worker-a"), false);
  } finally {
    context.cleanup();
  }
});

test("TaskStore cancels tasks as a terminal state", () => {
  const context = createTestStore();
  try {
    context.store.createTask({ id: "task-1", input: { drug: "ABC-123" } });
    const claim = context.store.claimNextTask({ workerId: "worker-a", lockTtlMs: 1000 });
    assert.ok(claim);

    const cancelled = context.store.cancelTask("task-1");
    assert.equal(cancelled?.status, "cancelled");
    assert.equal(cancelled?.lockedBy, null);
    assert.equal(cancelled?.failureRetryable, false);
    assert.equal(context.store.countClaimableTasks(), 0);
    assert.equal(context.store.resumeTask("task-1")?.status, "cancelled");
    assert.equal(context.store.markSucceeded("task-1", "worker-a"), false);
  } finally {
    context.cleanup();
  }
});

test("TaskStore deletes a task, its events, and its local directory", () => {
  const context = createTestStore();
  try {
    context.store.createTask({ id: "task-1", input: { drug: "ABC-123" } });
    const taskRoot = join(context.store.tasksRoot, "task-1");
    writeFileSync(join(context.store.getTaskOutputDir("task-1"), "report.md"), "report");
    context.store.appendEvent("task-1", "progress", "working");

    assert.equal(existsSync(taskRoot), true);
    assert.equal(context.store.deleteTask("task-1"), true);

    assert.equal(context.store.getTask("task-1"), null);
    assert.deepEqual(context.store.listEvents("task-1"), []);
    assert.equal(existsSync(taskRoot), false);
    assert.equal(context.store.appendEvent("task-1", "progress", "late event"), 0);
    assert.equal(context.store.deleteTask("task-1"), false);
  } finally {
    context.cleanup();
  }
});

test("TaskStore file access is restricted to the task output directory", () => {
  const context = createTestStore();
  try {
    context.store.createTask({ id: "task-1", input: { drug: "ABC-123" } });
    const outputDir = context.store.getTaskOutputDir("task-1");
    mkdirSync(join(outputDir, "sources"), { recursive: true });
    writeFileSync(join(outputDir, "report.md"), "report");
    writeFileSync(join(outputDir, "sources", "source.txt"), "source");
    writeFileSync(join(context.store.getTaskWorkdir("task-1"), "secret.txt"), "secret");

    const files = context.store.listOutputFiles("task-1");
    assert.deepEqual(
      files.map((file) => file.path),
      ["report.md", "sources/source.txt"],
    );
    assert.ok(context.store.resolveOutputFile("task-1", encodeURIComponent("report.md"))?.endsWith("report.md"));
    assert.equal(context.store.resolveOutputFile("task-1", encodeURIComponent("../workdir/secret.txt")), null);
  } finally {
    context.cleanup();
  }
});
