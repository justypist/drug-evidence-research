import { serve } from "@hono/node-server";

import { createApp } from "#app.ts";
import { PiAgentRunner } from "#agent-runner.ts";
import { config } from "#config.ts";
import { openDatabase } from "#db.ts";
import { TaskStore } from "#task-store.ts";
import { WorkerService } from "#worker.ts";

const database = openDatabase(config.storage.databasePath);
const store = new TaskStore({
  sqlite: database.sqlite,
  dataDir: config.storage.dataDir,
});

if (process.argv[2] === "worker") {
  const worker = new WorkerService({
    store,
    workerId: config.worker.id,
    lockTtlMs: config.worker.lockTtlMs,
    pollIntervalMs: config.worker.pollIntervalMs,
    runner: new PiAgentRunner({
      openai: config.openai,
      projectRoot: process.cwd(),
    }),
  });
  const abortController = new AbortController();
  process.on("SIGINT", () => abortController.abort());
  process.on("SIGTERM", () => abortController.abort());
  await worker.runLoop(abortController.signal);
  database.close();
} else {
  const app = createApp({ store });
  serve({
    fetch: app.fetch,
    hostname: config.server.host,
    port: config.server.port,
  });
  console.log(`API listening on http://${config.server.host}:${config.server.port}`);
}
