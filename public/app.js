const state = {
  selectedTaskId: "",
  events: null,
};

const els = {
  refreshTasks: document.querySelector("#refreshTasks"),
  createTaskForm: document.querySelector("#createTaskForm"),
  drugInput: document.querySelector("#drugInput"),
  promptInput: document.querySelector("#promptInput"),
  metadataInput: document.querySelector("#metadataInput"),
  taskList: document.querySelector("#taskList"),
  taskIdInput: document.querySelector("#taskIdInput"),
  loadTask: document.querySelector("#loadTask"),
  taskDetail: document.querySelector("#taskDetail"),
  lastEventIdInput: document.querySelector("#lastEventIdInput"),
  connectEvents: document.querySelector("#connectEvents"),
  disconnectEvents: document.querySelector("#disconnectEvents"),
  eventStatus: document.querySelector("#eventStatus"),
  eventLog: document.querySelector("#eventLog"),
  loadFiles: document.querySelector("#loadFiles"),
  fileList: document.querySelector("#fileList"),
  responseOutput: document.querySelector("#responseOutput"),
};

function setOutput(value) {
  els.responseOutput.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function setSelectedTask(taskId) {
  state.selectedTaskId = taskId;
  els.taskIdInput.value = taskId;
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const text = await response.text();
  const body = text ? safeJson(text) : null;
  const result = {
    status: response.status,
    ok: response.ok,
    body,
  };
  setOutput(result);
  if (!response.ok) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  return body;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function refreshTasks() {
  const body = await requestJson("/tasks");
  renderTasks(body.tasks || []);
}

function renderTasks(tasks) {
  els.taskList.innerHTML = "";
  if (tasks.length === 0) {
    els.taskList.innerHTML = '<div class="muted">暂无任务</div>';
    return;
  }
  for (const task of tasks) {
    const item = document.createElement("div");
    item.className = "task-item";

    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = task.input?.drug || task.id;
    const meta = document.createElement("div");
    meta.className = "task-meta";
    meta.textContent = `${task.id} · attempts ${task.attemptCount} · ${task.createdAt}`;
    info.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "inline-actions";
    const badge = document.createElement("span");
    badge.className = `badge ${task.status}`;
    badge.textContent = task.status;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "选择";
    button.addEventListener("click", () => {
      setSelectedTask(task.id);
      loadTask();
      loadFiles();
    });
    actions.append(badge, button);

    item.append(info, actions);
    els.taskList.append(item);
  }
}

async function createTask(event) {
  event.preventDefault();
  const metadataText = els.metadataInput.value.trim();
  let metadata;
  if (metadataText) {
    metadata = JSON.parse(metadataText);
  }
  const payload = {
    drug: els.drugInput.value.trim(),
    ...(els.promptInput.value.trim() ? { prompt: els.promptInput.value.trim() } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
  const body = await requestJson("/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  setSelectedTask(body.task.id);
  await refreshTasks();
  await loadTask();
}

async function loadTask() {
  const taskId = els.taskIdInput.value.trim();
  if (!taskId) {
    setOutput("请先输入或选择 task id");
    return;
  }
  setSelectedTask(taskId);
  const body = await requestJson(`/tasks/${encodeURIComponent(taskId)}`);
  els.taskDetail.textContent = JSON.stringify(body.task, null, 2);
}

function connectEvents() {
  const taskId = els.taskIdInput.value.trim();
  if (!taskId) {
    setOutput("请先输入或选择 task id");
    return;
  }
  disconnectEvents();
  setSelectedTask(taskId);
  els.eventLog.innerHTML = "";
  const lastEventId = els.lastEventIdInput.value.trim();
  const query = lastEventId ? `?lastEventId=${encodeURIComponent(lastEventId)}` : "";
  const source = new EventSource(`/tasks/${encodeURIComponent(taskId)}/events${query}`);
  state.events = source;
  els.eventStatus.textContent = "连接中";
  els.eventStatus.className = "status muted";
  els.connectEvents.disabled = true;
  els.disconnectEvents.disabled = false;

  source.onopen = () => {
    els.eventStatus.textContent = "已连接";
    els.eventStatus.className = "status ok";
  };
  source.onerror = () => {
    els.eventStatus.textContent = "连接错误或已断开";
    els.eventStatus.className = "status error";
  };
  source.onmessage = (event) => appendEventItem("message", event);
}

function disconnectEvents() {
  if (state.events) {
    state.events.close();
    state.events = null;
  }
  els.connectEvents.disabled = false;
  els.disconnectEvents.disabled = true;
  els.eventStatus.textContent = "未连接";
  els.eventStatus.className = "status muted";
}

function appendEventItem(type, event) {
  const data = safeJson(event.data);
  const item = document.createElement("div");
  item.className = "event-item";
  const meta = document.createElement("div");
  meta.className = "event-meta";
  meta.textContent = `${data.type || type} · id ${event.lastEventId || data.seq || ""}`;
  const body = document.createElement("div");
  body.textContent = JSON.stringify(data, null, 2);
  item.append(meta, body);
  els.eventLog.prepend(item);
}

async function loadFiles() {
  const taskId = els.taskIdInput.value.trim();
  if (!taskId) {
    setOutput("请先输入或选择 task id");
    return;
  }
  setSelectedTask(taskId);
  const body = await requestJson(`/tasks/${encodeURIComponent(taskId)}/files`);
  renderFiles(taskId, body.files || []);
}

function renderFiles(taskId, files) {
  els.fileList.innerHTML = "";
  if (files.length === 0) {
    els.fileList.innerHTML = '<div class="muted">暂无文件</div>';
    return;
  }
  for (const file of files) {
    const item = document.createElement("div");
    item.className = "file-item";
    const name = document.createElement("strong");
    name.textContent = file.path;
    const meta = document.createElement("div");
    meta.className = "file-meta";
    meta.textContent = `${file.size} bytes · ${file.modifiedAt}`;
    const actions = document.createElement("div");
    actions.className = "inline-actions";
    const link = document.createElement("a");
    link.href = `/tasks/${encodeURIComponent(taskId)}/files/${file.fileId}`;
    link.textContent = "GET /tasks/:id/files/:fileId";
    link.target = "_blank";
    link.rel = "noreferrer";
    actions.append(link);
    item.append(name, meta, actions);
    els.fileList.append(item);
  }
}

els.refreshTasks.addEventListener("click", () => refreshTasks().catch((error) => setOutput(error.message)));
els.createTaskForm.addEventListener("submit", (event) => createTask(event).catch((error) => setOutput(error.message)));
els.loadTask.addEventListener("click", () => loadTask().catch((error) => setOutput(error.message)));
els.connectEvents.addEventListener("click", connectEvents);
els.disconnectEvents.addEventListener("click", disconnectEvents);
els.loadFiles.addEventListener("click", () => loadFiles().catch((error) => setOutput(error.message)));

refreshTasks().catch((error) => setOutput(error.message));
