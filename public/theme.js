(function () {
  const STORAGE_KEY = "drug-evidence-research.theme";
  const MODES = new Set(["system", "light", "dark"]);
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  const dictionaries = {
    "zh-CN": {
      "app.title": "Drug Evidence Research",
      "app.subtitle": "任务运行面板",
      "nav.skillEditor": "SKILL 编辑器",
      "action.refreshTasks": "刷新任务",
      "action.createTask": "创建任务",
      "action.close": "关闭",
      "action.download": "下载",
      "action.downloadZip": "下载 ZIP",
      "action.reload": "重新加载",
      "action.save": "保存",
      "theme.label": "主题",
      "theme.system": "跟随系统",
      "theme.light": "浅色",
      "theme.dark": "深色",
      "create.title": "创建任务",
      "create.drug": "药物 / 候选物",
      "create.drugPlaceholder": "ABC-123",
      "create.prompt": "额外 Prompt",
      "create.promptPlaceholder": "可选：补充检索要求",
      "create.metadata": "Metadata JSON",
      "create.metadataPlaceholder": "{\"sponsor\":\"example\"}",
      "tasks.title": "任务列表",
      "tasks.aria": "任务列表",
      "detail.title": "任务详情",
      "events.title": "SSE 事件",
      "events.rawTitle": "事件原始数据",
      "files.title": "产物文件",
      "response.title": "请求结果",
      "skill.title": "SKILL 实时编辑器",
      "skill.subtitle": "保存后对后续 Worker 任务实时生效",
      "skill.editorTitle": "单文件 SKILL.md",
      "skill.previewTitle": "实时预览",
      "skill.editorAria": "SKILL.md 编辑器",
      "state.notLoaded": "未加载",
      "state.notSelected": "未选择任务",
      "state.notConnected": "未连接",
      "state.waiting": "等待操作",
      "state.waitingLoad": "等待加载",
      "state.zeroChars": "0 字符",
      "state.loading": "加载中",
      "state.emptyTasks": "暂无任务",
      "state.emptyEvents": "暂无事件",
      "state.emptyFiles": "暂无文件",
      "state.noChanges": "无改动",
      "state.waitingSave": "等待保存",
      "state.saving": "保存中",
      "state.saved": "已保存，后续任务生效",
      "state.loaded": "已加载",
      "state.connecting": "连接中",
      "state.connected": "已连接",
      "state.connectionError": "连接错误或已断开",
      "status.queued": "排队",
      "status.running": "运行",
      "status.paused": "暂停",
      "status.succeeded": "成功",
      "status.failed": "失败",
      "status.cancelled": "取消",
      "task.attempts": "{count} 次",
      "task.selectFirst": "请先选择任务",
      "task.stop": "停止",
      "task.resume": "继续",
      "task.id": "Task ID",
      "task.createdAt": "创建时间",
      "task.startedAt": "开始时间",
      "task.finishedAt": "完成时间",
      "task.attemptCount": "尝试次数",
      "task.retryable": "失败可重试",
      "task.outputDir": "输出目录",
      "task.error": "错误",
      "task.yes": "是",
      "task.no": "否",
      "task.input": "输入参数",
      "event.count": "事件",
      "event.tools": "工具",
      "event.outputs": "输出",
      "event.waiting": "等待事件",
      "event.raw": "原始数据",
      "event.taskCreated": "排队",
      "event.taskStarted": "开始",
      "event.taskSucceeded": "成功",
      "event.taskFailed": "失败",
      "event.taskPaused": "暂停",
      "event.agent": "Agent",
      "event.turn": "轮次",
      "event.tool": "工具",
      "event.output": "输出",
      "event.compaction": "压缩",
      "event.retry": "重试",
      "event.finished": "结束",
      "form.metadataInvalid": "Metadata 必须是有效 JSON",
      "db.openFailed": "IndexedDB 打开失败",
      "db.unavailable": "IndexedDB 不可用：{message}",
      "db.readFailed": "读取事件缓存失败",
      "db.writeFailed": "写入事件缓存失败",
      "format.bytes": "{size} B",
      "format.kb": "{size} KB",
      "format.mb": "{size} MB",
      "skill.chars": "{count} 字符",
    },
    en: {
      "app.title": "Drug Evidence Research",
      "app.subtitle": "Task operations",
      "nav.skillEditor": "Skill editor",
      "action.refreshTasks": "Refresh",
      "action.createTask": "Create",
      "action.close": "Close",
      "action.download": "Download",
      "action.downloadZip": "Download ZIP",
      "action.reload": "Reload",
      "action.save": "Save",
      "theme.label": "Theme",
      "theme.system": "System",
      "theme.light": "Light",
      "theme.dark": "Dark",
      "create.title": "Create Task",
      "create.drug": "Drug / Candidate",
      "create.drugPlaceholder": "ABC-123",
      "create.prompt": "Extra Prompt",
      "create.promptPlaceholder": "Optional: add retrieval requirements",
      "create.metadata": "Metadata JSON",
      "create.metadataPlaceholder": "{\"sponsor\":\"example\"}",
      "tasks.title": "Tasks",
      "tasks.aria": "Task list",
      "detail.title": "Task Detail",
      "events.title": "SSE Events",
      "events.rawTitle": "Raw Event Data",
      "files.title": "Artifacts",
      "response.title": "Response",
      "skill.title": "Live SKILL Editor",
      "skill.subtitle": "Saved changes affect subsequent worker tasks",
      "skill.editorTitle": "Single SKILL.md",
      "skill.previewTitle": "Live Preview",
      "skill.editorAria": "SKILL.md editor",
      "state.notLoaded": "Not loaded",
      "state.notSelected": "No task selected",
      "state.notConnected": "Not connected",
      "state.waiting": "Waiting",
      "state.waitingLoad": "Waiting to load",
      "state.zeroChars": "0 chars",
      "state.loading": "Loading",
      "state.emptyTasks": "No tasks",
      "state.emptyEvents": "No events",
      "state.emptyFiles": "No files",
      "state.noChanges": "No changes",
      "state.waitingSave": "Waiting to save",
      "state.saving": "Saving",
      "state.saved": "Saved for subsequent tasks",
      "state.loaded": "Loaded",
      "state.connecting": "Connecting",
      "state.connected": "Connected",
      "state.connectionError": "Connection error or disconnected",
      "status.queued": "Queued",
      "status.running": "Running",
      "status.paused": "Paused",
      "status.succeeded": "Succeeded",
      "status.failed": "Failed",
      "status.cancelled": "Cancelled",
      "task.attempts": "{count} attempts",
      "task.selectFirst": "Select a task first",
      "task.stop": "Stop",
      "task.resume": "Resume",
      "task.id": "Task ID",
      "task.createdAt": "Created",
      "task.startedAt": "Started",
      "task.finishedAt": "Finished",
      "task.attemptCount": "Attempts",
      "task.retryable": "Retryable Failure",
      "task.outputDir": "Output Directory",
      "task.error": "Error",
      "task.yes": "Yes",
      "task.no": "No",
      "task.input": "Input",
      "event.count": "Events",
      "event.tools": "Tools",
      "event.outputs": "Outputs",
      "event.waiting": "Waiting for events",
      "event.raw": "Raw data",
      "event.taskCreated": "Queued",
      "event.taskStarted": "Started",
      "event.taskSucceeded": "Succeeded",
      "event.taskFailed": "Failed",
      "event.taskPaused": "Paused",
      "event.agent": "Agent",
      "event.turn": "Turn",
      "event.tool": "Tool",
      "event.output": "Output",
      "event.compaction": "Compaction",
      "event.retry": "Retry",
      "event.finished": "Finished",
      "form.metadataInvalid": "Metadata must be valid JSON",
      "db.openFailed": "Failed to open IndexedDB",
      "db.unavailable": "IndexedDB unavailable: {message}",
      "db.readFailed": "Failed to read event cache",
      "db.writeFailed": "Failed to write event cache",
      "format.bytes": "{size} B",
      "format.kb": "{size} KB",
      "format.mb": "{size} MB",
      "skill.chars": "{count} chars",
    },
  };

  function isChinese() {
    return document.documentElement.lang.toLowerCase().startsWith("zh");
  }

  function locale() {
    return isChinese() ? "zh-CN" : "en";
  }

  function dictionary() {
    return dictionaries[locale()] || dictionaries.en;
  }

  function text(key, replacements = {}) {
    const template = dictionary()[key] || dictionaries.en[key] || key;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(replacements[name] ?? ""));
  }

  function readStoredMode() {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      return MODES.has(value) ? value : "system";
    } catch {
      return "system";
    }
  }

  function writeStoredMode(mode) {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      return;
    }
  }

  function resolveTheme(mode) {
    if (mode === "light" || mode === "dark") {
      return mode;
    }
    return media.matches ? "dark" : "light";
  }

  function applyTheme(mode = readStoredMode()) {
    const safeMode = MODES.has(mode) ? mode : "system";
    const theme = resolveTheme(safeMode);
    document.documentElement.dataset.themeMode = safeMode;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    syncThemeControls(safeMode);
  }

  function setThemeMode(mode) {
    const safeMode = MODES.has(mode) ? mode : "system";
    writeStoredMode(safeMode);
    applyTheme(safeMode);
  }

  function syncThemeControls(mode = readStoredMode()) {
    document.querySelectorAll("[data-theme-select]").forEach((select) => {
      select.value = mode;
      select.setAttribute("aria-label", text("theme.label"));
      select.querySelectorAll("option").forEach((option) => {
        option.textContent = text(`theme.${option.value}`);
      });
    });
  }

  function localizeStaticText() {
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = text(element.dataset.i18n || "");
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
      element.setAttribute("placeholder", text(element.dataset.i18nPlaceholder || ""));
    });
    document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
      element.setAttribute("aria-label", text(element.dataset.i18nAriaLabel || ""));
    });
  }

  function setupThemeControls() {
    localizeStaticText();
    syncThemeControls();
    document.querySelectorAll("[data-theme-select]").forEach((select) => {
      select.addEventListener("change", () => setThemeMode(select.value));
    });
  }

  media.addEventListener("change", () => {
    if (readStoredMode() === "system") {
      applyTheme("system");
    }
  });

  applyTheme();
  window.appI18n = {
    locale,
    t: text,
    applyTheme,
    setThemeMode,
  };
  window.addEventListener("DOMContentLoaded", setupThemeControls);
})();
