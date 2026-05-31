const TASK_PAGE_SIZE = 100;
const TASK_ROW_HEIGHT = 76;
const TASK_OVERSCAN = 8;
const TASK_LIST_REFRESH_INTERVAL_MS = 3000;
const TASK_EVENT_REFRESH_DELAY_MS = 200;
const EVENT_ROW_HEIGHT = 132;
const EVENT_OVERSCAN = 8;
const EVENT_BOTTOM_EPSILON = 4;
const EVENT_DB_NAME = "drug-evidence-research";
const EVENT_DB_VERSION = 2;
const EVENT_STORE_NAME = "taskEvents";
const CACHEABLE_AGENT_EVENT_TYPES = new Set([
  "agent_turn_completed",
  "agent_tool_completed",
  "agent_tool_failed",
  "agent_message_completed",
  "agent_compaction_completed",
  "agent_compaction_failed",
  "agent_retry_completed",
  "agent_retry_failed",
  "agent_finished",
]);
const DISCARDED_EVENT_TYPES = new Set([
  "agent_started",
  "agent_turn_started",
  "agent_tool_started",
  "agent_compaction_started",
  "agent_retry_scheduled",
  "agent_queue_updated",
  "agent_session_updated",
  "agent_thinking_level_changed",
  "message_start",
  "message_update",
  "tool_execution_update",
]);

const state = {
  selectedTaskId: "",
  events: null,
  eventTaskId: "",
  taskCache: new Map(),
  taskPagesLoading: new Set(),
  taskTotal: 0,
  taskRenderFrame: 0,
  taskListRefreshInFlight: false,
  taskRefreshIds: new Set(),
  taskRefreshTimer: 0,
  eventQueue: [],
  eventCache: [],
  eventSeenKeys: new Set(),
  eventFrame: 0,
  eventRenderFrame: 0,
  eventStickToBottom: false,
  eventLastScrollTop: 0,
  suppressEventScroll: false,
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
  rawEventDialog: document.querySelector("#rawEventDialog"),
  rawEventOutput: document.querySelector("#rawEventOutput"),
  closeRawEvent: document.querySelector("#closeRawEvent"),
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
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      let store;
      if (!db.objectStoreNames.contains(EVENT_STORE_NAME)) {
        store = db.createObjectStore(EVENT_STORE_NAME, { keyPath: "key" });
        store.createIndex("taskIdSeq", ["taskId", "seq"], { unique: true });
        store.createIndex("taskId", "taskId", { unique: false });
      } else if (tx) {
        store = tx.objectStore(EVENT_STORE_NAME);
        if (!store.indexNames.contains("taskIdSeq")) {
          store.createIndex("taskIdSeq", ["taskId", "seq"], { unique: true });
        }
        if (!store.indexNames.contains("taskId")) {
          store.createIndex("taskId", "taskId", { unique: false });
        }
      }
      if (store && event.oldVersion < 2) {
        purgeUncacheableEventsFromStore(store);
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

function purgeUncacheableEventsFromStore(store) {
  const request = store.openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) {
      return;
    }
    if (!isCacheableEvent(cursor.value?.event)) {
      cursor.delete();
    }
    cursor.continue();
  };
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
      resolve(rows.filter((row) => isCacheableEvent(row.event)).map((row) => row.event));
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
  let queued = false;
  for (const event of events) {
    if (!isCacheableEvent(event)) {
      continue;
    }
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
    queued = true;
  }
  if (!queued) {
    return;
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

async function refreshVisibleTaskPages() {
  if (state.taskListRefreshInFlight) {
    return;
  }
  state.taskListRefreshInFlight = true;
  try {
    const offsets = getVisibleTaskPageOffsets();
    await Promise.all(offsets.map((offset) => fetchTaskPage(offset, { silent: true })));
    scheduleTaskRender();
  } finally {
    state.taskListRefreshInFlight = false;
  }
}

function getVisibleTaskPageOffsets() {
  const viewportHeight = Math.max(els.taskList.clientHeight, TASK_ROW_HEIGHT);
  const startIndex = Math.max(0, Math.floor(els.taskList.scrollTop / TASK_ROW_HEIGHT) - TASK_OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / TASK_ROW_HEIGHT) + TASK_OVERSCAN * 2;
  const endIndex = Math.min(Math.max(0, state.taskTotal - 1), startIndex + visibleCount);
  const offsets = new Set([0]);
  const firstPage = Math.floor(startIndex / TASK_PAGE_SIZE) * TASK_PAGE_SIZE;
  const lastPage = Math.floor(endIndex / TASK_PAGE_SIZE) * TASK_PAGE_SIZE;
  for (let offset = firstPage; offset <= lastPage; offset += TASK_PAGE_SIZE) {
    offsets.add(offset);
  }
  return [...offsets];
}

function scheduleTaskRefresh(taskId) {
  if (!taskId) {
    return;
  }
  state.taskRefreshIds.add(taskId);
  if (state.taskRefreshTimer) {
    return;
  }
  state.taskRefreshTimer = window.setTimeout(() => {
    state.taskRefreshTimer = 0;
    flushTaskRefreshes().catch((error) => setOutput(error.message));
  }, TASK_EVENT_REFRESH_DELAY_MS);
}

async function flushTaskRefreshes() {
  const taskIds = [...state.taskRefreshIds];
  state.taskRefreshIds.clear();
  await Promise.all(taskIds.map(refreshTask));
}

async function refreshTask(taskId) {
  const body = await requestJson(`/tasks/${encodeURIComponent(taskId)}`, {}, { silent: true });
  updateCachedTask(body.task);
  if (state.selectedTaskId === taskId) {
    renderTaskDetail(body.task);
  }
}

function updateCachedTask(task) {
  const index = findCachedTaskIndex(task.id);
  if (index === null) {
    return;
  }
  state.taskCache.set(index, task);
  scheduleTaskRender();
}

function findCachedTaskIndex(taskId) {
  for (const [index, task] of state.taskCache) {
    if (task?.id === taskId) {
      return index;
    }
  }
  return null;
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
  button.addEventListener("click", () => selectTask(task.id).catch((error) => setOutput(error.message)));
  const controlButton = createTaskControlButton(task);
  actions.append(badge);
  if (controlButton) {
    actions.append(controlButton);
  }
  actions.append(button);

  item.addEventListener("dblclick", () => selectTask(task.id).catch((error) => setOutput(error.message)));
  item.append(info, actions);
  return item;
}

async function selectTask(taskId) {
  setSelectedTask(taskId);
  await Promise.all([loadTask(), loadFiles(), connectEvents(taskId)]);
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
  await loadTask({ connectEvents: true });
}

async function loadTask(options = {}) {
  const taskId = els.taskIdInput.value.trim();
  if (!taskId) {
    setOutput("请先输入或选择 task id");
    return;
  }
  setSelectedTask(taskId);
  const body = await requestJson(`/tasks/${encodeURIComponent(taskId)}`);
  if (state.selectedTaskId !== taskId) {
    return;
  }
  updateCachedTask(body.task);
  renderTaskDetail(body.task);
  if (options.connectEvents) {
    await connectEvents(taskId);
  }
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
  const actions = document.createElement("div");
  actions.className = "inline-actions";
  actions.append(badge);
  const controlButton = createTaskControlButton(task);
  if (controlButton) {
    actions.append(controlButton);
  }
  header.append(title, actions);
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

function createTaskControlButton(task) {
  if (!canPauseTask(task) && !canResumeTask(task)) {
    return null;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = canPauseTask(task) ? "danger compact" : "secondary compact";
  button.textContent = canPauseTask(task) ? "停止" : "继续";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const action = canPauseTask(task) ? "pause" : "resume";
    updateTaskState(task.id, action).catch((error) => setOutput(error.message));
  });
  return button;
}

function canPauseTask(task) {
  return ["queued", "running", "failed"].includes(task.status);
}

function canResumeTask(task) {
  return ["paused", "failed", "cancelled"].includes(task.status);
}

async function updateTaskState(taskId, action) {
  const body = await requestJson(`/tasks/${encodeURIComponent(taskId)}/${action}`, {
    method: "POST",
  });
  state.taskCache.clear();
  state.taskPagesLoading.clear();
  await fetchTaskPage(0, { silent: true });
  scheduleTaskRender();
  renderTaskDetail(body.task);
  if (taskId === state.selectedTaskId) {
    await loadFiles();
  }
}

async function connectEvents(taskIdOverride = "") {
  const taskId = taskIdOverride.trim() || els.taskIdInput.value.trim();
  if (!taskId) {
    setOutput("请先输入或选择 task id");
    return;
  }
  if (state.events && state.eventTaskId === taskId && state.events.readyState !== EventSource.CLOSED) {
    return;
  }
  disconnectEvents();
  setSelectedTask(taskId);
  await resetEventView(taskId);
  if (state.selectedTaskId !== taskId) {
    return;
  }
  const cachedLastSeq = getLastCachedEventSeq();
  const manualLastEventId = els.lastEventIdInput.dataset.taskId === taskId ? els.lastEventIdInput.value.trim() : "";
  const lastEventId = manualLastEventId || (cachedLastSeq > 0 ? String(cachedLastSeq) : "");
  const query = lastEventId ? `?lastEventId=${encodeURIComponent(lastEventId)}` : "";
  const source = new EventSource(`/tasks/${encodeURIComponent(taskId)}/events${query}`);
  state.events = source;
  state.eventTaskId = taskId;
  state.eventStickToBottom = true;
  state.eventLastScrollTop = els.eventLog.scrollTop;
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
  state.eventTaskId = "";
  els.connectEvents.disabled = false;
  els.disconnectEvents.disabled = true;
  els.eventStatus.textContent = "未连接";
  els.eventStatus.className = "status muted";
}

async function resetEventView(taskId) {
  const currentLastSeq = getCurrentTaskLastEventSeq(taskId);
  state.eventQueue = [];
  state.eventCache = [];
  state.eventSeenKeys.clear();
  state.eventStickToBottom = true;
  state.eventLastScrollTop = 0;
  state.suppressEventScroll = false;
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
  const nextLastSeq = Math.max(currentLastSeq, cachedLastSeq);
  if (nextLastSeq > 0) {
    els.lastEventIdInput.value = String(nextLastSeq);
    els.lastEventIdInput.dataset.taskId = taskId;
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
  for (const event of events) {
    if (isTaskStatusEvent(event)) {
      scheduleTaskRefresh(event.taskId || state.eventTaskId);
    }
  }
  const acceptedCount = appendEvents(events, { persist: true });
  if (acceptedCount === 0) {
    return;
  }
  renderEventSummary();
  scheduleEventRender();
}

function appendEvents(events, options) {
  const accepted = [];
  for (const rawEvent of events) {
    rememberEventSeq(rawEvent);
    if (!isDisplayableEvent(rawEvent)) {
      continue;
    }
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
  return accepted.length;
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
    setEventScrollTop(Math.max(0, totalHeight - viewportHeight));
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

  const actions = document.createElement("div");
  actions.className = "event-actions";
  const rawButton = document.createElement("button");
  rawButton.type = "button";
  rawButton.className = "secondary compact";
  rawButton.textContent = "原始数据";
  rawButton.addEventListener("click", () => showRawEvent(event));
  actions.append(rawButton);
  item.append(actions);
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
    rememberEventSeq(event.raw);
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

function rememberEventSeq(event) {
  const seq = normalizeEventSeq(event);
  if (seq !== null && seq > 0) {
    els.lastEventIdInput.value = String(seq);
    els.lastEventIdInput.dataset.taskId = state.selectedTaskId;
  }
}

function setEventScrollTop(value) {
  state.suppressEventScroll = true;
  els.eventLog.scrollTop = value;
  state.eventLastScrollTop = els.eventLog.scrollTop;
  window.requestAnimationFrame(() => {
    state.suppressEventScroll = false;
  });
}

function handleEventLogScroll() {
  const nextScrollTop = els.eventLog.scrollTop;
  if (state.suppressEventScroll) {
    state.eventLastScrollTop = nextScrollTop;
    return;
  }
  if (nextScrollTop < state.eventLastScrollTop) {
    state.eventStickToBottom = false;
  } else if (nextScrollTop > state.eventLastScrollTop && isEventLogNearBottom()) {
    state.eventStickToBottom = true;
  }
  state.eventLastScrollTop = nextScrollTop;
  scheduleEventRender();
}

function handleEventLogWheel(event) {
  if (event.deltaY < 0) {
    state.eventStickToBottom = false;
  }
}

function showRawEvent(event) {
  const output = JSON.stringify(event.raw, null, 2);
  els.rawEventOutput.textContent = output;
  if (typeof els.rawEventDialog.showModal === "function") {
    els.rawEventDialog.showModal();
    return;
  }
  setOutput(output);
}

function isDisplayableEvent(event) {
  const type = typeof event?.type === "string" ? event.type : "";
  return !DISCARDED_EVENT_TYPES.has(type);
}

function isCacheableEvent(event) {
  const type = typeof event?.type === "string" ? event.type : "";
  return type.startsWith("task_") || CACHEABLE_AGENT_EVENT_TYPES.has(type);
}

function isTaskStatusEvent(event) {
  const type = typeof event?.type === "string" ? event.type : "";
  return type.startsWith("task_");
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

function getCurrentTaskLastEventSeq(taskId) {
  if (els.lastEventIdInput.dataset.taskId !== taskId) {
    return 0;
  }
  return normalizeEventSeq({ seq: els.lastEventIdInput.value }) ?? 0;
}

function isEventLogNearBottom() {
  const totalHeight = state.eventCache.length * EVENT_ROW_HEIGHT;
  return els.eventLog.scrollTop + els.eventLog.clientHeight >= totalHeight - EVENT_BOTTOM_EPSILON;
}

function renderEventSummary() {
  const tools =
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
  if (state.selectedTaskId !== taskId) {
    return;
  }
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
els.loadTask.addEventListener("click", () => loadTask({ connectEvents: true }).catch((error) => setOutput(error.message)));
els.connectEvents.addEventListener("click", () => connectEvents().catch((error) => setOutput(error.message)));
els.disconnectEvents.addEventListener("click", disconnectEvents);
els.loadFiles.addEventListener("click", () => loadFiles().catch((error) => setOutput(error.message)));
els.taskList.addEventListener("scroll", scheduleTaskRender, { passive: true });
els.eventLog.addEventListener("wheel", handleEventLogWheel, { passive: true });
els.eventLog.addEventListener("scroll", handleEventLogScroll, { passive: true });
els.closeRawEvent.addEventListener("click", () => els.rawEventDialog.close());
window.addEventListener("resize", () => {
  scheduleTaskRender();
  scheduleEventRender();
});
window.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshVisibleTaskPages().catch((error) => setOutput(error.message));
  }
});

renderEventSummary();
refreshTasks().catch((error) => setOutput(error.message));
window.setInterval(() => {
  if (!document.hidden) {
    refreshVisibleTaskPages().catch((error) => setOutput(error.message));
  }
}, TASK_LIST_REFRESH_INTERVAL_MS);
