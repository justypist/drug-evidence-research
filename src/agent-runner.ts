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
    modelRegistry.registerProvider("openai", {
      name: "OpenAI",
      baseUrl: this.openai.baseUrl,
      apiKey: this.openai.apiKey,
      api: "openai-responses",
      models: [createOpenAIModel(this.openai.model, this.openai.baseUrl)],
    });

    const settingsManager = SettingsManager.inMemory({
      defaultProvider: "openai",
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
    const model = modelRegistry.find("openai", this.openai.model);
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

    const unsubscribe = session.subscribe((event) => {
      context.appendEvent(toEventType(event), toEventMessage(event), safePayload(event));
      context.refreshLock();
    });

    try {
      await session.prompt(buildResearchPrompt(context), { expandPromptTemplates: false, source: "extension" });
    } finally {
      unsubscribe();
      session.dispose();
    }
  }
}

function createOpenAIModel(modelId: string, baseUrl: string): Model<Api> {
  return {
    id: modelId,
    name: modelId,
    api: "openai-responses",
    provider: "openai",
    baseUrl,
    reasoning: true,
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
