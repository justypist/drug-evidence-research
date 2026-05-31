import { spawn, type SpawnOptions } from "node:child_process";

export interface ManagedWorkerProcess {
  readonly pid?: number | undefined;
  readonly killed: boolean;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  once(event: "error", listener: (error: Error) => void): this;
}

export type WorkerProcessSpawner = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ManagedWorkerProcess;

export interface WorkerProcessLogger {
  log: (message: string) => void;
  error: (message: string) => void;
}

export interface WorkerProcessSupervisorOptions {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stdio?: SpawnOptions["stdio"];
  restartDelayMs?: number;
  stopTimeoutMs?: number;
  spawner?: WorkerProcessSpawner;
  logger?: WorkerProcessLogger;
}

export class WorkerProcessSupervisor {
  private readonly command: string;
  private readonly args: string[];
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly cwd: string | undefined;
  private readonly stdio: SpawnOptions["stdio"];
  private readonly restartDelayMs: number;
  private readonly stopTimeoutMs: number;
  private readonly spawner: WorkerProcessSpawner;
  private readonly logger: WorkerProcessLogger;
  private child: ManagedWorkerProcess | null = null;
  private restartTimer: NodeJS.Timeout | undefined;
  private stopping = false;

  constructor(options: WorkerProcessSupervisorOptions) {
    this.command = options.command;
    this.args = options.args;
    this.env = options.env;
    this.cwd = options.cwd;
    this.stdio = options.stdio ?? "inherit";
    this.restartDelayMs = Math.max(0, Math.floor(options.restartDelayMs ?? 2000));
    this.stopTimeoutMs = Math.max(100, Math.floor(options.stopTimeoutMs ?? 15_000));
    this.spawner = options.spawner ?? defaultSpawner;
    this.logger = options.logger ?? console;
  }

  start(): void {
    if (this.child || this.restartTimer) {
      return;
    }
    this.stopping = false;
    this.spawnChild();
  }

  async stop(signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    this.stopping = true;
    this.clearRestartTimer();
    const child = this.child;
    if (!child) {
      return;
    }
    await new Promise<void>((resolvePromise) => {
      let done = false;
      const timeout = setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, this.stopTimeoutMs);
      const finish = () => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timeout);
        resolvePromise();
      };
      child.once("exit", finish);
      if (child.killed || !child.kill(signal)) {
        finish();
      }
    });
  }

  private spawnChild(): void {
    const options: SpawnOptions = {
      stdio: this.stdio,
    };
    if (this.env) {
      options.env = this.env;
    }
    if (this.cwd) {
      options.cwd = this.cwd;
    }

    let child: ManagedWorkerProcess;
    try {
      child = this.spawner(this.command, this.args, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Worker process failed to start: ${message}`);
      this.scheduleRestart();
      return;
    }

    this.child = child;
    this.logger.log(`Worker process started${child.pid ? ` pid=${child.pid}` : ""}`);
    let handled = false;
    const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (handled) {
        return;
      }
      handled = true;
      if (this.child === child) {
        this.child = null;
      }
      if (this.stopping) {
        return;
      }
      this.logger.error(`Worker process exited code=${code ?? "null"} signal=${signal ?? "null"}`);
      this.scheduleRestart();
    };
    child.once("exit", handleExit);
    child.once("error", (error) => {
      this.logger.error(`Worker process error: ${error.message}`);
      handleExit(null, null);
    });
  }

  private scheduleRestart(): void {
    if (this.stopping || this.restartTimer) {
      return;
    }
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (!this.stopping) {
        this.spawnChild();
      }
    }, this.restartDelayMs);
  }

  private clearRestartTimer(): void {
    if (!this.restartTimer) {
      return;
    }
    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
  }
}

const defaultSpawner: WorkerProcessSpawner = (command, args, options) => spawn(command, args, options);
