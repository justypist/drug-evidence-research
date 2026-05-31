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
    const html = await htmlResponse.text();
    assert.match(html, /任务运行面板/);
    assert.match(html, /SKILL 编辑器/);

    const cssResponse = await app.request("/styles.css");
    assert.equal(cssResponse.status, 200);
    assert.equal(cssResponse.headers.get("content-type")?.startsWith("text/css"), true);

    const jsResponse = await app.request("/app.js");
    assert.equal(jsResponse.status, 200);
    assert.equal(jsResponse.headers.get("content-type")?.startsWith("application/javascript"), true);

    const skillEditorResponse = await app.request("/skill-editor");
    assert.equal(skillEditorResponse.status, 200);
    assert.match(await skillEditorResponse.text(), /SKILL 实时编辑器/);

    const skillEditorJsResponse = await app.request("/skill-editor.js");
    assert.equal(skillEditorJsResponse.status, 200);
    assert.equal(skillEditorJsResponse.headers.get("content-type")?.startsWith("application/javascript"), true);
  } finally {
    context.cleanup();
  }
});

test("API reads and updates the skill file", async () => {
  const context = createTestStore();
  try {
    const skillFilePath = join(context.tempDir, "SKILL.md");
    writeFileSync(skillFilePath, [
      "---",
      "name: test-skill",
      "description: Initial test skill",
      "---",
      "",
      "# Initial",
      "",
    ].join("\n"));
    const app = createApp({ store: context.store, skillFilePath });

    const getResponse = await app.request("/api/skill");
    assert.equal(getResponse.status, 200);
    const getBody = (await getResponse.json()) as { skill: { content: string; path: string } };
    assert.match(getBody.skill.content, /# Initial/);
    assert.equal(getBody.skill.path, skillFilePath);

    const nextContent = [
      "---",
      "name: test-skill",
      "description: Updated test skill",
      "---",
      "",
      "# Updated",
      "",
    ].join("\n");
    const putResponse = await app.request("/api/skill", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: nextContent }),
    });
    assert.equal(putResponse.status, 200);
    const putBody = (await putResponse.json()) as { skill: { content: string } };
    assert.match(putBody.skill.content, /# Updated/);

    const rereadResponse = await app.request("/api/skill");
    assert.match(await rereadResponse.text(), /# Updated/);
  } finally {
    context.cleanup();
  }
});

test("API rejects invalid skill updates", async () => {
  const context = createTestStore();
  try {
    const skillFilePath = join(context.tempDir, "SKILL.md");
    const initialContent = [
      "---",
      "name: test-skill",
      "description: Initial test skill",
      "---",
      "",
      "# Initial",
      "",
    ].join("\n");
    writeFileSync(skillFilePath, initialContent);
    const app = createApp({ store: context.store, skillFilePath });

    const response = await app.request("/api/skill", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "# Missing frontmatter" }),
    });
    assert.equal(response.status, 400);

    const getResponse = await app.request("/api/skill");
    const getBody = (await getResponse.json()) as { skill: { content: string } };
    assert.equal(getBody.skill.content, initialContent);
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

test("API paginates task lists for virtual scrolling clients", async () => {
  const context = createTestStore();
  try {
    for (const id of ["task-1", "task-2", "task-3"]) {
      context.store.createTask({ id, input: { drug: id } });
      context.clock.advance(1);
    }
    const app = createApp({ store: context.store });

    const response = await app.request("/tasks?offset=1&limit=1");
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      tasks: Array<{ id: string }>;
      total: number;
      offset: number;
      limit: number;
      hasMore: boolean;
    };
    assert.deepEqual(
      body.tasks.map((task) => task.id),
      ["task-2"],
    );
    assert.equal(body.total, 3);
    assert.equal(body.offset, 1);
    assert.equal(body.limit, 1);
    assert.equal(body.hasMore, true);
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

test("API pauses, resumes, and cancels tasks", async () => {
  const context = createTestStore();
  try {
    context.store.createTask({ id: "task-1", input: { drug: "ABC-123" } });
    context.store.createTask({ id: "task-2", input: { drug: "DEF-456" } });
    const app = createApp({ store: context.store });

    const pauseResponse = await app.request("/tasks/task-1/pause", { method: "POST" });
    assert.equal(pauseResponse.status, 200);
    const pauseBody = (await pauseResponse.json()) as { task: { status: string } };
    assert.equal(pauseBody.task.status, "paused");
    assert.equal(context.store.countClaimableTasks(), 1);

    const resumeResponse = await app.request("/tasks/task-1/resume", { method: "POST" });
    assert.equal(resumeResponse.status, 200);
    const resumeBody = (await resumeResponse.json()) as { task: { status: string } };
    assert.equal(resumeBody.task.status, "queued");
    assert.equal(context.store.countClaimableTasks(), 2);

    const stopResponse = await app.request("/tasks/task-2/stop", { method: "POST" });
    assert.equal(stopResponse.status, 200);
    assert.equal(context.store.getTask("task-2")?.status, "cancelled");
    assert.equal(context.store.countClaimableTasks(), 1);

    const continueResponse = await app.request("/tasks/task-2/continue", { method: "POST" });
    assert.equal(continueResponse.status, 200);
    assert.equal(context.store.getTask("task-2")?.status, "cancelled");

    const missingResponse = await app.request("/tasks/missing/pause", { method: "POST" });
    assert.equal(missingResponse.status, 404);
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
    writeFileSync(join(outputDir, "sources", "trial.txt"), "trial body");
    writeFileSync(join(context.store.getTaskWorkdir("task-1"), "secret.txt"), "secret");

    const app = createApp({ store: context.store });
    const listResponse = await app.request("/tasks/task-1/files");
    assert.equal(listResponse.status, 200);
    const listBody = (await listResponse.json()) as { files: Array<{ path: string; fileId: string }> };
    assert.deepEqual(
      listBody.files.map((file) => file.path),
      ["report.md", "sources/trial.txt"],
    );

    const fileResponse = await app.request(`/tasks/task-1/files/${listBody.files[0]?.fileId ?? ""}`);
    assert.equal(fileResponse.status, 200);
    assert.equal(await fileResponse.text(), "report body");

    const zipResponse = await app.request("/tasks/task-1/files.zip");
    assert.equal(zipResponse.status, 200);
    assert.equal(zipResponse.headers.get("content-type"), "application/zip");
    assert.equal(zipResponse.headers.get("content-disposition"), 'attachment; filename="task-1-artifacts.zip"');
    const zip = Buffer.from(await zipResponse.arrayBuffer());
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.match(zip.toString("utf-8"), /report\.md/);
    assert.match(zip.toString("utf-8"), /report body/);
    assert.match(zip.toString("utf-8"), /sources\/trial\.txt/);
    assert.match(zip.toString("utf-8"), /trial body/);
    assert.doesNotMatch(zip.toString("utf-8"), /secret/);

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
