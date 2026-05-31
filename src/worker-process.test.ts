import { EventEmitter } from "node:events";
import test from "node:test";
import assert from "node:assert/strict";

import type { ManagedWorkerProcess, WorkerProcessSpawner } from "#worker-process.ts";
import { WorkerProcessSupervisor } from "#worker-process.ts";

class FakeWorkerProcess extends EventEmitter implements ManagedWorkerProcess {
  readonly pid: number;
  killed = false;
  killedSignals: NodeJS.Signals[] = [];

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killed = true;
    this.killedSignals.push(signal);
    queueMicrotask(() => this.emit("exit", null, signal));
    return true;
  }
}

test("WorkerProcessSupervisor restarts an exited worker process", async () => {
  const children: FakeWorkerProcess[] = [];
  const spawner: WorkerProcessSpawner = () => {
    const child = new FakeWorkerProcess(children.length + 1);
    children.push(child);
    return child;
  };
  const supervisor = new WorkerProcessSupervisor({
    command: "node",
    args: ["src/main.ts", "worker"],
    restartDelayMs: 1,
    spawner,
    logger: silentLogger,
  });

  supervisor.start();
  assert.equal(children.length, 1);
  children[0]?.emit("exit", 1, null);
  await waitFor(() => children.length === 2);
  await supervisor.stop();
});

test("WorkerProcessSupervisor stops the child process without scheduling restart", async () => {
  const children: FakeWorkerProcess[] = [];
  const spawner: WorkerProcessSpawner = () => {
    const child = new FakeWorkerProcess(children.length + 1);
    children.push(child);
    return child;
  };
  const supervisor = new WorkerProcessSupervisor({
    command: "node",
    args: ["src/main.ts", "worker"],
    restartDelayMs: 1,
    spawner,
    logger: silentLogger,
  });

  supervisor.start();
  await supervisor.stop("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(children.length, 1);
  assert.deepEqual(children[0]?.killedSignals, ["SIGTERM"]);
});

const silentLogger = {
  log: () => undefined,
  error: () => undefined,
};

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Timed out waiting for condition");
}
