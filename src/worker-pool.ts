import type { TaskStore } from "#task-store.ts";
import type { WorkerRunner } from "#types.ts";
import { WorkerService } from "#worker.ts";

export interface WorkerPoolOptions {
  store: TaskStore;
  workerIdPrefix: string;
  minWorkers: number;
  maxWorkers: number;
  lockTtlMs: number;
  pollIntervalMs: number;
  scaleIntervalMs: number;
  runnerFactory: (workerId: string) => WorkerRunner;
}

interface WorkerSlot {
  id: string;
  worker: WorkerService;
  busy: boolean;
  stopping: boolean;
  wake: () => void;
  done: Promise<void>;
}

export class WorkerPool {
  private readonly store: TaskStore;
  private readonly workerIdPrefix: string;
  private readonly minWorkers: number;
  private readonly maxWorkers: number;
  private readonly lockTtlMs: number;
  private readonly pollIntervalMs: number;
  private readonly scaleIntervalMs: number;
  private readonly runnerFactory: (workerId: string) => WorkerRunner;
  private readonly slots = new Map<string, WorkerSlot>();
  private stopping = false;
  private nextWorkerNumber = 1;

  constructor(options: WorkerPoolOptions) {
    this.store = options.store;
    this.workerIdPrefix = options.workerIdPrefix;
    this.minWorkers = Math.max(0, Math.floor(options.minWorkers));
    this.maxWorkers = Math.max(1, Math.floor(options.maxWorkers));
    this.lockTtlMs = options.lockTtlMs;
    this.pollIntervalMs = options.pollIntervalMs;
    this.scaleIntervalMs = Math.max(250, Math.floor(options.scaleIntervalMs));
    this.runnerFactory = options.runnerFactory;
  }

  async run(signal?: AbortSignal): Promise<void> {
    this.reconcile();
    while (!signal?.aborted) {
      await sleep(this.scaleIntervalMs, signal);
      this.reconcile();
    }
    this.stopping = true;
    await this.stopAll();
  }

  private reconcile(): void {
    if (this.stopping) {
      return;
    }
    const claimableTasks = this.store.countClaimableTasks();
    const busyWorkers = this.countBusyWorkers();
    const desiredWorkers = Math.min(
      this.maxWorkers,
      Math.max(this.minWorkers, busyWorkers + claimableTasks),
    );

    while (this.countActiveSlots() < desiredWorkers) {
      this.startWorker();
    }

    this.wakeIdleWorkers();

    while (this.countActiveSlots() > desiredWorkers && this.stopOneIdleWorker()) {
      continue;
    }
  }

  private countActiveSlots(): number {
    let activeSlots = 0;
    for (const slot of this.slots.values()) {
      if (!slot.stopping) {
        activeSlots += 1;
      }
    }
    return activeSlots;
  }

  private countBusyWorkers(): number {
    let busyWorkers = 0;
    for (const slot of this.slots.values()) {
      if (slot.busy) {
        busyWorkers += 1;
      }
    }
    return busyWorkers;
  }

  private wakeIdleWorkers(): void {
    for (const slot of this.slots.values()) {
      if (!slot.busy && !slot.stopping) {
        slot.wake();
      }
    }
  }

  private startWorker(): void {
    const workerId = `${this.workerIdPrefix}-${this.nextWorkerNumber}`;
    this.nextWorkerNumber += 1;
    const worker = new WorkerService({
      store: this.store,
      workerId,
      lockTtlMs: this.lockTtlMs,
      pollIntervalMs: this.pollIntervalMs,
      runner: this.runnerFactory(workerId),
    });
    const slot: WorkerSlot = {
      id: workerId,
      worker,
      busy: false,
      stopping: false,
      wake: () => undefined,
      done: Promise.resolve(),
    };
    slot.done = this.runSlot(slot).finally(() => {
      this.slots.delete(workerId);
    });
    this.slots.set(workerId, slot);
  }

  private async runSlot(slot: WorkerSlot): Promise<void> {
    while (!slot.stopping && !this.stopping) {
      slot.busy = true;
      const processed = await slot.worker.runOnce();
      slot.busy = false;
      this.reconcile();
      if (!processed) {
        await this.waitForWorkOrStop(slot);
      }
    }
    slot.busy = false;
  }

  private async waitForWorkOrStop(slot: WorkerSlot): Promise<void> {
    if (slot.stopping || this.stopping || this.store.countClaimableTasks() > 0) {
      return;
    }
    await new Promise<void>((resolvePromise) => {
      const timeout = setTimeout(resolvePromise, this.pollIntervalMs);
      slot.wake = () => {
        clearTimeout(timeout);
        slot.wake = () => undefined;
        resolvePromise();
      };
    });
  }

  private stopOneIdleWorker(): boolean {
    for (const slot of this.slots.values()) {
      if (!slot.busy && !slot.stopping) {
        this.stopSlot(slot);
        return true;
      }
    }
    return false;
  }

  private stopSlot(slot: WorkerSlot): void {
    slot.stopping = true;
    slot.wake();
  }

  private async stopAll(): Promise<void> {
    const slots = Array.from(this.slots.values());
    for (const slot of slots) {
      this.stopSlot(slot);
    }
    await Promise.all(slots.map((slot) => slot.done));
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
