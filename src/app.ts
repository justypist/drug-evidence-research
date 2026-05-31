import { basename, dirname, join, resolve } from "node:path";
import { readFile, rename, stat, writeFile } from "node:fs/promises";

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { createTaskId } from "#id.ts";
import { isTaskInput, TaskStore } from "#task-store.ts";
import type { PublicTaskEvent, TaskInput } from "#types.ts";

export interface CreateAppOptions {
  store: TaskStore;
  idFactory?: () => string;
  eventPollIntervalMs?: number;
  publicDir?: string;
  skillFilePath?: string;
}

interface ErrorResponse {
  error: string;
}

interface SkillDocument {
  content: string;
  path: string;
  modifiedAt: string;
  size: number;
}

interface SkillResponse {
  skill: SkillDocument;
}

export function createApp(options: CreateAppOptions): Hono {
  const app = new Hono();
  const idFactory = options.idFactory ?? createTaskId;
  const eventPollIntervalMs = options.eventPollIntervalMs ?? 100;
  const publicDir = resolve(options.publicDir ?? "public");
  const skillFilePath = resolve(
    options.skillFilePath ?? join(".agents", "skills", "drug-evidence-research", "SKILL.md"),
  );

  app.get("/", async (c) => {
    return c.html(await readPublicText(publicDir, "index.html"));
  });

  app.get("/styles.css", async (c) => {
    c.header("Content-Type", "text/css; charset=utf-8");
    return c.body(await readPublicText(publicDir, "styles.css"));
  });

  app.get("/app.js", async (c) => {
    c.header("Content-Type", "application/javascript; charset=utf-8");
    return c.body(await readPublicText(publicDir, "app.js"));
  });

  app.get("/skill-editor", async (c) => {
    return c.html(await readPublicText(publicDir, "skill-editor.html"));
  });

  app.get("/skill-editor.js", async (c) => {
    c.header("Content-Type", "application/javascript; charset=utf-8");
    return c.body(await readPublicText(publicDir, "skill-editor.js"));
  });

  app.get("/api/skill", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json<SkillResponse>({ skill: await readSkillFile(skillFilePath) });
  });

  app.put("/api/skill", async (c) => {
    const body = await readJson(c.req.raw);
    if (!isSkillUpdateInput(body)) {
      return c.json<ErrorResponse>({ error: "Request body must include a string content field" }, 400);
    }
    const content = normalizeSkillContent(body.content);
    const validationError = validateSkillContent(content);
    if (validationError) {
      return c.json<ErrorResponse>({ error: validationError }, 400);
    }
    await writeSkillFile(skillFilePath, content);
    c.header("Cache-Control", "no-store");
    return c.json<SkillResponse>({ skill: await readSkillFile(skillFilePath) });
  });

  app.get("/tasks", (c) => {
    const offset = parseIntegerQuery(c.req.query("offset"), 0, 0);
    const limit = parseIntegerQuery(c.req.query("limit"), 100, 1, 500);
    const page = options.store.listTasksPage({ offset, limit });
    return c.json(page);
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

  app.post("/tasks/:id/pause", (c) => {
    const task = options.store.pauseTask(c.req.param("id"));
    if (!task) {
      return c.json<ErrorResponse>({ error: "Task not found" }, 404);
    }
    return c.json({ task });
  });

  app.post("/tasks/:id/stop", (c) => {
    const task = options.store.pauseTask(c.req.param("id"));
    if (!task) {
      return c.json<ErrorResponse>({ error: "Task not found" }, 404);
    }
    return c.json({ task });
  });

  app.post("/tasks/:id/resume", (c) => {
    const task = options.store.resumeTask(c.req.param("id"));
    if (!task) {
      return c.json<ErrorResponse>({ error: "Task not found" }, 404);
    }
    return c.json({ task });
  });

  app.post("/tasks/:id/continue", (c) => {
    const task = options.store.resumeTask(c.req.param("id"));
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
    const lastEventId = parseLastEventId(c.req.header("Last-Event-ID") ?? c.req.query("lastEventId"));
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

async function readPublicText(publicDir: string, fileName: string): Promise<string> {
  return readFile(join(publicDir, fileName), "utf-8");
}

async function readSkillFile(skillFilePath: string): Promise<SkillDocument> {
  const [content, stats] = await Promise.all([readFile(skillFilePath, "utf-8"), stat(skillFilePath)]);
  return {
    content,
    path: skillFilePath,
    modifiedAt: stats.mtime.toISOString(),
    size: stats.size,
  };
}

async function writeSkillFile(skillFilePath: string, content: string): Promise<void> {
  const tempPath = join(dirname(skillFilePath), `.SKILL.md.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, content, "utf-8");
  await rename(tempPath, skillFilePath);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isSkillUpdateInput(value: unknown): value is { content: string } {
  if (!value || typeof value !== "object") {
    return false;
  }
  return typeof (value as Record<string, unknown>).content === "string";
}

function normalizeSkillContent(content: string): string {
  const normalized = content.replace(/\r\n?/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function validateSkillContent(content: string): string | null {
  const lines = content.split("\n");
  if (lines[0] !== "---") {
    return "SKILL.md must start with YAML frontmatter";
  }
  const endIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (endIndex < 0) {
    return "SKILL.md frontmatter must be closed with ---";
  }
  const frontmatter = lines.slice(1, endIndex).join("\n");
  if (!/^name:\s*\S+/m.test(frontmatter)) {
    return "SKILL.md frontmatter must include name";
  }
  if (!/^description:\s*\S+/m.test(frontmatter)) {
    return "SKILL.md frontmatter must include description";
  }
  const bodyHasContent = lines.slice(endIndex + 1).some((line) => line.trim().length > 0);
  if (!bodyHasContent) {
    return "SKILL.md body must be non-empty";
  }
  return null;
}

function parseLastEventId(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseIntegerQuery(value: string | undefined, fallback: number, min: number, max?: number): number {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const floored = Math.floor(parsed);
  return Math.min(Math.max(floored, min), max ?? floored);
}

async function writeTaskEvent(
  stream: { writeSSE: (message: { data: string; event?: string; id?: string }) => Promise<void> },
  event: PublicTaskEvent,
): Promise<void> {
  await stream.writeSSE({
    id: String(event.seq),
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
