import { resolve } from "node:path";

import { e } from "#util/env.ts";

export const config = {
  server: {
    host: e("HOST", "0.0.0.0"),
    port: e("PORT", 3000, e.number),
  },
  storage: {
    dataDir: resolve(e("DATA_DIR", "data")),
    databasePath: resolve(e("DATABASE_PATH", "data/tasks.sqlite")),
  },
  worker: {
    id: e("WORKER_ID", `worker-${process.pid}`),
    enabled: e("WORKER_ENABLED", true, e.bool),
    processRestartDelayMs: e("WORKER_PROCESS_RESTART_DELAY_MS", 2000, e.number),
    processStopTimeoutMs: e("WORKER_PROCESS_STOP_TIMEOUT_MS", 15_000, e.number),
    minWorkers: e("WORKER_MIN_WORKERS", 0, e.number),
    maxWorkers: e("WORKER_MAX_WORKERS", 4, e.number),
    lockTtlMs: e("WORKER_LOCK_TTL_MS", 5 * 60 * 1000, e.number),
    pollIntervalMs: e("WORKER_POLL_INTERVAL_MS", 3000, e.number),
    scaleIntervalMs: e("WORKER_SCALE_INTERVAL_MS", 1000, e.number),
  },
  openai: {
    baseUrl: e("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    apiKey: e.required("OPENAI_API_KEY"),
    model: e.required("OPENAI_MODEL"),
    api: e("OPENAI_API", ""),
  },
};
