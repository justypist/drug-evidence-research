const state = {
  lastSavedContent: "",
  saveTimer: 0,
  previewFrame: 0,
  isSaving: false,
  loadedAt: "",
  syncScrollFrame: 0,
  syncScrollSource: null,
  isSyncingScroll: false,
};

const els = {
  reloadSkill: document.querySelector("#reloadSkill"),
  saveSkill: document.querySelector("#saveSkill"),
  saveStatus: document.querySelector("#saveStatus"),
  skillMeta: document.querySelector("#skillMeta"),
  skillEditor: document.querySelector("#skillEditor"),
  skillPreview: document.querySelector("#skillPreview"),
  previewStats: document.querySelector("#previewStats"),
};

function setStatus(message, kind = "muted") {
  els.saveStatus.textContent = message;
  els.saveStatus.className = `status ${kind}`;
}

async function requestSkill(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const text = await response.text();
  const body = text ? parseJson(text) : null;
  if (!response.ok) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  return body;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function loadSkill() {
  setStatus("加载中");
  const body = await requestSkill("/api/skill");
  const content = body.skill.content || "";
  state.lastSavedContent = content;
  state.loadedAt = body.skill.modifiedAt;
  els.skillEditor.value = content;
  renderPreview(content);
  renderMeta(body.skill);
  setStatus("已加载", "ok");
}

function renderMeta(skill) {
  els.skillMeta.textContent = `${skill.path} · ${skill.size} bytes · ${skill.modifiedAt}`;
}

function scheduleSave() {
  window.clearTimeout(state.saveTimer);
  schedulePreviewRender();
  if (els.skillEditor.value === state.lastSavedContent) {
    setStatus("无改动", "muted");
    return;
  }
  setStatus("等待保存");
  state.saveTimer = window.setTimeout(() => {
    saveSkill().catch((error) => setStatus(error.message, "error"));
  }, 700);
}

async function saveSkill() {
  window.clearTimeout(state.saveTimer);
  const content = normalizeText(els.skillEditor.value);
  if (content === state.lastSavedContent || state.isSaving) {
    return;
  }
  state.isSaving = true;
  els.saveSkill.disabled = true;
  setStatus("保存中");
  try {
    const body = await requestSkill("/api/skill", {
      method: "PUT",
      body: JSON.stringify({ content }),
    });
    state.lastSavedContent = body.skill.content || content;
    renderMeta(body.skill);
    if (els.skillEditor.value !== state.lastSavedContent) {
      els.skillEditor.value = state.lastSavedContent;
      renderPreview(state.lastSavedContent);
    }
    setStatus("已保存，后续任务生效", "ok");
  } finally {
    state.isSaving = false;
    els.saveSkill.disabled = false;
  }
}

function normalizeText(text) {
  const normalized = text.replace(/\r\n?/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function renderPreview(markdown) {
  const body = stripFrontmatter(markdown);
  els.skillPreview.innerHTML = markdownToHtml(body);
  els.previewStats.textContent = `${markdown.length} 字符`;
  scheduleScrollSync("editor");
}

function schedulePreviewRender() {
  if (state.previewFrame) {
    return;
  }
  state.previewFrame = window.requestAnimationFrame(() => {
    state.previewFrame = 0;
    renderPreview(els.skillEditor.value);
  });
}

function scheduleScrollSync(source) {
  if (state.isSyncingScroll) {
    return;
  }
  state.syncScrollSource = source;
  if (state.syncScrollFrame) {
    return;
  }
  state.syncScrollFrame = window.requestAnimationFrame(() => {
    state.syncScrollFrame = 0;
    syncScroll(state.syncScrollSource);
  });
}

function syncScroll(source) {
  const from = source === "preview" ? els.skillPreview : els.skillEditor;
  const to = source === "preview" ? els.skillEditor : els.skillPreview;
  const fromMax = Math.max(1, from.scrollHeight - from.clientHeight);
  const toMax = Math.max(0, to.scrollHeight - to.clientHeight);
  const ratio = from.scrollTop / fromMax;
  state.isSyncingScroll = true;
  to.scrollTop = Math.round(ratio * toMax);
  window.requestAnimationFrame(() => {
    state.isSyncingScroll = false;
  });
}

function stripFrontmatter(markdown) {
  const lines = markdown.split("\n");
  if (lines[0] !== "---") {
    return markdown;
  }
  const endIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  return endIndex > 0 ? lines.slice(endIndex + 1).join("\n").trimStart() : markdown;
}

function markdownToHtml(markdown) {
  const lines = markdown.split("\n");
  const html = [];
  let listItems = [];
  let tableRows = [];
  let codeLines = [];
  let codeOpen = false;
  let codeLanguage = "";

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }
    html.push(`<ul>${listItems.map((item) => `<li>${formatInline(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };

  const flushTable = () => {
    if (tableRows.length === 0) {
      return;
    }
    const rows = tableRows.filter((row) => !isTableDivider(row));
    const header = rows.shift();
    if (!header) {
      tableRows = [];
      return;
    }
    const headerCells = parseTableCells(header).map((cell) => `<th>${formatInline(cell)}</th>`).join("");
    const bodyRows = rows
      .map((row) => `<tr>${parseTableCells(row).map((cell) => `<td>${formatInline(cell)}</td>`).join("")}</tr>`)
      .join("");
    html.push(`<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`);
    tableRows = [];
  };

  const flushCode = () => {
    if (!codeOpen) {
      return;
    }
    html.push(`<pre><code data-language="${escapeHtml(codeLanguage)}">${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
    codeOpen = false;
    codeLanguage = "";
  };

  for (const line of lines) {
    if (codeOpen || line.startsWith("```")) {
      if (line.startsWith("```")) {
        if (codeOpen) {
          flushCode();
        } else {
          flushList();
          flushTable();
          codeLanguage = line.slice(3).trim();
          codeLines = [];
          codeOpen = true;
        }
        continue;
      }
      codeLines.push(line);
      continue;
    }

    if (line.startsWith("|") && line.endsWith("|")) {
      flushList();
      tableRows.push(line);
      continue;
    }

    flushTable();

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${formatInline(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = /^\s*-\s+(.+)$/.exec(line);
    if (listItem) {
      listItems.push(listItem[1]);
      continue;
    }

    if (line.trim() === "") {
      flushList();
      continue;
    }

    flushList();
    html.push(`<p>${formatInline(line)}</p>`);
  }

  flushCode();
  flushList();
  flushTable();
  return html.join("");
}

function isTableDivider(row) {
  return /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(row);
}

function parseTableCells(row) {
  return row
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function formatInline(text) {
  return escapeHtml(text).replace(/`([^`]+)`/g, "<code>$1</code>");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

els.reloadSkill.addEventListener("click", () => loadSkill().catch((error) => setStatus(error.message, "error")));
els.saveSkill.addEventListener("click", () => saveSkill().catch((error) => setStatus(error.message, "error")));
els.skillEditor.addEventListener("input", scheduleSave);
els.skillEditor.addEventListener("scroll", () => scheduleScrollSync("editor"), { passive: true });
els.skillPreview.addEventListener("scroll", () => scheduleScrollSync("preview"), { passive: true });

loadSkill().catch((error) => setStatus(error.message, "error"));
