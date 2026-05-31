import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "#app.ts";
import { createTestStore } from "#test-helpers.test.ts";

test("API serves the static debugger frontend", async () => {
  const context = createTestStore();
  try {
    const app = createApp({ store: context.store });

    const htmlResponse = await app.request("/");
    assert.equal(htmlResponse.status, 200);
    assert.match(await htmlResponse.text(), /API 调试面板/);

    const cssResponse = await app.request("/styles.css");
    assert.equal(cssResponse.status, 200);
    assert.equal(cssResponse.headers.get("content-type")?.startsWith("text/css"), true);

    const jsResponse = await app.request("/app.js");
    assert.equal(jsResponse.status, 200);
    assert.equal(jsResponse.headers.get("content-type")?.startsWith("application/javascript"), true);
  } finally {
    context.cleanup();
  }
});

test("API creates, lists, and reads tasks", async () => {
  const context = createTestStore();
  try {
    const app = createApp({
      store: context.store,
      idFactory: () => "task-1",
    });

    const createResponse = await app.request("/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ drug: "ABC-123" }),
    });
    assert.equal(createResponse.status, 201);
    const createBody = (await createResponse.json()) as { task: { id: string; status: string } };
    assert.equal(createBody.task.id, "task-1");
    assert.equal(createBody.task.status, "queued");

    const listResponse = await app.request("/tasks");
    assert.equal(listResponse.status, 200);
    const listBody = (await listResponse.json()) as { tasks: Array<{ id: string }> };
    assert.deepEqual(
      listBody.tasks.map((task) => task.id),
      ["task-1"],
    );

    const getResponse = await app.request("/tasks/task-1");
    assert.equal(getResponse.status, 200);
  } finally {
    context.cleanup();
  }
});

test("API rejects invalid task input", async () => {
  const context = createTestStore();
  try {
    const app = createApp({ store: context.store });
    const response = await app.request("/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ drug: "" }),
    });
    assert.equal(response.status, 400);
  } finally {
    context.cleanup();
  }
});

test("API SSE replays history after Last-Event-ID", async () => {
  const context = createTestStore();
  try {
    context.store.createTask({ id: "task-1", input: { drug: "ABC-123" } });
    context.store.appendEvent("task-1", "progress", "first");
    context.store.appendEvent("task-1", "progress", "second");
    const app = createApp({ store: context.store, eventPollIntervalMs: 20 });

    const abort = new AbortController();
    const response = await app.request("/tasks/task-1/events", {
      headers: { "Last-Event-ID": "1" },
      signal: abort.signal,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type")?.startsWith("text/event-stream"), true);

    const reader = response.body?.getReader();
    assert.ok(reader);
    const text = await readUntil(reader, "id: 3");
    context.store.appendEvent("task-1", "progress", "third");
    const liveText = await readUntil(reader, "id: 4");
    abort.abort();
    await reader.cancel();
    assert.match(text, /id: 2/);
    assert.match(text, /id: 3/);
    assert.doesNotMatch(text, /id: 1/);
    assert.match(liveText, /id: 4/);
  } finally {
    context.cleanup();
  }
});

test("API SSE accepts lastEventId query for browser EventSource clients", async () => {
  const context = createTestStore();
  try {
    context.store.createTask({ id: "task-1", input: { drug: "ABC-123" } });
    context.store.appendEvent("task-1", "progress", "first");
    context.store.appendEvent("task-1", "progress", "second");
    const app = createApp({ store: context.store, eventPollIntervalMs: 20 });

    const abort = new AbortController();
    const response = await app.request("/tasks/task-1/events?lastEventId=2", {
      signal: abort.signal,
    });
    const reader = response.body?.getReader();
    assert.ok(reader);
    const text = await readUntil(reader, "id: 3");
    abort.abort();
    await reader.cancel();
    assert.doesNotMatch(text, /id: 2/);
    assert.match(text, /id: 3/);
  } finally {
    context.cleanup();
  }
});

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for (let i = 0; i < 10 && !text.includes(needle); i += 1) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text;
}

test("API lists and downloads only output files", async () => {
  const context = createTestStore();
  try {
    context.store.createTask({ id: "task-1", input: { drug: "ABC-123" } });
    const outputDir = context.store.getTaskOutputDir("task-1");
    mkdirSync(join(outputDir, "sources"), { recursive: true });
    writeFileSync(join(outputDir, "report.md"), "report body");
    writeFileSync(join(context.store.getTaskWorkdir("task-1"), "secret.txt"), "secret");

    const app = createApp({ store: context.store });
    const listResponse = await app.request("/tasks/task-1/files");
    assert.equal(listResponse.status, 200);
    const listBody = (await listResponse.json()) as { files: Array<{ path: string; fileId: string }> };
    assert.deepEqual(
      listBody.files.map((file) => file.path),
      ["report.md"],
    );

    const fileResponse = await app.request(`/tasks/task-1/files/${listBody.files[0]?.fileId ?? ""}`);
    assert.equal(fileResponse.status, 200);
    assert.equal(await fileResponse.text(), "report body");

    const traversalResponse = await app.request(`/tasks/task-1/files/${encodeURIComponent("../workdir/secret.txt")}`);
    assert.equal(traversalResponse.status, 404);

    const missingTaskResponse = await app.request("/tasks/missing/files");
    assert.equal(missingTaskResponse.status, 404);

    const missingFileResponse = await app.request(`/tasks/task-1/files/${encodeURIComponent("missing.md")}`);
    assert.equal(missingFileResponse.status, 404);
  } finally {
    context.cleanup();
  }
});
