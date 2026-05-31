import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

import type { WorkerRunner, WorkerRunContext } from "#types.ts";

export interface PiAgentRunnerOptions {
  openai: {
    baseUrl: string;
    apiKey: string;
    model: string;
    api?: Api;
  };
  projectRoot?: string;
  agentDir?: string;
}

interface AgentEventSummary {
  type: string;
  message: string;
  payload?: Record<string, unknown>;
}

export class PiAgentRunner implements WorkerRunner {
  private readonly openai: PiAgentRunnerOptions["openai"];
  private readonly projectRoot: string;
  private readonly agentDir: string;

  constructor(options: PiAgentRunnerOptions) {
    this.openai = options.openai;
    this.projectRoot = resolve(options.projectRoot ?? process.cwd());
    this.agentDir = resolve(options.agentDir ?? join(this.projectRoot, ".pi-agent-runtime"));
  }

  async run(context: WorkerRunContext): Promise<void> {
    const authStorage = AuthStorage.inMemory({ openai: { type: "api_key", key: this.openai.apiKey } });
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const api = resolveModelApi(this.openai);
    const provider = resolveProviderName(this.openai);
    modelRegistry.registerProvider(provider, {
      name: "OpenAI",
      baseUrl: this.openai.baseUrl,
      apiKey: this.openai.apiKey,
      api,
      models: [createOpenAIModel(this.openai.model, this.openai.baseUrl, api, provider)],
    });

    const settingsManager = SettingsManager.inMemory({
      defaultProvider: provider,
      defaultModel: this.openai.model,
      defaultThinkingLevel: "medium",
      compaction: { enabled: true },
    });
    const skillPaths = [
      join(this.projectRoot, ".agents", "skills", "drug-evidence-research", "SKILL.md"),
      join(this.projectRoot, ".agents", "skills", "agent-browser", "SKILL.md"),
    ].filter((skillPath) => existsSync(skillPath));
    const resourceLoader = new DefaultResourceLoader({
      cwd: context.workdir,
      agentDir: this.agentDir,
      settingsManager,
      additionalSkillPaths: skillPaths,
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      appendSystemPrompt: [
        [
          "You are running inside an automated worker for drug evidence research.",
          `Write all final artifacts under ${context.outputDir}.`,
          "Do not write artifacts outside the task output directory unless explicitly needed for temporary work.",
        ].join("\n"),
      ],
    });
    await resourceLoader.reload();

    const sessionManager = SessionManager.continueRecent(context.workdir, context.sessionDir);
    const model = modelRegistry.find(provider, this.openai.model);
    if (!model) {
      throw new Error(`Configured OpenAI model was not registered: ${this.openai.model}`);
    }

    const { session } = await createAgentSession({
      cwd: context.workdir,
      agentDir: this.agentDir,
      authStorage,
      modelRegistry,
      settingsManager,
      resourceLoader,
      sessionManager,
      model,
    });

    let agentError: string | null = null;
    const unsubscribe = session.subscribe((event) => {
      const eventError = readAgentError(event);
      if (eventError) {
        agentError = eventError;
      }
      const summary = summarizeAgentEvent(event);
      if (summary) {
        context.appendEvent(summary.type, summary.message, summary.payload);
        context.refreshLock();
      }
    });

    try {
      await session.prompt(buildResearchPrompt(context), { expandPromptTemplates: false, source: "extension" });
      if (agentError) {
        throw new Error(agentError);
      }
      assertRequiredOutputFiles(context);
    } finally {
      unsubscribe();
      session.dispose();
    }
  }
}

function createOpenAIModel(modelId: string, baseUrl: string, api: Api, provider: string): Model<Api> {
  return {
    id: modelId,
    name: modelId,
    api,
    provider,
    baseUrl,
    reasoning: api === "openai-responses",
    input: ["text", "image"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 128000,
    maxTokens: 8192,
  };
}

function resolveModelApi(options: PiAgentRunnerOptions["openai"]): Api {
  if (options.api) {
    return options.api;
  }
  return options.baseUrl.includes("deepseek.com") ? "openai-completions" : "openai-responses";
}

function resolveProviderName(options: PiAgentRunnerOptions["openai"]): string {
  return options.baseUrl.includes("deepseek.com") ? "deepseek" : "openai";
}

function assertRequiredOutputFiles(context: WorkerRunContext): void {
  const requiredFiles = [
    `${context.input.drug}_research_report.md`,
    `${context.input.drug}_data.json`,
    "sources_index.md",
  ];
  const missingFiles = requiredFiles.filter((file) => !existsSync(join(context.outputDir, file)));
  if (missingFiles.length > 0) {
    throw new Error(`Agent completed without required output file(s): ${missingFiles.join(", ")}`);
  }
}

function buildResearchPrompt(context: WorkerRunContext): string {
  const specificPrompt = context.input.prompt?.trim();
  const lines = [
    "/skill:drug-evidence-research",
    "",
    `Research target drug/candidate: ${context.input.drug}`,
    "",
    "Follow the drug-evidence-research skill workflow end to end.",
    `Use this working directory for scratch work: ${context.workdir}`,
    `Save final deliverables to: ${context.outputDir}`,
    "",
    "Required output files:",
    `- ${context.input.drug}_research_report.md`,
    `- ${context.input.drug}_data.json`,
    "- sources_index.md",
    "- sources/ for archived source material when available",
    "- images/ for relevant images when available",
  ];
  if (specificPrompt) {
    lines.push("", "Additional user instructions:", specificPrompt);
  }
  return lines.join("\n");
}

function jsonSafeReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function summarizeAgentEvent(event: AgentSessionEvent): AgentEventSummary | null {
  switch (event.type) {
    case "agent_start":
      return null;
    case "agent_end":
      return {
        type: "agent_finished",
        message: event.willRetry ? "Agent 本轮结束，等待重试" : "Agent 已结束",
        payload: {
          rawType: event.type,
          messageCount: event.messages.length,
          willRetry: event.willRetry,
        },
      };
    case "turn_start":
      return null;
    case "turn_end":
      return {
        type: "agent_turn_completed",
        message: "推理轮次完成",
        payload: {
          rawType: event.type,
          stopReason: readStringProperty(event.message, "stopReason"),
          toolResultCount: event.toolResults.length,
          usage: compactJsonValue(readUnknownProperty(event.message, "usage"), 1200),
        },
      };
    case "tool_execution_start":
      return null;
    case "tool_execution_end":
      return {
        type: event.isError ? "agent_tool_failed" : "agent_tool_completed",
        message: event.isError ? `工具失败：${event.toolName}` : `工具完成：${event.toolName}`,
        payload: {
          rawType: event.type,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
          result: summarizeToolResult(event.result),
        },
      };
    case "message_end": {
      const role = readStringProperty(event.message, "role");
      if (role !== "assistant") {
        return null;
      }
      const text = summarizeMessageText(event.message);
      const toolCalls = summarizeToolCalls(event.message);
      return {
        type: "agent_message_completed",
        message: text ? `Agent 输出：${text}` : "Agent 输出完成",
        payload: {
          rawType: event.type,
          role,
          stopReason: readStringProperty(event.message, "stopReason"),
          text,
          toolCalls,
          usage: compactJsonValue(readUnknownProperty(event.message, "usage"), 1200),
        },
      };
    }
    case "compaction_start":
      return null;
    case "compaction_end":
      return {
        type: event.errorMessage ? "agent_compaction_failed" : "agent_compaction_completed",
        message: event.errorMessage ? `上下文压缩失败：${event.errorMessage}` : "上下文压缩完成",
        payload: {
          rawType: event.type,
          reason: event.reason,
          aborted: event.aborted,
          willRetry: event.willRetry,
          errorMessage: event.errorMessage ?? null,
        },
      };
    case "auto_retry_start":
      return null;
    case "auto_retry_end":
      return {
        type: event.success ? "agent_retry_completed" : "agent_retry_failed",
        message: event.success ? "重试成功" : `重试失败：${event.finalError ?? "未知错误"}`,
        payload: {
          rawType: event.type,
          success: event.success,
          attempt: event.attempt,
          finalError: event.finalError ?? null,
        },
      };
    case "queue_update":
    case "session_info_changed":
    case "thinking_level_changed":
    case "message_start":
    case "message_update":
    case "tool_execution_update":
      return null;
  }
}

function summarizeToolResult(result: unknown): Record<string, unknown> {
  const content = readUnknownProperty(result, "content");
  const text = summarizeContent(content);
  return {
    text,
    terminate: readUnknownProperty(result, "terminate") === true,
    details: compactJsonValue(readUnknownProperty(result, "details"), 1200),
  };
}

function summarizeMessageText(message: unknown): string | null {
  return truncateText(summarizeContent(readUnknownProperty(message, "content")) ?? "", 220) || null;
}

function summarizeToolCalls(message: unknown): Array<Record<string, unknown>> {
  const content = readUnknownProperty(message, "content");
  if (!Array.isArray(content)) {
    return [];
  }
  const calls: Array<Record<string, unknown>> = [];
  for (const block of content) {
    if (readStringProperty(block, "type") !== "toolCall") {
      continue;
    }
    calls.push({
      id: readStringProperty(block, "id"),
      name: readStringProperty(block, "name"),
      arguments: compactJsonValue(readUnknownProperty(block, "arguments"), 1000),
    });
  }
  return calls;
}

function summarizeContent(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const textParts: string[] = [];
  for (const block of content) {
    const text = readStringProperty(block, "text");
    if (text) {
      textParts.push(text);
    }
  }
  const summary = textParts.join("\n").trim();
  return summary.length > 0 ? summary : null;
}

function compactJsonValue(value: unknown, maxLength: number): unknown {
  if (value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return truncateText(value, maxLength);
  }
  const serialized = stringifyJsonSafe(value);
  if (serialized.length <= maxLength) {
    return parseJsonSafe(serialized);
  }
  return {
    truncated: true,
    preview: serialized.slice(0, maxLength),
  };
}

function stringifyJsonSafe(value: unknown): string {
  try {
    return JSON.stringify(value, jsonSafeReplacer);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function parseJsonSafe(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function readUnknownProperty(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
}

function readStringProperty(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function readAgentError(event: AgentSessionEvent): string | null {
  if (event.type === "compaction_end" && event.errorMessage) {
    return event.errorMessage;
  }
  if (event.type === "auto_retry_end" && !event.success && event.finalError) {
    return event.finalError;
  }
  const message = readObjectProperty(event, "message");
  if (!message) {
    return null;
  }
  const stopReason = readStringProperty(message, "stopReason");
  if (stopReason !== "error" && stopReason !== "aborted") {
    return null;
  }
  return readStringProperty(message, "errorMessage") ?? `Agent request ${stopReason}`;
}

function readObjectProperty(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = (value as Record<string, unknown>)[key];
  return candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as Record<string, unknown> : null;
}
