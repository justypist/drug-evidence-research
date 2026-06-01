const TASK_PAGE_SIZE = 100;
const TASK_ROW_HEIGHT = 76;
const TASK_OVERSCAN = 8;
const TASK_LIST_REFRESH_INTERVAL_MS = 3000;
const TASK_EVENT_REFRESH_DELAY_MS = 200;
const FILE_LIST_REFRESH_INTERVAL_MS = 3000;
const FILE_EVENT_REFRESH_DELAY_MS = 500;
const DELETE_CONFIRM_TIMEOUT_MS = 3000;
const EVENT_ROW_HEIGHT = 248;
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
const FILE_ICON_BY_EXTENSION = new Map([
  ["aac", "FileAudio"],
  ["avi", "FileVideo"],
  ["bmp", "FileImage"],
  ["css", "FileCode"],
  ["csv", "FileSpreadsheet"],
  ["db", "Database"],
  ["doc", "FilePenLine"],
  ["docx", "FilePenLine"],
  ["gif", "FileImage"],
  ["gz", "FileArchive"],
  ["htm", "FileCode"],
  ["html", "FileCode"],
  ["jpeg", "FileImage"],
  ["jpg", "FileImage"],
  ["js", "FileCode"],
  ["json", "FileJson"],
  ["jsonl", "FileJson"],
  ["log", "FileText"],
  ["md", "FileText"],
  ["mdx", "FileText"],
  ["mov", "FileVideo"],
  ["mp3", "FileAudio"],
  ["mp4", "FileVideo"],
  ["ndjson", "FileJson"],
  ["odp", "Presentation"],
  ["ods", "FileSpreadsheet"],
  ["odt", "FilePenLine"],
  ["pdf", "FileSignature"],
  ["png", "FileImage"],
  ["ppt", "Presentation"],
  ["pptx", "Presentation"],
  ["py", "FileCode"],
  ["rtf", "FileText"],
  ["sh", "FileCode"],
  ["sqlite", "Database"],
  ["sqlite3", "Database"],
  ["svg", "FileImage"],
  ["tar", "FileArchive"],
  ["ts", "FileCode"],
  ["tsv", "FileSpreadsheet"],
  ["txt", "FileText"],
  ["wav", "FileAudio"],
  ["webp", "FileImage"],
  ["xls", "FileSpreadsheet"],
  ["xlsx", "FileSpreadsheet"],
  ["xml", "FileCode"],
  ["yaml", "FileCode"],
  ["yml", "FileCode"],
  ["zip", "FileArchive"],
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
  eventLastSeq: 0,
  eventLastSeqTaskId: "",
  eventDbPromise: null,
  eventPersistQueue: [],
  eventPersistTimer: 0,
  fileRefreshInFlight: "",
  fileRefreshTimer: 0,
  fileCurrentPath: "",
  deleteConfirmTaskId: "",
  deleteConfirmPointerTaskId: "",
  deleteConfirmTimer: 0,
};

const els = {
  refreshTasks: document.querySelector("#refreshTasks"),
  openCreateTask: document.querySelector("#openCreateTask"),
  createTaskDialog: document.querySelector("#createTaskDialog"),
  closeCreateTask: document.querySelector("#closeCreateTask"),
  cancelCreateTask: document.querySelector("#cancelCreateTask"),
  createTaskButton: document.querySelector("#createTaskButton"),
  createTaskForm: document.querySelector("#createTaskForm"),
  drugInput: document.querySelector("#drugInput"),
  promptInput: document.querySelector("#promptInput"),
  metadataInput: document.querySelector("#metadataInput"),
  metadataError: document.querySelector("#metadataError"),
  taskList: document.querySelector("#taskList"),
  taskListMeta: document.querySelector("#taskListMeta"),
  taskDetail: document.querySelector("#taskDetail"),
  eventStatus: document.querySelector("#eventStatus"),
  eventSummary: document.querySelector("#eventSummary"),
  eventLog: document.querySelector("#eventLog"),
  rawEventDialog: document.querySelector("#rawEventDialog"),
  rawEventOutput: document.querySelector("#rawEventOutput"),
  closeRawEvent: document.querySelector("#closeRawEvent"),
  downloadZip: document.querySelector("#downloadZip"),
  fileList: document.querySelector("#fileList"),
  responseOutput: document.querySelector("#responseOutput"),
};

function t(key, replacements = {}) {
  return window.appI18n?.t ? window.appI18n.t(key, replacements) : key;
}

function getLocale() {
  return window.appI18n?.locale ? window.appI18n.locale() : document.documentElement.lang || "zh-CN";
}

function emptyState(key) {
  const element = document.createElement("div");
  element.className = "empty-state";
  element.textContent = t(key);
  return element;
}

function createLucideIcon(name) {
  const iconNode = window.lucide?.icons?.[name] || window.lucide?.icons?.File;
  if (!iconNode || !window.lucide?.createElement) {
    const fallback = document.createElement("span");
    fallback.className = "file-icon";
    fallback.setAttribute("aria-hidden", "true");
    return fallback;
  }
  const icon = window.lucide.createElement(iconNode, {
    class: "file-icon",
    "aria-hidden": "true",
    focusable: "false",
  });
  icon.removeAttribute("width");
  icon.removeAttribute("height");
  return icon;
}

function createFileName(iconName, label) {
  const nameRow = document.createElement("div");
  nameRow.className = "file-name";
  const name = document.createElement("strong");
  name.textContent = label;
  nameRow.append(createLucideIcon(iconName), name);
  return nameRow;
}

function getFileIconName(fileName) {
  const extension = getFileExtension(fileName);
  return FILE_ICON_BY_EXTENSION.get(extension) || "File";
}

function getFileExtension(fileName) {
  if (typeof fileName !== "string") {
    return "";
  }
  const normalizedName = fileName.trim().toLowerCase();
  const lastSegment = normalizedName.split("/").filter(Boolean).pop() || "";
  if (!lastSegment || lastSegment.startsWith(".") && !lastSegment.slice(1).includes(".")) {
    return "";
  }
  const index = lastSegment.lastIndexOf(".");
  return index > 0 && index < lastSegment.length - 1 ? lastSegment.slice(index + 1) : "";
}

function setOutput(value, kind = "") {
  els.responseOutput.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  els.responseOutput.className = `output${kind ? ` is-${kind}` : ""}`;
}

function showError(error) {
  setOutput(error?.message || String(error), "error");
}

function setButtonLoading(button, isLoading) {
  if (!button) {
    return;
  }
  button.disabled = isLoading;
  button.classList.toggle("is-loading", isLoading);
  button.setAttribute("aria-busy", isLoading ? "true" : "false");
}

function resetDeleteConfirmation(taskId = "") {
  const resetTaskId = taskId || state.deleteConfirmTaskId;
  const shouldClearState = !taskId || taskId === state.deleteConfirmTaskId;
  if (!resetTaskId) {
    return;
  }
  if (shouldClearState && state.deleteConfirmTimer) {
    window.clearTimeout(state.deleteConfirmTimer);
    state.deleteConfirmTimer = 0;
  }
  if (shouldClearState) {
    state.deleteConfirmTaskId = "";
    state.deleteConfirmPointerTaskId = "";
  }
  for (const button of document.querySelectorAll("[data-delete-task-id]")) {
    if (button.dataset.deleteTaskId !== resetTaskId) {
      continue;
    }
    button.textContent = t("task.delete");
    button.classList.remove("is-confirming");
  }
}

function setDeleteConfirmation(taskId) {
  resetDeleteConfirmation();
  state.deleteConfirmTaskId = taskId;
  setDeleteButtonsConfirming(taskId);
  state.deleteConfirmTimer = window.setTimeout(() => resetDeleteConfirmation(taskId), DELETE_CONFIRM_TIMEOUT_MS);
}

function setDeleteButtonsConfirming(taskId) {
  for (const button of document.querySelectorAll("[data-delete-task-id]")) {
    if (button.dataset.deleteTaskId !== taskId) {
      continue;
    }
    button.textContent = t("task.deleteConfirmInline");
    button.classList.add("is-confirming");
  }
}

function setSelectedTask(taskId) {
  const didTaskChange = state.selectedTaskId !== taskId;
  state.selectedTaskId = taskId;
  if (didTaskChange) {
    state.eventLastSeq = 0;
    state.eventLastSeqTaskId = taskId;
    state.fileCurrentPath = "";
    clearScheduledFileRefresh();
    els.fileList.replaceChildren(emptyState(taskId ? "state.loading" : "state.notSelected"));
    els.downloadZip.disabled = !taskId;
  }
  scheduleTaskRender();
}

function clearSelectedTaskView() {
  setSelectedTask("");
  disconnectEvents();
  state.eventQueue = [];
  state.eventCache = [];
  state.eventSeenKeys.clear();
  state.eventCount = 0;
  state.eventStats.clear();
  state.lastEventSummary = "";
  state.eventLastSeq = 0;
  state.eventLastSeqTaskId = "";
  els.taskDetail.replaceChildren(emptyState("state.notSelected"));
  els.eventLog.replaceChildren(emptyState("state.emptyEvents"));
  renderEventSummary();
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
    setOutput(result, response.ok ? "success" : "error");
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
    request.onerror = () => reject(request.error || new Error(t("db.openFailed")));
  }).catch((error) => {
    showError(t("db.unavailable", { message: error.message }));
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
    request.onerror = () => reject(request.error || new Error(t("db.readFailed")));
  }).catch((error) => {
    showError(error);
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
    persistQueuedEvents().catch(showError);
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
    tx.onerror = () => reject(tx.error || new Error(t("db.writeFailed")));
  });
}

async function refreshTasks(options = {}) {
  if (options.resetScroll) {
    els.taskList.scrollTop = 0;
  }
  state.taskCache.clear();
  state.taskPagesLoading.clear();
  state.taskTotal = 0;
  els.taskListMeta.textContent = t("state.loading");
  setButtonLoading(els.refreshTasks, true);
  try {
    await fetchTaskPage(0, { silent: false });
    scheduleTaskRender();
  } finally {
    setButtonLoading(els.refreshTasks, false);
  }
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
  els.taskListMeta.textContent = state.taskTotal > 0 ? `${loaded}/${state.taskTotal}` : t("state.emptyTasks");
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
    flushTaskRefreshes().catch(showError);
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
    scheduleFileRefresh();
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
    els.taskList.replaceChildren(emptyState("state.emptyTasks"));
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
      fetchTaskPage(offset).then(scheduleTaskRender).catch(showError);
    }
  }
}

function createTaskSkeleton(index) {
  const item = document.createElement("div");
  item.className = "task-item loading";
  item.dataset.index = String(index);
  const title = document.createElement("strong");
  title.textContent = t("state.loading");
  const meta = document.createElement("div");
  meta.className = "task-meta";
  meta.textContent = `#${index + 1}`;
  item.append(title, meta);
  return item;
}

function createTaskItem(task) {
  const item = document.createElement("div");
  item.className = `task-item ${task.id === state.selectedTaskId ? "selected" : ""}`;
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.setAttribute("aria-pressed", task.id === state.selectedTaskId ? "true" : "false");

  const info = document.createElement("div");
  info.className = "task-main";
  const head = document.createElement("div");
  head.className = "task-item-head";
  const title = document.createElement("strong");
  title.textContent = task.input?.drug || task.id;
  const badge = document.createElement("span");
  badge.className = `badge ${task.status}`;
  badge.textContent = formatStatus(task.status);
  head.append(title, badge);
  const meta = document.createElement("div");
  meta.className = "task-meta";
  meta.textContent = `${task.id} · ${t("task.attempts", { count: task.attemptCount })} · ${formatDateTime(task.createdAt)}`;
  info.append(head, meta);

  item.addEventListener("click", () => selectTask(task.id).catch(showError));
  item.addEventListener("keydown", (event) => {
    if (event.target !== item) {
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    selectTask(task.id).catch(showError);
  });
  item.append(info);
  return item;
}

async function selectTask(taskId) {
  setSelectedTask(taskId);
  await Promise.all([loadTask(taskId), refreshSelectedFiles(), connectEvents(taskId)]);
}

async function createTask(event) {
  event.preventDefault();
  const metadataText = els.metadataInput.value.trim();
  let metadata;
  if (metadataText) {
    try {
      metadata = JSON.parse(metadataText);
      setMetadataError("");
    } catch {
      setMetadataError(t("form.metadataInvalid"));
      els.metadataInput.focus();
      return;
    }
  } else {
    setMetadataError("");
  }
  const payload = {
    drug: els.drugInput.value.trim(),
    ...(els.promptInput.value.trim() ? { prompt: els.promptInput.value.trim() } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
  setButtonLoading(els.createTaskButton, true);
  try {
    const body = await requestJson("/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setSelectedTask(body.task.id);
    await refreshTasks({ resetScroll: true });
    await Promise.all([loadTask(body.task.id, { connectEvents: true }), refreshSelectedFiles()]);
    els.createTaskForm.reset();
    closeCreateTaskDialog();
  } finally {
    setButtonLoading(els.createTaskButton, false);
  }
}

function setMetadataError(message) {
  els.metadataError.textContent = message;
  els.metadataError.hidden = !message;
  els.metadataInput.setAttribute("aria-invalid", message ? "true" : "false");
}

function openCreateTaskDialog() {
  setMetadataError("");
  if (typeof els.createTaskDialog.showModal === "function") {
    els.createTaskDialog.showModal();
  } else {
    els.createTaskDialog.setAttribute("open", "");
  }
  els.drugInput.focus();
}

function closeCreateTaskDialog() {
  setMetadataError("");
  if (typeof els.createTaskDialog.close === "function" && els.createTaskDialog.open) {
    els.createTaskDialog.close();
    return;
  }
  els.createTaskDialog.removeAttribute("open");
}

async function loadTask(taskIdOverride = "", options = {}) {
  const taskId = taskIdOverride.trim() || state.selectedTaskId;
  if (!taskId) {
    showError(t("task.selectFirst"));
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
  actions.append(createTaskDeleteButton(task, "compact"));
  header.append(title, actions);
  els.taskDetail.append(header);

  const fields = [
    [t("task.id"), task.id],
    [t("task.createdAt"), formatDateTime(task.createdAt)],
    [t("task.startedAt"), formatDateTime(task.startedAt)],
    [t("task.finishedAt"), formatDateTime(task.finishedAt)],
    [t("task.attemptCount"), String(task.attemptCount)],
    [t("task.retryable"), task.status === "failed" ? (task.failureRetryable ? t("task.yes") : t("task.no")) : ""],
    [t("task.outputDir"), task.outputDir],
    [t("task.error"), task.errorMessage || ""],
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
    summary.textContent = t("task.input");
    const pre = document.createElement("pre");
    pre.className = "raw-json";
    pre.textContent = JSON.stringify(task.input, null, 2);
    details.append(summary, pre);
    els.taskDetail.append(details);
  }
}

function createTaskControlButton(task) {
  if (!canStopTask(task) && !canResumeTask(task)) {
    return null;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = canStopTask(task) ? "danger compact" : "secondary compact";
  button.textContent = canStopTask(task) ? t("task.stop") : t("task.resume");
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const action = canStopTask(task) ? "stop" : "resume";
    updateTaskState(task.id, action, button).catch(showError);
  });
  return button;
}

function createTaskDeleteButton(task, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `danger task-delete-button ${extraClass}`.trim();
  button.dataset.deleteTaskId = task.id;
  if (state.deleteConfirmTaskId === task.id) {
    button.textContent = t("task.deleteConfirmInline");
    button.classList.add("is-confirming");
  } else {
    button.textContent = t("task.delete");
  }
  button.addEventListener("pointerdown", () => {
    if (state.deleteConfirmTaskId === task.id) {
      state.deleteConfirmPointerTaskId = task.id;
    }
  });
  button.addEventListener("mouseleave", () => {
    if (state.deleteConfirmPointerTaskId !== task.id) {
      resetDeleteConfirmation(task.id);
    }
  });
  button.addEventListener("blur", () => {
    if (state.deleteConfirmPointerTaskId !== task.id) {
      resetDeleteConfirmation(task.id);
    }
  });
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    requestTaskDelete(task.id, button).catch(showError);
  });
  return button;
}

function canStopTask(task) {
  return ["queued", "running"].includes(task.status);
}

function canResumeTask(task) {
  return ["paused", "failed"].includes(task.status);
}

async function updateTaskState(taskId, action, button = null) {
  setButtonLoading(button, true);
  try {
    const body = await requestJson(`/tasks/${encodeURIComponent(taskId)}/${action}`, {
      method: "POST",
    });
    state.taskCache.clear();
    state.taskPagesLoading.clear();
    await fetchTaskPage(0, { silent: true });
    scheduleTaskRender();
    renderTaskDetail(body.task);
    if (taskId === state.selectedTaskId) {
      await refreshSelectedFiles();
    }
  } finally {
    setButtonLoading(button, false);
  }
}

async function requestTaskDelete(taskId, button) {
  if (state.deleteConfirmTaskId !== taskId) {
    setDeleteConfirmation(taskId);
    return;
  }
  resetDeleteConfirmation(taskId);
  setButtonLoading(button, true);
  try {
    await requestJson(`/tasks/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
    });
    const wasSelected = taskId === state.selectedTaskId;
    state.taskCache.clear();
    state.taskPagesLoading.clear();
    state.taskTotal = Math.max(0, state.taskTotal - 1);
    if (wasSelected) {
      clearSelectedTaskView();
    }
    await refreshTasks();
  } finally {
    state.deleteConfirmPointerTaskId = "";
    setButtonLoading(button, false);
  }
}

async function connectEvents(taskIdOverride = "") {
  const taskId = taskIdOverride.trim() || state.selectedTaskId;
  if (!taskId) {
    showError(t("task.selectFirst"));
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
  const lastEventId = state.eventLastSeqTaskId === taskId && state.eventLastSeq > 0 ? String(state.eventLastSeq) : "";
  const query = lastEventId ? `?lastEventId=${encodeURIComponent(lastEventId)}` : "";
  const source = new EventSource(`/tasks/${encodeURIComponent(taskId)}/events${query}`);
  state.events = source;
  state.eventTaskId = taskId;
  state.eventStickToBottom = true;
  state.eventLastScrollTop = els.eventLog.scrollTop;
  els.eventStatus.textContent = t("state.connecting");
  els.eventStatus.className = "status warning";

  source.onopen = () => {
    els.eventStatus.textContent = t("state.connected");
    els.eventStatus.className = "status ok";
  };
  source.onerror = () => {
    els.eventStatus.textContent = t("state.connectionError");
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
  els.eventStatus.textContent = t("state.notConnected");
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
    state.eventLastSeq = nextLastSeq;
    state.eventLastSeqTaskId = taskId;
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
  let shouldRefreshFiles = false;
  for (const event of events) {
    if (isTaskStatusEvent(event)) {
      scheduleTaskRefresh(event.taskId || state.eventTaskId);
      shouldRefreshFiles = shouldRefreshFiles || (event.taskId || state.eventTaskId) === state.selectedTaskId;
    }
  }
  const acceptedCount = appendEvents(events, { persist: true });
  if (shouldRefreshFiles || acceptedCount > 0) {
    scheduleFileRefresh();
  }
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
    els.eventLog.replaceChildren(emptyState("state.emptyEvents"));
    return;
  }

  const viewportHeight = Math.max(els.eventLog.clientHeight, EVENT_ROW_HEIGHT);
  const totalHeight = state.eventCache.length * EVENT_ROW_HEIGHT;
  const renderScrollTop = state.eventStickToBottom ? Math.max(0, totalHeight - viewportHeight) : els.eventLog.scrollTop;
  const startIndex = Math.max(0, Math.floor(renderScrollTop / EVENT_ROW_HEIGHT) - EVENT_OVERSCAN);
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
  if (state.eventStickToBottom) {
    setEventScrollTop(getEventLogMaxScrollTop());
  }
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

  const body = document.createElement("div");
  body.className = "event-body";
  const message = document.createElement("div");
  message.className = "event-message";
  message.textContent = event.message;
  if (event.fields.length > 0) {
    body.append(createEventFields(event.fields));
  }
  if (event.tools.length > 0) {
    body.append(createEventTools(event.tools));
  } else if (event.payloadText) {
    const payload = document.createElement("div");
    payload.className = "event-payload";
    payload.textContent = event.payloadText;
    body.append(payload);
  }

  item.append(top, message, body);
  if (event.showRawAction) {
    const actions = document.createElement("div");
    actions.className = "event-actions";
    actions.append(createRawButton(event.raw));
    item.append(actions);
  }
  return item;
}

function createEventFields(fields) {
  const container = document.createElement("div");
  container.className = "event-fields";
  for (const field of fields) {
    const item = document.createElement("div");
    item.className = "event-field";
    const label = document.createElement("span");
    label.textContent = field.label;
    const value = document.createElement("strong");
    value.textContent = field.value;
    item.append(label, value);
    container.append(item);
  }
  return container;
}

function createEventTools(tools) {
  const list = document.createElement("div");
  list.className = "event-tools";
  for (const tool of tools) {
    const row = document.createElement("div");
    row.className = "event-tool";
    const main = document.createElement("div");
    main.className = "event-tool-main";
    const title = document.createElement("strong");
    title.textContent = tool.title || t("event.tool");
    main.append(title);
    if (tool.subtitle) {
      const subtitle = document.createElement("span");
      subtitle.textContent = tool.subtitle;
      main.append(subtitle);
    }
    if (tool.preview) {
      const preview = document.createElement("div");
      preview.className = "event-tool-preview";
      preview.textContent = tool.preview;
      main.append(preview);
    }
    row.append(main);
    list.append(row);
  }
  return list;
}

function createRawButton(value) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary compact";
  button.textContent = t("event.raw");
  button.addEventListener("click", () => showRawValue(value));
  return button;
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
  const summary = summarizePayload(type, payload);
  return {
    raw: data,
    type,
    seq: seq ?? "",
    message,
    createdAt: data?.createdAt || "",
    label: eventLabel(type),
    kind: eventKind(type),
    fields: summary.fields,
    tools: summary.tools,
    payloadText: summary.text,
    showRawAction: true,
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
    state.eventLastSeq = seq;
    state.eventLastSeqTaskId = state.selectedTaskId;
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
  if (isEventLogNearBottom()) {
    state.eventStickToBottom = true;
  } else if (nextScrollTop < state.eventLastScrollTop) {
    state.eventStickToBottom = false;
  }
  state.eventLastScrollTop = nextScrollTop;
  scheduleEventRender();
}

function handleEventLogWheel(event) {
  if (event.deltaY < 0) {
    state.eventStickToBottom = false;
    return;
  }
  if (event.deltaY > 0 && isEventLogNearBottom()) {
    state.eventStickToBottom = true;
  }
}

function showRawEvent(event) {
  showRawValue(event.raw);
}

function showRawValue(value) {
  const output = JSON.stringify(value, null, 2);
  els.rawEventOutput.textContent = output;
  if (typeof els.rawEventDialog.showModal === "function") {
    els.rawEventDialog.showModal();
    return;
  }
  setOutput(output, "success");
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
  if (state.eventLastSeqTaskId !== taskId) {
    return 0;
  }
  return state.eventLastSeq;
}

function isEventLogNearBottom() {
  return getEventLogMaxScrollTop() - els.eventLog.scrollTop <= EVENT_BOTTOM_EPSILON;
}

function getEventLogMaxScrollTop() {
  return Math.max(0, els.eventLog.scrollHeight - els.eventLog.clientHeight);
}

function renderEventSummary() {
  const tools =
    (state.eventStats.get("agent_tool_completed") || 0) +
    (state.eventStats.get("agent_tool_failed") || 0);
  const outputs = state.eventStats.get("agent_message_completed") || 0;
  els.eventSummary.innerHTML = "";
  const items = [
    [t("event.count"), String(state.eventCount)],
    [t("event.tools"), String(tools)],
    [t("event.outputs"), String(outputs)],
  ];
  for (const [label, value] of items) {
    const item = document.createElement("div");
    item.className = "summary-tile";
    item.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    els.eventSummary.append(item);
  }
  const last = document.createElement("div");
  last.className = "summary-latest";
  last.textContent = state.lastEventSummary || t("event.waiting");
  els.eventSummary.append(last);
}

async function downloadTaskZip() {
  const taskId = state.selectedTaskId;
  if (!taskId) {
    showError(t("task.selectFirst"));
    return;
  }
  setButtonLoading(els.downloadZip, true);
  try {
    const response = await fetch(`/tasks/${encodeURIComponent(taskId)}/files.zip`);
    if (!response.ok) {
      const text = await response.text();
      const body = text ? safeJson(text) : null;
      throw new Error(body?.error || `HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `${taskId}-artifacts.zip`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setOutput({
      status: response.status,
      ok: true,
      body: {
        file: link.download,
        size: blob.size,
      },
    }, "success");
  } finally {
    setButtonLoading(els.downloadZip, false);
  }
}

function scheduleFileRefresh() {
  if (!state.selectedTaskId || state.fileRefreshTimer) {
    return;
  }
  state.fileRefreshTimer = window.setTimeout(() => {
    state.fileRefreshTimer = 0;
    refreshSelectedFiles().catch(showError);
  }, FILE_EVENT_REFRESH_DELAY_MS);
}

function clearScheduledFileRefresh() {
  if (!state.fileRefreshTimer) {
    return;
  }
  window.clearTimeout(state.fileRefreshTimer);
  state.fileRefreshTimer = 0;
}

async function refreshSelectedFiles() {
  const taskId = state.selectedTaskId;
  if (!taskId || state.fileRefreshInFlight === taskId) {
    return;
  }
  state.fileRefreshInFlight = taskId;
  try {
    const body = await requestJson(`/tasks/${encodeURIComponent(taskId)}/files`, {}, { silent: true });
    if (state.selectedTaskId !== taskId) {
      return;
    }
    renderFiles(taskId, body.files || []);
  } finally {
    if (state.fileRefreshInFlight === taskId) {
      state.fileRefreshInFlight = "";
    }
  }
}

function renderFiles(taskId, files) {
  els.fileList.innerHTML = "";
  if (files.length === 0) {
    els.fileList.replaceChildren(emptyState("state.emptyFiles"));
    return;
  }
  const tree = buildFileDirectoryView(files, state.fileCurrentPath);
  state.fileCurrentPath = tree.currentPath;
  els.fileList.append(createFileBreadcrumb(taskId, tree.currentPath));
  if (tree.entries.length === 0) {
    els.fileList.append(emptyState("state.emptyFiles"));
    return;
  }
  for (const entry of tree.entries) {
    if (entry.kind === "folder") {
      els.fileList.append(createFolderItem(taskId, entry));
    } else {
      els.fileList.append(createFileItem(taskId, entry.file));
    }
  }
}

function buildFileDirectoryView(files, currentPath) {
  const normalizedCurrentPath = normalizeFilePath(currentPath);
  const hasCurrentPath = normalizedCurrentPath === "" || files.some((file) => {
    const normalizedPath = normalizeFilePath(file.path);
    return normalizedPath === normalizedCurrentPath || normalizedPath.startsWith(`${normalizedCurrentPath}/`);
  });
  const safeCurrentPath = hasCurrentPath ? normalizedCurrentPath : "";
  const folders = new Map();
  const currentFiles = [];
  for (const file of files) {
    const filePath = normalizeFilePath(file.path);
    if (safeCurrentPath && !filePath.startsWith(`${safeCurrentPath}/`)) {
      continue;
    }
    const relativePath = safeCurrentPath ? filePath.slice(safeCurrentPath.length).replace(/^\/+/, "") : filePath;
    if (!relativePath) {
      continue;
    }
    const [segment] = relativePath.split("/");
    if (!segment) {
      continue;
    }
    if (relativePath.includes("/")) {
      const folderPath = safeCurrentPath ? `${safeCurrentPath}/${segment}` : segment;
      const existing = folders.get(folderPath);
      folders.set(folderPath, {
        kind: "folder",
        name: segment,
        path: folderPath,
        count: (existing?.count || 0) + 1,
        modifiedAt: latestDate(existing?.modifiedAt, file.modifiedAt),
      });
    } else {
      currentFiles.push({
        ...file,
        path: filePath,
        name: segment,
      });
    }
  }
  const entries = [
    ...[...folders.values()].sort((a, b) => a.name.localeCompare(b.name, getLocale())),
    ...currentFiles
      .sort((a, b) => a.name.localeCompare(b.name, getLocale()))
      .map((file) => ({ kind: "file", file })),
  ];
  return {
    currentPath: safeCurrentPath,
    entries,
  };
}

function createFileBreadcrumb(taskId, currentPath) {
  const nav = document.createElement("nav");
  nav.className = "file-breadcrumb";
  nav.setAttribute("aria-label", t("files.location"));
  const rootButton = createFolderNavButton(taskId, "", t("files.root"));
  nav.append(rootButton);
  if (!currentPath) {
    rootButton.setAttribute("aria-current", "page");
    return nav;
  }
  const parts = currentPath.split("/").filter(Boolean);
  let path = "";
  for (const part of parts) {
    path = path ? `${path}/${part}` : part;
    nav.append(createBreadcrumbSeparator());
    const button = createFolderNavButton(taskId, path, part);
    if (path === currentPath) {
      button.setAttribute("aria-current", "page");
    }
    nav.append(button);
  }
  return nav;
}

function createBreadcrumbSeparator() {
  const separator = document.createElement("span");
  separator.className = "breadcrumb-separator";
  separator.textContent = "/";
  separator.setAttribute("aria-hidden", "true");
  return separator;
}

function createFolderNavButton(taskId, path, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "file-path-button";
  button.textContent = label;
  button.addEventListener("click", () => openFileFolder(taskId, path));
  return button;
}

function createFolderItem(taskId, folder) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "file-item folder-item";
  item.addEventListener("click", () => openFileFolder(taskId, folder.path));
  const main = document.createElement("div");
  main.className = "file-main";
  const name = createFileName("Folder", folder.name);
  const meta = document.createElement("div");
  meta.className = "file-meta";
  meta.textContent = `${t("files.folder")} · ${t("files.itemCount", { count: folder.count })}`;
  main.append(name, meta);
  const action = document.createElement("span");
  action.className = "file-open-label";
  action.textContent = t("files.open");
  item.append(main, action);
  return item;
}

function createFileItem(taskId, file) {
  const item = document.createElement("div");
  item.className = "file-item";
  const main = document.createElement("div");
  main.className = "file-main";
  const displayName = file.name || file.path;
  const name = createFileName(getFileIconName(displayName), displayName);
  const meta = document.createElement("div");
  meta.className = "file-meta";
  meta.textContent = `${formatBytes(file.size)} · ${formatDateTime(file.modifiedAt)}`;
  main.append(name, meta);
  const actions = document.createElement("div");
  actions.className = "inline-actions";
  const link = document.createElement("a");
  link.href = `/tasks/${encodeURIComponent(taskId)}/files/${file.fileId}`;
  link.textContent = t("action.download");
  link.target = "_blank";
  link.rel = "noreferrer";
  actions.append(link);
  item.append(main, actions);
  return item;
}

function openFileFolder(taskId, path) {
  if (taskId !== state.selectedTaskId) {
    return;
  }
  state.fileCurrentPath = normalizeFilePath(path);
  refreshSelectedFiles().catch(showError);
}

function normalizeFilePath(path) {
  if (typeof path !== "string") {
    return "";
  }
  return path
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

function latestDate(currentValue, nextValue) {
  if (!currentValue) {
    return nextValue || "";
  }
  if (!nextValue) {
    return currentValue;
  }
  return new Date(nextValue).getTime() > new Date(currentValue).getTime() ? nextValue : currentValue;
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
    task_created: t("event.taskCreated"),
    task_started: t("event.taskStarted"),
    task_succeeded: t("event.taskSucceeded"),
    task_failed: t("event.taskFailed"),
    task_paused: t("event.taskPaused"),
    agent_started: t("event.agent"),
    agent_turn_started: t("event.turn"),
    agent_turn_completed: t("event.turn"),
    agent_tool_started: t("event.tool"),
    agent_tool_completed: t("event.tool"),
    agent_tool_failed: t("event.tool"),
    agent_message_completed: t("event.output"),
    agent_compaction_started: t("event.compaction"),
    agent_compaction_completed: t("event.compaction"),
    agent_compaction_failed: t("event.compaction"),
    agent_retry_scheduled: t("event.retry"),
    agent_retry_completed: t("event.retry"),
    agent_retry_failed: t("event.retry"),
    agent_finished: t("event.finished"),
  };
  return labels[type] || type.replace(/^agent_/, "").replaceAll("_", " ");
}

function summarizePayload(type, payload) {
  const summary = {
    fields: [],
    tools: [],
    text: "",
  };
  if (!payload) {
    return summary;
  }

  if (type === "agent_message_completed") {
    addSummaryField(summary, t("event.field.stopReason"), payload.stopReason);
    addSummaryField(summary, t("event.field.usage"), formatUsage(payload.usage));
    if (Array.isArray(payload.toolCalls)) {
      summary.tools = payload.toolCalls.map((toolCall) => summarizeToolCall(toolCall));
    }
    if (typeof payload.text === "string" && payload.text) {
      summary.text = payload.text;
    }
    return summary;
  }

  if (type === "agent_tool_completed" || type === "agent_tool_failed") {
    addSummaryField(summary, t("event.field.toolCallId"), payload.toolCallId);
    addSummaryField(summary, t("event.field.status"), payload.isError ? t("event.status.failed") : t("event.status.completed"));
    summary.tools = [summarizeToolResult(payload)];
    return summary;
  }

  if (type === "agent_turn_completed") {
    if (Array.isArray(payload.nodes)) {
      summary.tools = payload.nodes.map((node) => summarizeExecutionNode(node));
    }
    return summary;
  }

  if (typeof payload.text === "string" && payload.text) {
    summary.text = payload.text;
    return summary;
  }

  if (payload.result && typeof payload.result === "object" && typeof payload.result.text === "string") {
    summary.text = payload.result.text;
    return summary;
  }

  for (const [key, value] of Object.entries(payload).slice(0, 4)) {
    if (["rawMessage", "rawResult"].includes(key)) {
      continue;
    }
    addSummaryField(summary, formatFieldLabel(key), value);
  }
  if (summary.fields.length === 0) {
    summary.text = formatSummaryValue(payload);
  }
  return summary;
}

function summarizeToolCall(toolCall) {
  return {
    title: formatSummaryValue(toolCall?.name) || t("event.tool"),
    subtitle: formatSummaryValue(toolCall?.id),
    preview: formatToolArguments(toolCall?.arguments),
    raw: toolCall?.raw ?? toolCall,
  };
}

function summarizeExecutionNode(node) {
  const status = node?.isError ? t("event.status.failed") : t("event.status.completed");
  return {
    title: formatSummaryValue(node?.name) || t("event.node"),
    subtitle: [status, formatSummaryValue(node?.id)].filter(Boolean).join(" · "),
    preview: compactText(formatSummaryValue(node?.text || node?.details), 420),
    raw: node?.raw ?? node,
  };
}

function summarizeToolResult(payload) {
  const result = payload?.result && typeof payload.result === "object" ? payload.result : null;
  return {
    title: formatSummaryValue(payload?.toolName) || t("event.tool"),
    subtitle: formatSummaryValue(payload?.toolCallId),
    preview: result ? summarizeResultPreview(result) : "",
    raw: payload?.rawResult ?? result ?? payload,
  };
}

function summarizeResultPreview(result) {
  if (typeof result.text === "string" && result.text) {
    return compactText(result.text, 420);
  }
  if (result.details !== null && result.details !== undefined) {
    return compactText(formatSummaryValue(result.details), 420);
  }
  return "";
}

function formatToolArguments(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  return `${t("event.field.arguments")}: ${compactText(formatSummaryValue(value), 420)}`;
}

function addSummaryField(summary, label, value) {
  const text = formatSummaryValue(value);
  if (!text) {
    return;
  }
  summary.fields.push({ label, value: text });
}

function formatUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const entries = Object.entries(value)
    .filter(([, entryValue]) => typeof entryValue === "number" || typeof entryValue === "string")
    .slice(0, 4)
    .map(([key, entryValue]) => `${formatFieldLabel(key)} ${entryValue}`);
  return entries.length > 0 ? entries.join(" / ") : value;
}

function formatSummaryValue(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (typeof value === "string") {
    return compactText(value, 420);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "" : compactText(JSON.stringify(value), 420);
  }
  if (typeof value === "object") {
    return compactText(JSON.stringify(value), 420);
  }
  return compactText(String(value), 420);
}

function formatFieldLabel(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .trim();
}

function compactText(value, maxLength) {
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function formatStatus(status) {
  const labels = {
    queued: t("status.queued"),
    running: t("status.running"),
    paused: t("status.paused"),
    succeeded: t("status.succeeded"),
    failed: t("status.failed"),
    cancelled: t("status.cancelled"),
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
  return date.toLocaleString(getLocale(), {
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
    return t("format.bytes", { size });
  }
  if (size < 1024 * 1024) {
    return t("format.kb", { size: (size / 1024).toFixed(1) });
  }
  return t("format.mb", { size: (size / 1024 / 1024).toFixed(1) });
}

els.refreshTasks.addEventListener("click", () => refreshTasks().catch(showError));
els.openCreateTask.addEventListener("click", openCreateTaskDialog);
els.closeCreateTask.addEventListener("click", closeCreateTaskDialog);
els.cancelCreateTask.addEventListener("click", closeCreateTaskDialog);
els.createTaskDialog.addEventListener("click", (event) => {
  if (event.target === els.createTaskDialog) {
    closeCreateTaskDialog();
  }
});
els.createTaskForm.addEventListener("submit", (event) => createTask(event).catch(showError));
els.downloadZip.addEventListener("click", () => downloadTaskZip().catch(showError));
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
    refreshVisibleTaskPages().catch(showError);
    refreshSelectedFiles().catch(showError);
  }
});

renderEventSummary();
refreshTasks().catch(showError);
window.setInterval(() => {
  if (!document.hidden) {
    refreshVisibleTaskPages().catch(showError);
  }
}, TASK_LIST_REFRESH_INTERVAL_MS);
window.setInterval(() => {
  if (!document.hidden) {
    refreshSelectedFiles().catch(showError);
  }
}, FILE_LIST_REFRESH_INTERVAL_MS);
