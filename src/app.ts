import { basename } from "node:path";
import { readFile } from "node:fs/promises";

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { createTaskId } from "#id.ts";
import { isTaskInput, TaskStore } from "#task-store.ts";
import type { PublicTaskEvent, TaskInput } from "#types.ts";

export interface CreateAppOptions {
  store: TaskStore;
  idFactory?: () => string;
  eventPollIntervalMs?: number;
}

interface ErrorResponse {
  error: string;
}

export function createApp(options: CreateAppOptions): Hono {
  const app = new Hono();
  const idFactory = options.idFactory ?? createTaskId;
  const eventPollIntervalMs = options.eventPollIntervalMs ?? 100;

  app.get("/tasks", (c) => {
    return c.json({ tasks: options.store.listTasks() });
  });

  app.post("/tasks", async (c) => {
    const body = await readJson(c.req.raw);
    if (!isTaskInput(body)) {
      return c.json<ErrorResponse>({ error: "Request body must include a non-empty string drug field" }, 400);
    }
    const input: TaskInput = {
      drug: body.drug.trim(),
      ...(body.prompt !== undefined ? { prompt: body.prompt } : {}),
      ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
    };
    const task = options.store.createTask({ id: idFactory(), input });
    return c.json({ task }, 201);
  });

  app.get("/tasks/:id", (c) => {
    const task = options.store.getTask(c.req.param("id"));
    if (!task) {
      return c.json<ErrorResponse>({ error: "Task not found" }, 404);
    }
    return c.json({ task });
  });

  app.get("/tasks/:id/events", (c) => {
    const taskId = c.req.param("id");
    const task = options.store.getTask(taskId);
    if (!task) {
      return c.json<ErrorResponse>({ error: "Task not found" }, 404);
    }
    const lastEventId = parseLastEventId(c.req.header("Last-Event-ID"));
    return streamSSE(c, async (stream) => {
      let lastSeq = lastEventId ?? 0;
      while (!stream.aborted && !stream.closed) {
        const pendingEvents = options.store.listEvents(taskId, lastSeq);
        if (pendingEvents.length > 0) {
          for (const event of pendingEvents) {
            await writeTaskEvent(stream, event);
            lastSeq = event.seq;
          }
          continue;
        }
        await waitForAbortOrDelay(stream, eventPollIntervalMs);
      }
    });
  });

  app.get("/tasks/:id/files", (c) => {
    const taskId = c.req.param("id");
    if (!options.store.getTask(taskId)) {
      return c.json<ErrorResponse>({ error: "Task not found" }, 404);
    }
    return c.json({ files: options.store.listOutputFiles(taskId) });
  });

  app.get("/tasks/:id/files/:fileId", async (c) => {
    const filePath = options.store.resolveOutputFile(c.req.param("id"), c.req.param("fileId"));
    if (!filePath) {
      return c.json<ErrorResponse>({ error: "File not found" }, 404);
    }
    c.header("Content-Type", "application/octet-stream");
    c.header("Content-Disposition", `attachment; filename="${basename(filePath).replaceAll('"', "")}"`);
    return c.body(await readFile(filePath));
  });

  return app;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function parseLastEventId(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

async function writeTaskEvent(
  stream: { writeSSE: (message: { data: string; event?: string; id?: string }) => Promise<void> },
  event: PublicTaskEvent,
): Promise<void> {
  await stream.writeSSE({
    id: String(event.seq),
    event: event.type,
    data: JSON.stringify(event),
  });
}

async function waitForAbortOrDelay(
  stream: { aborted: boolean; onAbort: (listener: () => void | Promise<void>) => void },
  delayMs: number,
): Promise<void> {
  if (delayMs <= 0 || stream.aborted) {
    return;
  }
  await Promise.race([
    new Promise<void>((resolvePromise) => {
      const timeout = setTimeout(resolvePromise, delayMs);
      stream.onAbort(() => {
        clearTimeout(timeout);
        resolvePromise();
      });
    }),
  ]);
}
