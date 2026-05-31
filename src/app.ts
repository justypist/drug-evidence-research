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
    const task = options.store.cancelTask(c.req.param("id"));
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

  app.get("/tasks/:id/files.zip", async (c) => {
    const taskId = c.req.param("id");
    if (!options.store.getTask(taskId)) {
      return c.json<ErrorResponse>({ error: "Task not found" }, 404);
    }
    const files = await readOutputFilesForZip(options.store, taskId);
    const zip = createZipArchive(files);
    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", `attachment; filename="${taskId.replaceAll('"', "")}-artifacts.zip"`);
    return c.body(toResponseBytes(zip));
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

async function readOutputFilesForZip(store: TaskStore, taskId: string): Promise<ZipEntryInput[]> {
  const entries: ZipEntryInput[] = [];
  for (const file of store.listOutputFiles(taskId)) {
    const filePath = store.resolveOutputFile(taskId, file.fileId);
    if (filePath) {
      entries.push({ path: file.path, data: await readFile(filePath) });
    }
  }
  return entries;
}

interface ZipEntryInput {
  path: string;
  data: Buffer;
}

interface ZipCentralDirectoryEntry {
  header: Buffer;
}

function createZipArchive(files: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralEntries: ZipCentralDirectoryEntry[] = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = 33;
  for (const file of files) {
    const name = Buffer.from(file.path, "utf-8");
    const crc = crc32(file.data);
    const localHeader = Buffer.alloc(30 + name.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(file.data.length, 18);
    localHeader.writeUInt32LE(file.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    name.copy(localHeader, 30);
    localParts.push(localHeader, file.data);

    const centralHeader = Buffer.alloc(46 + name.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(file.data.length, 20);
    centralHeader.writeUInt32LE(file.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    name.copy(centralHeader, 46);
    centralEntries.push({ header: centralHeader });
    offset += localHeader.length + file.data.length;
  }

  const centralParts = centralEntries.map((entry) => entry.header);
  const centralDirectorySize = centralParts.reduce((total, entry) => total + entry.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectorySize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toResponseBytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(buffer.length);
  bytes.set(buffer);
  return bytes;
}

const crc32Table = createCrc32Table();

function createCrc32Table(): number[] {
  const table: number[] = [];
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table.push(value >>> 0);
  }
  return table;
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
