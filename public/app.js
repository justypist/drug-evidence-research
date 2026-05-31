const TASK_PAGE_SIZE = 100;
const TASK_ROW_HEIGHT = 76;
const TASK_OVERSCAN = 8;
const EVENT_ROW_HEIGHT = 132;
const EVENT_OVERSCAN = 8;
const EVENT_DB_NAME = "drug-evidence-research";
const EVENT_DB_VERSION = 1;
const EVENT_STORE_NAME = "taskEvents";

const state = {
  selectedTaskId: "",
  events: null,
  taskCache: new Map(),
  taskPagesLoading: new Set(),
  taskTotal: 0,
  taskRenderFrame: 0,
  eventQueue: [],
  eventCache: [],
  eventSeenKeys: new Set(),
  eventFrame: 0,
  eventRenderFrame: 0,
  eventStickToBottom: false,
  eventCount: 0,
  eventStats: new Map(),
  lastEventSummary: "",
  eventDbPromise: null,
  eventPersistQueue: [],
  eventPersistTimer: 0,
};

const els = {
  refreshTasks: document.querySelector("#refreshTasks"),
  createTaskForm: document.querySelector("#createTaskForm"),
  drugInput: document.querySelector("#drugInput"),
  promptInput: document.querySelector("#promptInput"),
  metadataInput: document.querySelector("#metadataInput"),
  taskList: document.querySelector("#taskList"),
  taskListMeta: document.querySelector("#taskListMeta"),
  taskIdInput: document.querySelector("#taskIdInput"),
  loadTask: document.querySelector("#loadTask"),
  taskDetail: document.querySelector("#taskDetail"),
  lastEventIdInput: document.querySelector("#lastEventIdInput"),
  connectEvents: document.querySelector("#connectEvents"),
  disconnectEvents: document.querySelector("#disconnectEvents"),
  eventStatus: document.querySelector("#eventStatus"),
  eventSummary: document.querySelector("#eventSummary"),
  eventLog: document.querySelector("#eventLog"),
  loadFiles: document.querySelector("#loadFiles"),
  fileList: document.querySelector("#fileList"),
  responseOutput: document.querySelector("#responseOutput"),
};

function setOutput(value) {
  els.responseOutput.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function setSelectedTask(taskId) {
  const didTaskChange = state.selectedTaskId !== taskId;
  state.selectedTaskId = taskId;
  els.taskIdInput.value = taskId;
  if (didTaskChange) {
    els.lastEventIdInput.value = "";
    els.lastEventIdInput.dataset.taskId = taskId;
  }
  scheduleTaskRender();
}

async function requestJson(path, options = {}, ui = {}) {
  const { headers = {}, ...fetchOptions } = options;
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    ...fetchOptions,
  });
  const text = await response.text();
  const body = text ? safeJson(text) : null;
  const result = {
    status: response.status,
    ok: response.ok,
    body,
  };
  if (!ui.silent) {
    setOutput(result);
  }
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

function openEventDb() {
  if (!("indexedDB" in window)) {
    return Promise.resolve(null);
  }
  if (state.eventDbPromise) {
    return state.eventDbPromise;
  }
  state.eventDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(EVENT_DB_NAME, EVENT_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EVENT_STORE_NAME)) {
        const store = db.createObjectStore(EVENT_STORE_NAME, { keyPath: "key" });
        store.createIndex("taskIdSeq", ["taskId", "seq"], { unique: true });
        store.createIndex("taskId", "taskId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB 打开失败"));
  }).catch((error) => {
    setOutput(`IndexedDB 不可用：${error.message}`);
    return null;
  });
  return state.eventDbPromise;
}

async function readCachedEvents(taskId) {
  const db = await openEventDb();
  if (!db) {
    return [];
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVENT_STORE_NAME, "readonly");
    const store = tx.objectStore(EVENT_STORE_NAME);
    const index = store.index("taskIdSeq");
    const range = IDBKeyRange.bound([taskId, 0], [taskId, Number.MAX_SAFE_INTEGER]);
    const request = index.getAll(range);
    request.onsuccess = () => {
      const rows = Array.isArray(request.result) ? request.result : [];
      rows.sort((a, b) => a.seq - b.seq);
      resolve(rows.map((row) => row.event));
    };
    request.onerror = () => reject(request.error || new Error("读取事件缓存失败"));
  }).catch((error) => {
    setOutput(error.message);
    return [];
  });
}

function queueEventPersistence(events) {
  const taskId = state.selectedTaskId;
  if (!taskId || events.length === 0) {
    return;
  }
  for (const event of events) {
    const seq = normalizeEventSeq(event);
    if (seq === null) {
      continue;
    }
    state.eventPersistQueue.push({
      key: `${taskId}:${seq}`,
      taskId,
      seq,
      event,
      cachedAt: Date.now(),
    });
  }
  if (state.eventPersistTimer) {
    return;
  }
  state.eventPersistTimer = window.setTimeout(() => {
    state.eventPersistTimer = 0;
    persistQueuedEvents().catch((error) => setOutput(error.message));
  }, 250);
}

async function persistQueuedEvents() {
  const rows = state.eventPersistQueue.splice(0, state.eventPersistQueue.length);
  if (rows.length === 0) {
    return;
  }
  const db = await openEventDb();
  if (!db) {
    return;
  }
  await new Promise((resolve, reject) => {
    const tx = db.transaction(EVENT_STORE_NAME, "readwrite");
    const store = tx.objectStore(EVENT_STORE_NAME);
    for (const row of rows) {
      store.put(row);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("写入事件缓存失败"));
  });
}

async function refreshTasks(options = {}) {
  if (options.resetScroll) {
    els.taskList.scrollTop = 0;
  }
  state.taskCache.clear();
  state.taskPagesLoading.clear();
  state.taskTotal = 0;
  els.taskListMeta.textContent = "加载中";
  await fetchTaskPage(0, { silent: false });
  scheduleTaskRender();
}

async function fetchTaskPage(offset, ui = { silent: true }) {
  const pageOffset = Math.max(0, Math.floor(offset / TASK_PAGE_SIZE) * TASK_PAGE_SIZE);
  if (state.taskPagesLoading.has(pageOffset)) {
    return;
  }
  state.taskPagesLoading.add(pageOffset);
  try {
    const body = await requestJson(`/tasks?offset=${pageOffset}&limit=${TASK_PAGE_SIZE}`, {}, ui);
    state.taskTotal = Number.isFinite(body.total) ? body.total : body.tasks.length;
    for (let index = 0; index < body.tasks.length; index += 1) {
      state.taskCache.set(pageOffset + index, body.tasks[index]);
    }
    updateTaskMeta();
  } finally {
    state.taskPagesLoading.delete(pageOffset);
  }
}

function updateTaskMeta() {
  const loaded = Math.min(state.taskCache.size, state.taskTotal);
  els.taskListMeta.textContent = state.taskTotal > 0 ? `${loaded}/${state.taskTotal}` : "暂无任务";
}

function scheduleTaskRender() {
  if (state.taskRenderFrame) {
    return;
  }
  state.taskRenderFrame = window.requestAnimationFrame(() => {
    state.taskRenderFrame = 0;
    renderVirtualTasks();
  });
}

function renderVirtualTasks() {
  if (state.taskTotal === 0) {
    els.taskList.innerHTML = '<div class="empty-state">暂无任务</div>';
    updateTaskMeta();
    return;
  }

  const viewportHeight = Math.max(els.taskList.clientHeight, TASK_ROW_HEIGHT);
  const startIndex = Math.max(0, Math.floor(els.taskList.scrollTop / TASK_ROW_HEIGHT) - TASK_OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / TASK_ROW_HEIGHT) + TASK_OVERSCAN * 2;
  const endIndex = Math.min(state.taskTotal - 1, startIndex + visibleCount);

  ensureTaskPages(startIndex, endIndex);

  const spacer = document.createElement("div");
  spacer.className = "virtual-spacer";
  spacer.style.height = `${state.taskTotal * TASK_ROW_HEIGHT}px`;

  for (let index = startIndex; index <= endIndex; index += 1) {
    const task = state.taskCache.get(index);
    const item = task ? createTaskItem(task) : createTaskSkeleton(index);
    item.classList.add("virtual-row");
    item.style.transform = `translateY(${index * TASK_ROW_HEIGHT}px)`;
    spacer.append(item);
  }

  els.taskList.replaceChildren(spacer);
  updateTaskMeta();
}

function ensureTaskPages(startIndex, endIndex) {
  const firstPage = Math.floor(startIndex / TASK_PAGE_SIZE) * TASK_PAGE_SIZE;
  const lastPage = Math.floor(endIndex / TASK_PAGE_SIZE) * TASK_PAGE_SIZE;
  for (let offset = firstPage; offset <= lastPage; offset += TASK_PAGE_SIZE) {
    if (!state.taskCache.has(offset) && !state.taskPagesLoading.has(offset)) {
      fetchTaskPage(offset).then(scheduleTaskRender).catch((error) => setOutput(error.message));
    }
  }
}

function createTaskSkeleton(index) {
  const item = document.createElement("div");
  item.className = "task-item loading";
  item.dataset.index = String(index);
  const title = document.createElement("strong");
  title.textContent = "加载中";
  const meta = document.createElement("div");
  meta.className = "task-meta";
  meta.textContent = `#${index + 1}`;
  item.append(title, meta);
  return item;
}

function createTaskItem(task) {
  const item = document.createElement("div");
  item.className = `task-item ${task.id === state.selectedTaskId ? "selected" : ""}`;

  const info = document.createElement("div");
  info.className = "task-main";
  const title = document.createElement("strong");
  title.textContent = task.input?.drug || task.id;
  const meta = document.createElement("div");
  meta.className = "task-meta";
  meta.textContent = `${task.id} · ${task.attemptCount} 次 · ${formatDateTime(task.createdAt)}`;
  info.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "inline-actions";
  const badge = document.createElement("span");
  badge.className = `badge ${task.status}`;
  badge.textContent = formatStatus(task.status);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary compact";
  button.textContent = "选择";
  button.addEventListener("click", () => selectTask(task.id));
  actions.append(badge, button);

  item.addEventListener("dblclick", () => selectTask(task.id));
  item.append(info, actions);
  return item;
}

function selectTask(taskId) {
  setSelectedTask(taskId);
  loadTask().catch((error) => setOutput(error.message));
  loadFiles().catch((error) => setOutput(error.message));
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
  await refreshTasks({ resetScroll: true });
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
  renderTaskDetail(body.task);
}

function renderTaskDetail(task) {
  els.taskDetail.innerHTML = "";
  const header = document.createElement("div");
  header.className = "detail-head";
  const title = document.createElement("strong");
  title.textContent = task.input?.drug || task.id;
  const badge = document.createElement("span");
  badge.className = `badge ${task.status}`;
  badge.textContent = formatStatus(task.status);
  header.append(title, badge);
  els.taskDetail.append(header);

  const fields = [
    ["Task ID", task.id],
    ["创建时间", formatDateTime(task.createdAt)],
    ["开始时间", formatDateTime(task.startedAt)],
    ["完成时间", formatDateTime(task.finishedAt)],
    ["尝试次数", String(task.attemptCount)],
    ["输出目录", task.outputDir],
    ["错误", task.errorMessage || ""],
  ];

  const grid = document.createElement("dl");
  grid.className = "detail-grid";
  for (const [label, value] of fields) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value || "-";
    grid.append(dt, dd);
  }
  els.taskDetail.append(grid);

  if (task.input?.prompt || task.input?.metadata) {
    const details = document.createElement("details");
    details.className = "raw-details";
    const summary = document.createElement("summary");
    summary.textContent = "输入参数";
    const pre = document.createElement("pre");
    pre.className = "raw-json";
    pre.textContent = JSON.stringify(task.input, null, 2);
    details.append(summary, pre);
    els.taskDetail.append(details);
  }
}

async function connectEvents() {
  const taskId = els.taskIdInput.value.trim();
  if (!taskId) {
    setOutput("请先输入或选择 task id");
    return;
  }
  disconnectEvents();
  setSelectedTask(taskId);
  await resetEventView(taskId);
  const cachedLastSeq = getLastCachedEventSeq();
  const manualLastEventId = els.lastEventIdInput.dataset.taskId === taskId ? els.lastEventIdInput.value.trim() : "";
  const lastEventId = manualLastEventId || (cachedLastSeq > 0 ? String(cachedLastSeq) : "");
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
  source.onmessage = (event) => {
    state.eventQueue.push(parseSseEvent(event));
    scheduleEventFlush();
  };
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

async function resetEventView(taskId) {
  state.eventQueue = [];
  state.eventCache = [];
  state.eventSeenKeys.clear();
  state.eventStickToBottom = true;
  state.eventCount = 0;
  state.eventStats.clear();
  state.lastEventSummary = "";
  els.eventLog.innerHTML = "";
  const cachedEvents = await readCachedEvents(taskId);
  if (state.selectedTaskId !== taskId) {
    return;
  }
  appendEvents(cachedEvents, { persist: false });
  const cachedLastSeq = getLastCachedEventSeq();
  if (cachedLastSeq > 0) {
    els.lastEventIdInput.value = String(cachedLastSeq);
  }
  state.eventStickToBottom = true;
  renderEventSummary();
  scheduleEventRender();
}

function scheduleEventFlush() {
  if (state.eventFrame) {
    return;
  }
  state.eventFrame = window.requestAnimationFrame(() => {
    state.eventFrame = 0;
    flushEventQueue();
  });
}

function flushEventQueue() {
  const events = state.eventQueue.splice(0, state.eventQueue.length);
  if (events.length === 0) {
    return;
  }
  state.eventStickToBottom = isEventLogNearBottom();
  appendEvents(events, { persist: true });
  renderEventSummary();
  scheduleEventRender();
}

function appendEvents(events, options) {
  const accepted = [];
  for (const rawEvent of events) {
    const normalized = normalizeEvent(rawEvent);
    const key = getEventKey(normalized);
    if (state.eventSeenKeys.has(key)) {
      continue;
    }
    state.eventSeenKeys.add(key);
    state.eventCache.push(normalized);
    updateEventStats(normalized);
    accepted.push(normalized.raw);
  }
  if (accepted.length > 0 && options.persist) {
    queueEventPersistence(accepted);
  }
}

function scheduleEventRender() {
  if (state.eventRenderFrame) {
    return;
  }
  state.eventRenderFrame = window.requestAnimationFrame(() => {
    state.eventRenderFrame = 0;
    renderVirtualEvents();
  });
}

function renderVirtualEvents() {
  if (state.eventCache.length === 0) {
    els.eventLog.innerHTML = '<div class="empty-state">暂无事件</div>';
    return;
  }

  const viewportHeight = Math.max(els.eventLog.clientHeight, EVENT_ROW_HEIGHT);
  const totalHeight = state.eventCache.length * EVENT_ROW_HEIGHT;
  if (state.eventStickToBottom) {
    els.eventLog.scrollTop = Math.max(0, totalHeight - viewportHeight);
  }
  const startIndex = Math.max(0, Math.floor(els.eventLog.scrollTop / EVENT_ROW_HEIGHT) - EVENT_OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / EVENT_ROW_HEIGHT) + EVENT_OVERSCAN * 2;
  const endIndex = Math.min(state.eventCache.length - 1, startIndex + visibleCount);

  const spacer = document.createElement("div");
  spacer.className = "event-virtual-spacer";
  spacer.style.height = `${totalHeight}px`;

  for (let index = startIndex; index <= endIndex; index += 1) {
    const item = createEventItem(state.eventCache[index]);
    item.classList.add("event-virtual-row");
    item.style.transform = `translateY(${index * EVENT_ROW_HEIGHT}px)`;
    spacer.append(item);
  }

  els.eventLog.replaceChildren(spacer);
}

function createEventItem(event) {
  const item = document.createElement("article");
  item.className = `event-item ${event.kind}`;

  const top = document.createElement("div");
  top.className = "event-topline";
  const badge = document.createElement("span");
  badge.className = `event-kind ${event.kind}`;
  badge.textContent = event.label;
  const time = document.createElement("span");
  time.className = "event-meta";
  time.textContent = `${formatDateTime(event.createdAt)} · #${event.seq}`;
  top.append(badge, time);

  const message = document.createElement("div");
  message.className = "event-message";
  message.textContent = event.message;

  item.append(top, message);
  if (event.payloadText) {
    const payload = document.createElement("div");
    payload.className = "event-payload";
    payload.textContent = event.payloadText;
    item.append(payload);
  }

  const details = document.createElement("details");
  details.className = "raw-details";
  const summary = document.createElement("summary");
  summary.textContent = "原始数据";
  const pre = document.createElement("pre");
  pre.className = "raw-json";
  pre.textContent = JSON.stringify(event.raw, null, 2);
  details.append(summary, pre);
  item.append(details);
  return item;
}

function parseSseEvent(event) {
  const data = safeJson(event.data);
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return {
      ...data,
      seq: normalizeEventSeq(data) ?? normalizeEventSeq({ seq: event.lastEventId }) ?? data.seq,
    };
  }
  return {
    type: "message",
    message: String(data),
    seq: normalizeEventSeq({ seq: event.lastEventId }),
    createdAt: "",
    payload: null,
  };
}

function normalizeEvent(data) {
  const type = typeof data?.type === "string" ? data.type : "message";
  const message = typeof data?.message === "string" && data.message ? data.message : type;
  const seq = normalizeEventSeq(data);
  const payload = data?.payload && typeof data.payload === "object" ? data.payload : null;
  return {
    raw: data,
    type,
    seq: seq ?? "",
    message,
    createdAt: data?.createdAt || "",
    label: eventLabel(type),
    kind: eventKind(type),
    payloadText: summarizePayload(payload),
  };
}

function updateEventStats(event) {
  const type = event.type;
  state.eventCount += 1;
  state.eventStats.set(type, (state.eventStats.get(type) || 0) + 1);
  state.lastEventSummary = event.message || type;
  if (typeof event.seq === "number" && event.seq > 0) {
    els.lastEventIdInput.value = String(event.seq);
    els.lastEventIdInput.dataset.taskId = state.selectedTaskId;
  }
}

function getEventKey(event) {
  return event.seq === "" ? `${event.type}:${event.createdAt}:${event.message}` : String(event.seq);
}

function normalizeEventSeq(event) {
  const value = event?.seq ?? event?.lastEventId ?? event?.id;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
  }
  return null;
}

function getLastCachedEventSeq() {
  for (let index = state.eventCache.length - 1; index >= 0; index -= 1) {
    const seq = state.eventCache[index]?.seq;
    if (typeof seq === "number" && seq > 0) {
      return seq;
    }
  }
  return 0;
}

function isEventLogNearBottom() {
  const totalHeight = state.eventCache.length * EVENT_ROW_HEIGHT;
  return els.eventLog.scrollTop + els.eventLog.clientHeight >= totalHeight - EVENT_ROW_HEIGHT;
}

function renderEventSummary() {
  const tools =
    (state.eventStats.get("agent_tool_started") || 0) +
    (state.eventStats.get("agent_tool_completed") || 0) +
    (state.eventStats.get("agent_tool_failed") || 0);
  const outputs = state.eventStats.get("agent_message_completed") || 0;
  els.eventSummary.innerHTML = "";
  const items = [
    ["事件", String(state.eventCount)],
    ["工具", String(tools)],
    ["输出", String(outputs)],
  ];
  for (const [label, value] of items) {
    const item = document.createElement("div");
    item.className = "summary-tile";
    item.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    els.eventSummary.append(item);
  }
  const last = document.createElement("div");
  last.className = "summary-latest";
  last.textContent = state.lastEventSummary || "等待事件";
  els.eventSummary.append(last);
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
    els.fileList.innerHTML = '<div class="empty-state">暂无文件</div>';
    return;
  }
  for (const file of files) {
    const item = document.createElement("div");
    item.className = "file-item";
    const name = document.createElement("strong");
    name.textContent = file.path;
    const meta = document.createElement("div");
    meta.className = "file-meta";
    meta.textContent = `${formatBytes(file.size)} · ${formatDateTime(file.modifiedAt)}`;
    const actions = document.createElement("div");
    actions.className = "inline-actions";
    const link = document.createElement("a");
    link.href = `/tasks/${encodeURIComponent(taskId)}/files/${file.fileId}`;
    link.textContent = "下载";
    link.target = "_blank";
    link.rel = "noreferrer";
    actions.append(link);
    item.append(name, meta, actions);
    els.fileList.append(item);
  }
}

function eventKind(type) {
  if (type.includes("failed") || type.includes("error")) {
    return "error";
  }
  if (type.includes("completed") || type.includes("succeeded") || type.includes("finished")) {
    return "ok";
  }
  if (type.includes("tool")) {
    return "tool";
  }
  if (type.includes("message")) {
    return "message";
  }
  return "progress";
}

function eventLabel(type) {
  const labels = {
    task_created: "排队",
    task_started: "开始",
    task_succeeded: "成功",
    task_failed: "失败",
    task_paused: "暂停",
    agent_started: "Agent",
    agent_turn_started: "轮次",
    agent_turn_completed: "轮次",
    agent_tool_started: "工具",
    agent_tool_completed: "工具",
    agent_tool_failed: "工具",
    agent_message_completed: "输出",
    agent_compaction_started: "压缩",
    agent_compaction_completed: "压缩",
    agent_compaction_failed: "压缩",
    agent_retry_scheduled: "重试",
    agent_retry_completed: "重试",
    agent_retry_failed: "重试",
    agent_finished: "结束",
  };
  return labels[type] || type.replace(/^agent_/, "").replaceAll("_", " ");
}

function summarizePayload(payload) {
  if (!payload) {
    return "";
  }
  if (typeof payload.text === "string" && payload.text) {
    return payload.text;
  }
  if (payload.result && typeof payload.result === "object" && typeof payload.result.text === "string") {
    return payload.result.text;
  }
  if (typeof payload.toolName === "string") {
    return payload.toolName;
  }
  return "";
}

function formatStatus(status) {
  const labels = {
    queued: "排队",
    running: "运行",
    paused: "暂停",
    succeeded: "成功",
    failed: "失败",
    cancelled: "取消",
  };
  return labels[status] || status;
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(size) {
  if (!Number.isFinite(size)) {
    return "-";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

els.refreshTasks.addEventListener("click", () => refreshTasks().catch((error) => setOutput(error.message)));
els.createTaskForm.addEventListener("submit", (event) => createTask(event).catch((error) => setOutput(error.message)));
els.loadTask.addEventListener("click", () => loadTask().catch((error) => setOutput(error.message)));
els.connectEvents.addEventListener("click", () => connectEvents().catch((error) => setOutput(error.message)));
els.disconnectEvents.addEventListener("click", disconnectEvents);
els.loadFiles.addEventListener("click", () => loadFiles().catch((error) => setOutput(error.message)));
els.taskList.addEventListener("scroll", scheduleTaskRender, { passive: true });
els.eventLog.addEventListener(
  "scroll",
  () => {
    state.eventStickToBottom = isEventLogNearBottom();
    scheduleEventRender();
  },
  { passive: true },
);
window.addEventListener("resize", () => {
  scheduleTaskRender();
  scheduleEventRender();
});

renderEventSummary();
refreshTasks().catch((error) => setOutput(error.message));
