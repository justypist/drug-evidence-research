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
    context.appendEvent("agent_preparing", "Preparing pi coding agent session", {
      sessionDir: context.sessionDir,
      workdir: context.workdir,
      outputDir: context.outputDir,
    });

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
    const skillPath = join(this.projectRoot, ".agents", "skills", "drug-evidence-research", "SKILL.md");
    const resourceLoader = new DefaultResourceLoader({
      cwd: context.workdir,
      agentDir: this.agentDir,
      settingsManager,
      additionalSkillPaths: existsSync(skillPath) ? [skillPath] : [],
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
      context.appendEvent(toEventType(event), toEventMessage(event), safePayload(event));
      context.refreshLock();
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

function toEventType(event: AgentSessionEvent): string {
  if (event.type.includes("tool")) {
    return `agent_tool_${event.type}`;
  }
  if (event.type.includes("message")) {
    return `agent_message_${event.type}`;
  }
  return `agent_${event.type}`;
}

function toEventMessage(event: AgentSessionEvent): string {
  const maybeMessage = readStringProperty(event, "message");
  if (maybeMessage) {
    return maybeMessage;
  }
  const maybeText = readStringProperty(event, "text");
  if (maybeText) {
    return maybeText.slice(0, 500);
  }
  return event.type;
}

function safePayload(event: AgentSessionEvent): unknown {
  return JSON.parse(JSON.stringify(event, jsonSafeReplacer));
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
