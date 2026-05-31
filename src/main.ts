import { serve } from "@hono/node-server";

import { createApp } from "#app.ts";
import { PiAgentRunner } from "#agent-runner.ts";
import { config } from "#config.ts";
import { openDatabase } from "#db.ts";
import { TaskStore } from "#task-store.ts";
import { WorkerProcessSupervisor } from "#worker-process.ts";
import { WorkerPool } from "#worker-pool.ts";

const database = openDatabase(config.storage.databasePath);
const store = new TaskStore({
  sqlite: database.sqlite,
  dataDir: config.storage.dataDir,
});

if (process.argv[2] === "worker") {
  const workerPool = new WorkerPool({
    store,
    workerIdPrefix: config.worker.id,
    minWorkers: config.worker.minWorkers,
    maxWorkers: config.worker.maxWorkers,
    lockTtlMs: config.worker.lockTtlMs,
    pollIntervalMs: config.worker.pollIntervalMs,
    scaleIntervalMs: config.worker.scaleIntervalMs,
    runnerFactory: () =>
      new PiAgentRunner({
        openai: config.openai,
        projectRoot: process.cwd(),
      }),
  });
  const abortController = new AbortController();
  process.on("SIGINT", () => abortController.abort());
  process.on("SIGTERM", () => abortController.abort());
  await workerPool.run(abortController.signal);
  database.close();
} else {
  const workerProcess = config.worker.enabled
    ? new WorkerProcessSupervisor({
        command: process.execPath,
        args: [process.argv[1] ?? "src/main.ts", "worker"],
        env: {
          ...process.env,
          WORKER_ID: config.worker.id,
        },
        cwd: process.cwd(),
        restartDelayMs: config.worker.processRestartDelayMs,
        stopTimeoutMs: config.worker.processStopTimeoutMs,
      })
    : null;
  workerProcess?.start();

  let shuttingDown = false;
  const app = createApp({ store });
  const server = serve({
    fetch: app.fetch,
    hostname: config.server.host,
    port: config.server.port,
  });
  console.log(`API listening on http://${config.server.host}:${config.server.port}`);

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    server.close();
    await workerProcess?.stop();
    database.close();
  };
  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
}
