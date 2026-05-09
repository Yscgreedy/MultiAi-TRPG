import type {
  AiAgentConfig,
  AiProviderConfig,
  AiRagSettings,
  AiRole,
  AiSettings,
  CampaignDetail,
  CharacterCard,
  CharacterCreationMessage,
  CharacterCreationSession,
  CharacterCreationToolResult,
  GameMessage,
  NpcCharacter,
} from "@/types";
import {
  createEmptyCharacter,
  getCharacterSheetTemplate,
  getRuleset,
  normalizeGeneratedCharacter,
  type CharacterSeedInput,
} from "@/lib/rulesets";
import { createId, nowIso } from "@/lib/id";
import gmPrompt from "@/prompts/gm.md?raw";
import rulesJudgePrompt from "@/prompts/rules-judge.md?raw";
import archivistPrompt from "@/prompts/archivist.md?raw";
import companionPrompt from "@/prompts/companion.md?raw";
import npcPrompt from "@/prompts/npc.md?raw";

const DEFAULT_NPC_AVATARS = [
  "/avatars/npc-default-male.png",
  "/avatars/npc-default-female.png",
];

export const defaultAgents: AiAgentConfig[] = [
  {
    role: "GM",
    label: "主持人",
    providerId: "openai",
    enabled: true,
    systemPrompt: "使用偏悬疑、低魔、有人情味的叙事风格。",
  },
  {
    role: "Companion",
    label: "旧版队友代理",
    providerId: "openai",
    enabled: false,
    systemPrompt: "兼容旧存档的固定队友代理；新战役使用战役内 NPC 角色卡。",
  },
  {
    role: "RulesJudge",
    label: "规则裁判",
    providerId: "openai",
    enabled: true,
    systemPrompt: "优先给出可执行的轻规则判定建议。",
  },
  {
    role: "Archivist",
    label: "世界记录员",
    providerId: "openai",
    enabled: true,
    systemPrompt: "只记录稳定事实，保持简洁。",
  },
];

export const defaultProviders: AiProviderConfig[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    models: ["gpt-4.1-mini"],
    defaultModel: "gpt-4.1-mini",
  },
];

export const defaultAiSettings: AiSettings = {
  providers: defaultProviders,
  defaultProviderId: "openai",
  responseMode: "complete",
  agents: defaultAgents,
  rag: {
    enabled: true,
    source: "local",
    embeddingProviderId: "openai",
    embeddingModel: "text-embedding-3-small",
    rerankProviderId: "openai",
    rerankModel: "",
    pineconeApiKey: "",
    pineconeIndexName: "multi-ai-trpg-rag",
    pineconeNamespace: "multi-ai-trpg",
    pineconeCloud: "aws",
    pineconeRegion: "us-east-1",
    pineconeEmbeddingModel: "llama-text-embed-v2",
    pineconeRerankEnabled: false,
    pineconeRerankModel: "bge-reranker-v2-m3",
    pineconeGlobalFallbackEnabled: true,
    topK: 4,
    chunkSize: 900,
  },
};

export interface AiTurnInput {
  detail: CampaignDetail;
  playerAction: string;
  settings: AiSettings;
  privateChat?: PrivateChatTarget;
  npc?: NpcCharacter;
  toolRuntime?: AiToolRuntime;
  hiddenRulesAdvice?: string;
  rulesContext?: string;
}

export interface AiTurnOutput {
  role: AiRole;
  label: string;
  content: string;
}

export interface PrivateChatTarget {
  raw: string;
  agent: AiAgentConfig;
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: ChatCompletionToolCall[];
}

interface ChatCompletionToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface ChatCompletionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AiToolRuntime {
  mode: "gm" | "npc";
  getPlayerCharacter(): CharacterCard | undefined;
  savePlayerCharacter(character: CharacterCard): Promise<void>;
  listNpcs(): NpcCharacter[];
  getNpc(target: string): NpcCharacter | undefined;
  saveNpc(npc: NpcCharacter): Promise<void>;
  createNpc(npc: NpcCharacter): Promise<void>;
  searchMessages?(query: string, limit?: number): Promise<GameMessage[]>;
  onToolResult?: (result: AiToolExecutionResult) => void;
}

export interface AiToolExecutionResult {
  toolName: string;
  result: unknown;
}

interface CharacterCreationRunContext {
  draft: CharacterCard;
  toolResults: CharacterCreationToolResult[];
}

interface LegacyAiSettings {
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  agents?: AiAgentConfig[];
  providers?: AiProviderConfig[];
  defaultProviderId?: string;
  responseMode?: AiSettings["responseMode"];
  rag?: Partial<AiRagSettings>;
}

function recentMessages(messages: GameMessage[], max?: number): string[] {
  const sliced = max && max > 0 ? messages.slice(-max) : messages;
  return sliced.map(
    (message) => `${message.authorLabel ?? message.author}: ${message.content}`,
  );
}

export function buildAgentMessages(
  agent: AiAgentConfig,
  input: AiTurnInput,
): ChatMessage[] {
  const { campaign, character } = input.detail;
  const ruleset = getRuleset(campaign.rulesetId);
  const messageLimit =
    input.settings.gmFullContext && agent.role === "GM" ? 0 : 8;
  const recent = recentMessages(input.detail.messages, messageLimit);
  const npcs = input.detail.npcs ?? [];
  const npcLines = npcs.length
    ? npcs.map((npc) => `${npc.name}：${npc.concept}`).join("\n")
    : "暂无";
  const sharedContext = [
    `玩家行动：${input.playerAction}`,
    `规则：${ruleset.diceExpression}`,
    `角色：${character?.name ?? "未绑定角色"} - ${character?.concept ?? "未知概念"}`,
    `战役 NPC：${npcLines}`,
    input.npc
      ? `你当前扮演的 NPC 角色卡：${formatCharacterForPrompt(input.npc)}`
      : "",
    `战役摘要：${campaign.summary || "暂无摘要"}`,
    `世界状态：${campaign.worldState || "暂无世界状态"}`,
    agent.role === "GM" && input.hiddenRulesAdvice
      ? `规则裁判建议（仅 GM 可见，不要逐字公开）：${input.hiddenRulesAdvice}`
      : "",
    `近期记录：${recent.join("\n") || "暂无"}`,
  ]
    .filter(Boolean)
    .join("\n");
  const rolePrompt = buildRolePrompt(agent, input, sharedContext);
  const privateChatPrompt = input.privateChat
    ? [
        `玩家正在尝试发起私聊：@${input.privateChat.raw}。`,
        `被交流对象：${input.privateChat.agent.label}（${input.privateChat.agent.role}）。`,
        agent.role === "GM"
          ? [
              "你只判断这轮私聊是否在当前场景中成立，包括距离、时机、目标态度、风险和可能代价。",
              "不要替被交流对象说话、报价、解释能力或输出台词。",
              "如果对象可以回应，只写清场景约束，并用 @对象名 点名让该 NPC 自己回应。",
            ].join("\n")
          : agent.role === input.privateChat.agent.role
            ? "你是被私聊对象。你需要和 GM 的场景约束共同决定是否回应，以及回应的边界。"
            : "你不是本轮私聊参与者，保持沉默。",
        "如果私聊不成立，只说明原因和当前阻碍，不要追问玩家后续行动。",
      ].join("\n")
    : "";

  return [
    {
      role: "system",
      content: [
        `你是“${agent.label}”（${agent.role}）。`,
        roleTemplate(agent, input),
        agent.systemPrompt,
        "你参与的是一个一个真人玩家 + 多 AI 协作的跑团游戏。",
        "严格保持自己的身份边界，不要代替其他 AI 的职责。",
        "只有 GM 可以推进场景、添加环境细节、安排 NPC 行动或给出剧情后果。",
        agent.role === "GM"
          ? "GM 不能替玩家或 NPC 输出直接引语；需要 NPC 发言时，只用 @NPC名称 触发它自己的回复。"
          : "",
        agent.role === "GM"
          ? "规则裁判建议是 GM 私有参考；只把必要判定自然转化为场景反馈，不要公开规裁全文。"
          : "",
        "保持中文输出，避免替玩家决定行动。",
        "如果你的身份本轮没有需要参与的内容，直接返回空内容；不要写“无”“不参与”或括号说明。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [privateChatPrompt, rolePrompt].filter(Boolean).join("\n\n"),
    },
  ];
}

function roleTemplate(agent: AiAgentConfig, input: AiTurnInput): string {
  if (input.npc) {
    return npcPrompt;
  }
  if (agent.role === "GM") {
    return gmPrompt;
  }
  if (agent.role === "Companion") {
    return companionPrompt;
  }
  if (agent.role === "RulesJudge") {
    return rulesJudgePrompt;
  }
  return archivistPrompt;
}

function formatCharacterForPrompt(character: CharacterCard): string {
  return [
    `${character.name} - ${character.concept}`,
    `背景：${character.background}`,
    `属性：${JSON.stringify(character.attributes)}`,
    `技能：${JSON.stringify(character.skills)}`,
    `物品：${character.inventory.join("、") || "无"}`,
    `羁绊：${character.bonds.join("、") || "无"}`,
    `状态：${character.conditions.join("、") || "状态良好"}`,
    `备注：${character.notes || "无"}`,
  ].join("\n");
}

function buildRolePrompt(
  agent: AiAgentConfig,
  input: AiTurnInput,
  sharedContext: string,
): string {
  const ruleset = getRuleset(input.detail.campaign.rulesetId);

  if (agent.role === "GM") {
    return [
      "你的职责：作为唯一主持人推进场景，回应玩家行动，给出后果和风险。",
      "不要替任何 NPC 说台词、解释其能力或作出第一人称回应；如果需要 NPC 回答，使用 @NPC名称 点名。",
      input.hiddenRulesAdvice
        ? `规则裁判建议（仅 GM 可见，不要逐字公开）：${input.hiddenRulesAdvice}`
        : "",
      ruleset.buildActionPrompt({
        playerAction: input.playerAction,
        summary: input.detail.campaign.summary,
        worldState: input.detail.campaign.worldState,
        character: input.detail.character,
        recentMessages: recentMessages(input.detail.messages),
      }),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (agent.role === "Companion") {
    if (input.npc) {
      return [
        "你的职责：只扮演当前指定的战役 NPC。",
        "不要代替 GM 推进全局场景；只回应自己知道和会做的事。",
        sharedContext,
      ].join("\n\n");
    }
    return [
      "你的职责：只扮演一名同行角色。你可以表达提醒、疑问、情绪反应或短建议。",
      "禁止描写环境细节、揭示新线索、裁定判定、推进剧情或替 GM 给出后果。",
      "如果当前场景没有明确需要队友开口，返回空内容。",
      sharedContext,
    ].join("\n\n");
  }

  if (agent.role === "RulesJudge") {
    return [
      "你的职责：只做规则裁判。只说明是否需要判定、建议使用的属性/技能、骰子表达式、成功区间和失败代价。",
      "禁止叙事描写、禁止添加新线索、禁止扮演 NPC、禁止推进场景。",
      "如果当前行动不需要规则解释或判定，返回空内容。",
      input.rulesContext ? `规则书检索片段：\n${input.rulesContext}` : "",
      sharedContext,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    "你的职责：只做世界记录员。提取本轮已经确认的事实、状态变化、未解决线索或需要写入摘要的事项。",
    "禁止叙事描写、禁止添加新事实、禁止给玩家行动建议、禁止推进场景。",
    "如果本轮没有新的稳定事实需要记录，返回空内容。",
    sharedContext,
  ].join("\n\n");
}

export function normalizeAiSettings(raw: unknown): AiSettings {
  const legacy = (
    typeof raw === "object" && raw ? raw : {}
  ) as LegacyAiSettings;
  const legacyProvider: AiProviderConfig = {
    ...defaultProviders[0],
    baseUrl: legacy.baseUrl || defaultProviders[0].baseUrl,
    apiKey: legacy.apiKey || "",
    defaultModel: legacy.defaultModel || defaultProviders[0].defaultModel,
    models: legacy.defaultModel
      ? Array.from(
          new Set([legacy.defaultModel, ...defaultProviders[0].models]),
        )
      : defaultProviders[0].models,
  };
  const providers = legacy.providers?.length
    ? legacy.providers.map((provider) => ({
        ...provider,
        models: provider.models ?? [],
      }))
    : [legacyProvider];
  const defaultProviderId =
    legacy.defaultProviderId &&
    providers.some((item) => item.id === legacy.defaultProviderId)
      ? legacy.defaultProviderId
      : (providers[0]?.id ?? defaultProviders[0].id);
  const agents = defaultAgents.map((defaultAgent) => {
    const saved = legacy.agents?.find(
      (agent) => agent.role === defaultAgent.role,
    );
    return {
      ...defaultAgent,
      ...saved,
      providerId:
        saved?.providerId &&
        providers.some((provider) => provider.id === saved.providerId)
          ? saved.providerId
          : defaultProviderId,
    };
  });

  return {
    providers,
    defaultProviderId,
    responseMode: legacy.responseMode === "fast" ? "fast" : "complete",
    agents,
    rag: normalizeRagSettings(legacy.rag, providers, defaultProviderId),
  };
}

function normalizeRagSettings(
  raw: Partial<AiRagSettings> | undefined,
  providers: AiProviderConfig[],
  defaultProviderId: string,
): AiRagSettings {
  const embeddingProviderId = providers.some(
    (provider) => provider.id === raw?.embeddingProviderId,
  )
    ? raw?.embeddingProviderId
    : defaultProviderId;
  const rerankProviderId = providers.some(
    (provider) => provider.id === raw?.rerankProviderId,
  )
    ? raw?.rerankProviderId
    : embeddingProviderId;

  return {
    enabled: raw?.enabled ?? true,
    source: raw?.source === "pinecone" ? "pinecone" : "local",
    embeddingProviderId,
    embeddingModel: raw?.embeddingModel || "text-embedding-3-small",
    rerankProviderId,
    rerankModel: raw?.rerankModel ?? "",
    pineconeApiKey: raw?.pineconeApiKey ?? "",
    pineconeIndexName: normalizePineconeIndexName(raw?.pineconeIndexName),
    pineconeNamespace: raw?.pineconeNamespace?.trim() || "multi-ai-trpg",
    pineconeCloud: raw?.pineconeCloud?.trim() || "aws",
    pineconeRegion: raw?.pineconeRegion?.trim() || "us-east-1",
    pineconeEmbeddingModel:
      raw?.pineconeEmbeddingModel?.trim() || "llama-text-embed-v2",
    pineconeRerankEnabled: raw?.pineconeRerankEnabled ?? false,
    pineconeRerankModel:
      raw?.pineconeRerankModel?.trim() || "bge-reranker-v2-m3",
    pineconeGlobalFallbackEnabled: raw?.pineconeGlobalFallbackEnabled ?? true,
    topK: clampInteger(raw?.topK, 1, 12, 4),
    chunkSize: clampInteger(raw?.chunkSize, 300, 2400, 900),
  };
}

function normalizePineconeIndexName(value: string | undefined): string {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "multi-ai-trpg-rag";
}

function findProvider(
  settings: AiSettings,
  providerId?: string,
): AiProviderConfig {
  const provider =
    settings.providers.find((item) => item.id === providerId) ??
    settings.providers.find((item) => item.id === settings.defaultProviderId) ??
    settings.providers[0];

  if (!provider) {
    throw new Error("尚未配置任何 Provider。");
  }

  return provider;
}

function resolveModel(provider: AiProviderConfig, model?: string): string {
  const resolved = model || provider.defaultModel || provider.models[0];
  if (!resolved) {
    throw new Error(`Provider「${provider.name}」尚未配置可用模型。`);
  }
  return resolved;
}

export function formatModelValue(providerId: string, model: string): string {
  return `${providerId}::${model}`;
}

export function parseModelValue(value: string): {
  providerId: string;
  model: string;
} {
  const [providerId, ...modelParts] = value.split("::");
  return {
    providerId,
    model: modelParts.join("::"),
  };
}

export async function generateEmbeddings(
  settings: AiSettings,
  input: string | string[],
): Promise<number[][]> {
  const provider = findProvider(settings, settings.rag.embeddingProviderId);
  const model = settings.rag.embeddingModel.trim();
  const inputs = Array.isArray(input) ? input : [input];
  if (!model) {
    throw new Error("请先在 AI 设置中配置 RAG Embedding 模型。");
  }
  if (!provider.apiKey.trim()) {
    throw new Error(
      `Provider「${provider.name}」未配置 API Key，无法生成规则书向量。`,
    );
  }

  const response = await postChatCompletion(
    `${provider.baseUrl.replace(/\/$/, "")}/embeddings`,
    provider.apiKey,
    {
      model,
      input: inputs,
    },
  );
  if (!response.ok) {
    throw new Error(
      `Embedding 生成失败：${response.status} ${await response.text()}`,
    );
  }

  const data = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
    embeddings?: number[][];
  };
  const embeddings =
    data.data?.map((item) => item.embedding ?? []) ?? data.embeddings ?? [];
  if (
    embeddings.length !== inputs.length ||
    embeddings.some((item) => !item.length)
  ) {
    throw new Error("Embedding 接口没有返回完整向量。");
  }
  return embeddings;
}

export async function rerankDocuments(
  settings: AiSettings,
  query: string,
  documents: string[],
): Promise<Array<{ index: number; score: number }>> {
  const model = settings.rag.rerankModel.trim();
  if (!model || documents.length === 0) {
    return documents.map((_document, index) => ({
      index,
      score: documents.length - index,
    }));
  }
  const provider = findProvider(settings, settings.rag.rerankProviderId);
  if (!provider.apiKey.trim()) {
    throw new Error(
      `Provider「${provider.name}」未配置 API Key，无法 rerank 规则书片段。`,
    );
  }

  const response = await postChatCompletion(
    `${provider.baseUrl.replace(/\/$/, "")}/rerank`,
    provider.apiKey,
    {
      model,
      query,
      documents,
      top_n: Math.min(settings.rag.topK, documents.length),
    },
  );
  if (!response.ok) {
    throw new Error(`Rerank 失败：${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as {
    results?: Array<{
      index?: number;
      relevance_score?: number;
      score?: number;
    }>;
    data?: Array<{ index?: number; relevance_score?: number; score?: number }>;
  };
  const results = data.results ?? data.data ?? [];
  return results
    .map((item) => ({
      index: item.index ?? -1,
      score: item.relevance_score ?? item.score ?? 0,
    }))
    .filter((item) => item.index >= 0 && item.index < documents.length);
}

export async function runAiAgentTurn(
  agent: AiAgentConfig,
  input: AiTurnInput,
): Promise<AiTurnOutput> {
  const provider = findProvider(input.settings, agent.providerId);
  const model = resolveModel(provider, agent.model);

  if (!provider.apiKey.trim()) {
    return {
      role: agent.role,
      label: agent.label,
      content: `[${provider.name} 未配置 API Key] ${agent.label} 暂以离线模式回应：已记录“${input.playerAction}”，请在设置中填入 Provider API Key 后启用真实 AI。`,
    };
  }

  const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const tools = buildToolsForTurn(agent, input);
  const messages = buildAgentMessages(agent, input);
  let response = await postChatCompletion(endpoint, provider.apiKey, {
    model,
    messages,
    temperature: agent.role === "RulesJudge" ? 0.3 : 0.8,
    stream: false,
    ...(tools.length ? { tools, tool_choice: "auto" } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (tools.length && shouldReportToolSupportError(errorText)) {
      throw new Error(
        `${provider.name} 不支持 OpenAI tools/tool_calls：${errorText}`,
      );
    }
    throw new Error(`${agent.label} 调用失败：${response.status} ${errorText}`);
  }

  let data = await readChatCompletionResponse(response);
  for (let index = 0; index < 4 && data.toolCalls.length; index += 1) {
    messages.push({
      role: "assistant",
      content: data.content,
      ...(data.reasoningContent
        ? { reasoning_content: data.reasoningContent }
        : {}),
      tool_calls: data.toolCalls,
    });
    for (const toolCall of data.toolCalls) {
      const result = await executeAiTool(toolCall, input);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
    response = await postChatCompletion(endpoint, provider.apiKey, {
      model,
      messages,
      temperature: agent.role === "RulesJudge" ? 0.3 : 0.8,
      stream: false,
      tools,
      tool_choice: "auto",
    });
    if (!response.ok) {
      throw new Error(
        `${agent.label} 工具调用后生成回复失败：${response.status} ${await response.text()}`,
      );
    }
    data = await readChatCompletionResponse(response);
  }
  if (data.toolCalls.length) {
    throw new Error(`${agent.label} 工具调用超过最大轮数。`);
  }
  const content = data.content.trim();

  return {
    role: agent.role,
    label: agent.label,
    content,
  };
}

export function createCharacterCreationSession(
  rulesetId: string,
  characterType = "通用",
  seed: CharacterSeedInput = { concept: "", tone: "", profession: "" },
  rulesContext = "",
): CharacterCreationSession {
  const timestamp = nowIso();
  const draft = createBlankCharacterCreationDraft(rulesetId, characterType, seed);
  return {
    id: createId("chargen"),
    rulesetId,
    characterType: draft.characterType ?? characterType,
    draft,
    messages: [
      {
        id: createId("chargenmsg"),
        author: "GM",
        content:
          "我们先聊角色。你可以描述想扮演什么样的人、来自哪里、擅长什么、害怕什么；数值和点数我会按规则自动处理。",
        createdAt: timestamp,
      },
    ],
    toolResults: [],
    status: "chatting",
    rulesContext,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createBlankCharacterCreationDraft(
  rulesetId: string,
  characterType: string,
  seed: Partial<CharacterSeedInput> = {},
): CharacterCard {
  const draft = createEmptyCharacter(rulesetId, "待确定", characterType);
  return {
    ...draft,
    name: "待定角色",
    concept: "待确定",
    background: "",
    inventory: [],
    bonds: [],
    conditions: [],
    notes: [
      `角色卡类型：${draft.characterType ?? characterType}`,
      seed.concept?.trim() ? `玩家初始概念：${seed.concept.trim()}` : "",
      seed.tone?.trim() ? `期望调性：${seed.tone.trim()}` : "",
      seed.profession?.trim() ? `职业倾向：${seed.profession.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export async function runCharacterCreationGmTurn(
  settings: AiSettings,
  session: CharacterCreationSession,
  playerReply: string,
  rulesContext = session.rulesContext ?? "",
  onToken?: (token: string) => void,
): Promise<CharacterCreationSession> {
  const reply = playerReply.trim();
  if (!reply) {
    throw new Error("请输入要告诉制卡 GM 的内容。");
  }

  const timestamp = nowIso();
  const playerMessage: CharacterCreationMessage = {
    id: createId("chargenmsg"),
    author: "player",
    content: reply,
    createdAt: timestamp,
  };
  const baseSession: CharacterCreationSession = {
    ...session,
    rulesContext,
    messages: [...session.messages, playerMessage],
    status: "chatting",
    updatedAt: timestamp,
  };
  const provider = findProvider(settings, settings.defaultProviderId);

  if (!provider.apiKey.trim()) {
    return {
      ...baseSession,
      draft: normalizeGeneratedCharacter(
        {
          ...baseSession.draft,
          concept:
            baseSession.draft.concept === "待确定"
              ? reply.slice(0, 40)
              : baseSession.draft.concept,
          background: [baseSession.draft.background, `玩家补充：${reply}`]
            .filter(Boolean)
            .join("\n"),
        },
        baseSession.rulesetId,
        baseSession.characterType,
      ),
      messages: [
        ...baseSession.messages,
        {
          id: createId("chargenmsg"),
          author: "GM",
          content: emitCharacterCreationTokens(
            `[${provider.name} 未配置 API Key] 我已记录这条设定。继续补充角色的动机、弱点或关系；最终生成时我会用当前模板自动完成数值。`,
            onToken,
          ),
          createdAt: nowIso(),
        },
      ],
      updatedAt: nowIso(),
    };
  }

  const context: CharacterCreationRunContext = {
    draft: baseSession.draft,
    toolResults: [...baseSession.toolResults],
  };
  const model = resolveModel(provider);
  const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const tools = buildCharacterCreationTools();
  const messages = buildCharacterCreationMessages(baseSession);
  let response = await postChatCompletion(endpoint, provider.apiKey, {
    model,
    messages,
    temperature: 0.75,
    stream: false,
    tools,
    tool_choice: "auto",
  });
  if (!response.ok) {
    throw new Error(`制卡 GM 调用失败：${response.status} ${await response.text()}`);
  }

  let data = await readChatCompletionResponse(response);
  for (let index = 0; index < 4 && data.toolCalls.length; index += 1) {
    messages.push({
      role: "assistant",
      content: data.content,
      ...(data.reasoningContent
        ? { reasoning_content: data.reasoningContent }
        : {}),
      tool_calls: data.toolCalls,
    });
    for (const toolCall of data.toolCalls) {
      const result = await executeCharacterCreationTool(
        toolCall,
        baseSession,
        context,
      );
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
    response = await postChatCompletion(endpoint, provider.apiKey, {
      model,
      messages,
      temperature: 0.75,
      stream: false,
      tools,
      tool_choice: "auto",
    });
    if (!response.ok) {
      throw new Error(
        `制卡 GM 工具调用后生成回复失败：${response.status} ${await response.text()}`,
      );
    }
    data = await readChatCompletionResponse(response);
  }
  if (data.toolCalls.length) {
    throw new Error("制卡 GM 工具调用超过最大轮数。");
  }
  const streamedContent = onToken
    ? await streamCharacterCreationReply(endpoint, provider.apiKey, model, messages, onToken)
    : "";
  const content = streamedContent || data.content.trim();

  return {
    ...baseSession,
    draft: context.draft,
    toolResults: context.toolResults,
    messages: [
      ...baseSession.messages,
      {
        id: createId("chargenmsg"),
        author: "GM",
        content,
        createdAt: nowIso(),
      },
    ],
    status: "ready",
    updatedAt: nowIso(),
  };
}

export async function finalizeCharacterCreation(
  settings: AiSettings,
  session: CharacterCreationSession,
): Promise<CharacterCard> {
  const provider = findProvider(settings, settings.defaultProviderId);
  if (!provider.apiKey.trim()) {
    return normalizeGeneratedCharacter(
      {
        ...session.draft,
        notes: `${session.draft.notes}\n离线制卡：已根据当前草稿和模板自动补齐数值。`,
      },
      session.rulesetId,
      session.characterType,
    );
  }

  const model = resolveModel(provider);
  const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await postJsonModeChatCompletion(
    endpoint,
    provider.apiKey,
    {
      model,
      messages: buildCharacterFinalizationMessages(session),
      temperature: 0.45,
      response_format: { type: "json_object" as const },
    },
    "制卡最终生成失败",
  );
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("制卡最终生成没有返回内容。");
  }
  return normalizeGeneratedCharacter(
    extractGeneratedCharacter(parseJsonObject(content)),
    session.rulesetId,
    session.characterType,
  );
}

export async function runAiAgentTurnStreaming(
  agent: AiAgentConfig,
  input: AiTurnInput,
  onToken: (token: string) => void,
): Promise<AiTurnOutput> {
  if (input.toolRuntime) {
    const output = await runAiAgentTurn(agent, input);
    if (output.content) {
      onToken(output.content);
    }
    return output;
  }

  const provider = findProvider(input.settings, agent.providerId);
  const model = resolveModel(provider, agent.model);

  if (!provider.apiKey.trim()) {
    const content = `[${provider.name} 未配置 API Key] ${agent.label} 暂以离线模式回应：已记录“${input.playerAction}”，请在设置中填入 Provider API Key 后启用真实 AI。`;
    onToken(content);
    return {
      role: agent.role,
      label: agent.label,
      content,
    };
  }

  const response = await fetch(
    `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: buildAgentMessages(agent, input),
        temperature: agent.role === "RulesJudge" ? 0.3 : 0.8,
        stream: true,
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${agent.label} 调用失败：${response.status} ${errorText}`);
  }
  if (!response.body) {
    throw new Error(`${agent.label} 没有返回流式内容。`);
  }

  let content = "";
  for await (const token of readChatCompletionStream(response.body)) {
    content += token;
    onToken(token);
  }

  return {
    role: agent.role,
    label: agent.label,
    content: content.trim(),
  };
}

export async function runMultiAgentTurn(
  input: AiTurnInput,
): Promise<AiTurnOutput[]> {
  const enabledAgents = getTurnAgents(input);
  const results: AiTurnOutput[] = [];

  for (const agent of enabledAgents) {
    const output = await runAiAgentTurn(agent, input);
    if (output.content.trim()) {
      results.push(output);
    }
  }

  return results;
}

export function getTurnAgents(input: AiTurnInput): AiAgentConfig[] {
  if (input.privateChat) {
    return privateChatAgents(input.settings.agents, input.privateChat.agent);
  }
  return [
    ...input.settings.agents.filter(
      (agent) =>
        agent.enabled &&
        agent.role !== "Companion" &&
        agent.role !== "RulesJudge" &&
        agent.role !== "Archivist",
    ),
    ...npcTurnAgents(input.detail.npcs ?? [], input.settings),
  ];
}

export function getArchivistAgent(
  input: AiTurnInput,
): AiAgentConfig | undefined {
  if (input.privateChat) {
    return undefined;
  }
  return input.settings.agents.find(
    (agent) => agent.role === "Archivist" && agent.enabled,
  );
}

function npcTurnAgents(
  npcs: NpcCharacter[],
  settings: AiSettings,
): AiAgentConfig[] {
  return npcs
    .filter((npc) => npc.isActive)
    .map((npc) => ({
      role: "Companion",
      label: npc.name,
      providerId: settings.defaultProviderId,
      enabled: true,
      systemPrompt: "",
    }));
}

function privateChatAgents(
  agents: AiAgentConfig[],
  targetAgent: AiAgentConfig,
): AiAgentConfig[] {
  const gm = agents.find((agent) => agent.role === "GM" && agent.enabled);
  const target =
    agents.find(
      (agent) =>
        agent.role === targetAgent.role &&
        agent.label === targetAgent.label &&
        agent.enabled,
    ) ?? (targetAgent.enabled ? targetAgent : undefined);
  const participants = [gm, target].filter((agent): agent is AiAgentConfig =>
    Boolean(agent),
  );
  return participants.filter(
    (agent, index, list) =>
      list.findIndex((item) => item.role === agent.role) === index,
  );
}

export function resolvePrivateChatTarget(
  action: string,
  settings: AiSettings,
  npcs: NpcCharacter[] = [],
): PrivateChatTarget | undefined {
  const match = action.trim().match(/^@([^\s，,：:]+)\s*(.*)$/);
  if (!match) {
    return undefined;
  }

  const raw = match[1];
  const npc = npcs.find((item) => item.name === raw || item.id === raw);
  if (npc) {
    return {
      raw,
      agent: {
        role: "Companion",
        label: npc.name,
        providerId: settings.defaultProviderId,
        enabled: true,
        systemPrompt: "",
      },
    };
  }
  const agent = settings.agents
    .filter((item) => item.enabled)
    .find((item) => item.label === raw || item.role === raw);
  if (!agent) {
    throw new Error(
      `「${raw}」不是当前可交流对象。可用对象：${communicableNames(settings, npcs).join("、")}`,
    );
  }

  return { raw, agent };
}

function communicableNames(
  settings: AiSettings,
  npcs: NpcCharacter[] = [],
): string[] {
  return [
    ...settings.agents
      .filter((agent) => agent.enabled)
      .map((agent) => agent.label),
    ...npcs.map((npc) => npc.name),
  ];
}

function buildToolsForTurn(
  agent: AiAgentConfig,
  input: AiTurnInput,
): ChatCompletionTool[] {
  if (!input.toolRuntime) {
    return [];
  }
  if (input.toolRuntime.mode === "npc" || input.npc) {
    return [getCharacterCardTool()];
  }
  if (agent.role !== "GM") {
    return [];
  }
  return [
    rollDiceTool(),
    getCharacterCardTool(),
    updateCharacterCardTool(),
    createNpcTool(),
    searchRecordsTool(),
  ];
}

function buildCharacterCreationMessages(
  session: CharacterCreationSession,
): ChatMessage[] {
  const template = getCharacterSheetTemplate(session.characterType);
  const ruleset = getRuleset(session.rulesetId);
  const conversation = session.messages
    .map((message) => `${message.author}: ${message.content}`)
    .join("\n");
  return [
    {
      role: "system",
      content: [
        "你是玩家角色卡的制卡 GM，不是正式战役 GM。",
        "你的目标是通过简短中文交流，帮助玩家做出更可玩的一张玩家角色卡。",
        "玩家不需要手动分配点数；属性、技能、点数经济和随机分点由你按规则处理。",
        "如果当前规则书或角色创建规则要求随机分点、随机背景表或骰点来源，你必须调用 roll_dice 工具取得随机结果。",
        "你只能通过制卡工具读取、更新或重置当前制卡草稿；不要创建或修改 NPC，不要写入正式战役记录。",
        "每轮回复要自然、简洁，并在需要时提 1-2 个能推进制卡的具体问题。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `规则书：${ruleset.name}（${session.rulesetId}）`,
        `规则说明：${ruleset.description}`,
        `判定规则：${ruleset.diceExpression}`,
        `角色卡模板 JSON：${JSON.stringify(template)}`,
        session.rulesContext ? `规则书 RAG 片段：\n${session.rulesContext}` : "",
        `当前制卡草稿：${formatCharacterForPrompt(session.draft)}`,
        session.toolResults.length
          ? `已发生工具结果：${JSON.stringify(session.toolResults)}`
          : "",
        `制卡对话：\n${conversation}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

function buildCharacterFinalizationMessages(
  session: CharacterCreationSession,
): ChatMessage[] {
  const template = getCharacterSheetTemplate(session.characterType);
  const conversation = session.messages
    .map((message) => `${message.author}: ${message.content}`)
    .join("\n");
  return [
    {
      role: "system",
      content:
        "你只输出可解析 JSON，不要 Markdown，不要解释。输出一张最终玩家角色卡。",
    },
    {
      role: "user",
      content: [
        "根据制卡对话、当前草稿、规则书片段、角色卡模板和工具结果，生成最终玩家角色卡 JSON。",
        "字段必须包含：name, concept, background, attributes, skills, inventory, bonds, conditions, notes。",
        "不要要求玩家手动分点；如果已有骰点或随机结果，把它们体现在 notes 或数值分配依据中。",
        `规则书：${session.rulesetId}`,
        `角色卡类型：${session.characterType}`,
        `角色卡模板 JSON：${JSON.stringify(template)}`,
        session.rulesContext ? `规则书 RAG 片段：\n${session.rulesContext}` : "",
        `当前草稿：${formatCharacterForPrompt(session.draft)}`,
        session.toolResults.length
          ? `工具结果：${JSON.stringify(session.toolResults)}`
          : "",
        `对话：\n${conversation}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

function buildCharacterCreationTools(): ChatCompletionTool[] {
  return [
    rollDiceTool(),
    getCreationCharacterCardTool(),
    updateCreationCharacterCardTool(),
    resetCreationCharacterCardTool(),
  ];
}

function getCreationCharacterCardTool(): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "get_creation_character_card",
      description: "Read the current player character creation draft.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  };
}

async function streamCharacterCreationReply(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  onToken: (token: string) => void,
): Promise<string> {
  const response = await postChatCompletion(endpoint, apiKey, {
    model,
    messages: [
      ...messages,
      {
        role: "user",
        content:
          "请基于以上制卡上下文、当前草稿和工具结果，输出本轮给玩家看的制卡 GM 回复。可以使用 Markdown。",
      },
    ],
    temperature: 0.75,
    stream: true,
  });
  if (!response.ok) {
    throw new Error(`制卡 GM 流式回复失败：${response.status} ${await response.text()}`);
  }
  if (!response.body) {
    throw new Error("制卡 GM 流式回复没有返回响应体。");
  }
  let content = "";
  for await (const token of readChatCompletionStream(response.body)) {
    content += token;
    onToken(token);
  }
  return content.trim();
}

function emitCharacterCreationTokens(
  content: string,
  onToken?: (token: string) => void,
): string {
  if (onToken) {
    for (const token of content.match(/.{1,8}/gs) ?? [content]) {
      onToken(token);
    }
  }
  return content;
}

function updateCreationCharacterCardTool(): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "update_creation_character_card",
      description:
        "Patch the current player character creation draft. The result is normalized immediately.",
      parameters: {
        type: "object",
        properties: {
          patch: { type: "object" },
        },
        required: ["patch"],
        additionalProperties: false,
      },
    },
  };
}

function resetCreationCharacterCardTool(): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "reset_creation_character_card",
      description:
        "Reset the current player character creation draft to the selected character sheet template defaults.",
      parameters: {
        type: "object",
        properties: {
          concept: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  };
}

function rollDiceTool(): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "roll_dice",
      description:
        "Roll a number of same-sided dice and return every point plus the total.",
      parameters: {
        type: "object",
        properties: {
          sides: { type: "integer", minimum: 2, maximum: 100 },
          count: { type: "integer", minimum: 1, maximum: 20 },
        },
        required: ["sides", "count"],
        additionalProperties: false,
      },
    },
  };
}

function getCharacterCardTool(): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "get_character_card",
      description:
        "Read the player card, a named NPC card, or the current NPC's own card.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "player, self, or an NPC name/id",
          },
        },
        required: ["target"],
        additionalProperties: false,
      },
    },
  };
}

function updateCharacterCardTool(): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "update_character_card",
      description:
        "Update the player or NPC character card with a partial patch.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "player or an NPC name/id" },
          patch: { type: "object" },
        },
        required: ["target", "patch"],
        additionalProperties: false,
      },
    },
  };
}

function createNpcTool(): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "create_npc",
      description:
        "Create a persistent NPC character for the current campaign.",
      parameters: {
        type: "object",
        properties: {
          seed: {
            type: "object",
            properties: {
              name: { type: "string" },
              concept: { type: "string" },
              background: { type: "string" },
            },
          },
          card: { type: "object" },
        },
        additionalProperties: false,
      },
    },
  };
}

function searchRecordsTool(): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "search_records",
      description:
        "Search past game messages/records by keyword. Returns matching messages sorted by recency.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Keyword or phrase to search for in past records",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 20,
            description: "Max number of results (default 5)",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  };
}

async function executeAiTool(
  toolCall: ChatCompletionToolCall,
  input: AiTurnInput,
): Promise<unknown> {
  const runtime = input.toolRuntime;
  if (!runtime) {
    throw new Error("AI 工具运行时尚未配置。");
  }
  const args = parseToolArguments(toolCall.function.arguments);
  let result: unknown;
  if (toolCall.function.name === "roll_dice") {
    assertGmTool(runtime, toolCall.function.name);
    const sides = clampInteger(args.sides, 2, 100, 20);
    const count = clampInteger(args.count, 1, 20, 1);
    result = rollDice(count, sides);
  } else if (toolCall.function.name === "get_character_card") {
    result = resolveCharacterTarget(
      String(args.target ?? "self"),
      input,
      runtime,
    );
  } else if (toolCall.function.name === "update_character_card") {
    assertGmTool(runtime, toolCall.function.name);
    const target = String(args.target ?? "");
    const patch =
      typeof args.patch === "object" && args.patch ? args.patch : {};
    result = await updateCharacterTarget(
      target,
      patch as Partial<CharacterCard>,
      input,
      runtime,
    );
  } else if (toolCall.function.name === "create_npc") {
    assertGmTool(runtime, toolCall.function.name);
    result = await createNpcFromTool(args, input, runtime);
  } else if (toolCall.function.name === "search_records") {
    assertGmTool(runtime, toolCall.function.name);
    result = await searchRecords(args, runtime);
  } else {
    throw new Error(`未知 AI 工具：${toolCall.function.name}`);
  }
  runtime.onToolResult?.({ toolName: toolCall.function.name, result });
  return result;
}

async function executeCharacterCreationTool(
  toolCall: ChatCompletionToolCall,
  session: CharacterCreationSession,
  context: CharacterCreationRunContext,
): Promise<unknown> {
  const args = parseToolArguments(toolCall.function.arguments);
  let result: unknown;
  if (toolCall.function.name === "roll_dice") {
    const sides = clampInteger(args.sides, 2, 100, 20);
    const count = clampInteger(args.count, 1, 20, 1);
    result = rollDice(count, sides);
  } else if (toolCall.function.name === "get_creation_character_card") {
    result = context.draft;
  } else if (toolCall.function.name === "update_creation_character_card") {
    const patch =
      typeof args.patch === "object" && args.patch ? args.patch : {};
    context.draft = normalizeGeneratedCharacter(
      { ...context.draft, ...(patch as Partial<CharacterCard>) },
      session.rulesetId,
      session.characterType,
    );
    result = context.draft;
  } else if (toolCall.function.name === "reset_creation_character_card") {
    context.draft = createBlankCharacterCreationDraft(
      session.rulesetId,
      session.characterType,
      {
        concept:
          typeof args.concept === "string" && args.concept.trim()
            ? args.concept.trim()
            : "",
      },
    );
    result = context.draft;
  } else {
    throw new Error(`未知制卡工具：${toolCall.function.name}`);
  }
  context.toolResults.push({
    toolName: toolCall.function.name,
    result,
    createdAt: nowIso(),
  });
  return result;
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    throw new Error(`AI 工具参数不是有效 JSON：${raw.slice(0, 120)}`);
  }
}

function assertGmTool(runtime: AiToolRuntime, toolName: string): void {
  if (runtime.mode !== "gm") {
    throw new Error(`当前 AI 无权调用 ${toolName}。`);
  }
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function rollDice(count: number, sides: number): {
  expression: string;
  rolls: number[];
  total: number;
} {
  const rolls = Array.from(
    { length: count },
    () => Math.floor(Math.random() * sides) + 1,
  );
  return {
    expression: `${count}d${sides}`,
    rolls,
    total: rolls.reduce((sum, value) => sum + value, 0),
  };
}

function resolveCharacterTarget(
  target: string,
  input: AiTurnInput,
  runtime: AiToolRuntime,
): CharacterCard | NpcCharacter | undefined {
  const normalized = target.trim().toLowerCase();
  if (runtime.mode === "npc") {
    if (
      normalized &&
      normalized !== "self" &&
      normalized !== input.npc?.id.toLowerCase()
    ) {
      throw new Error("NPC 只能检查自己的角色卡。");
    }
    return input.npc;
  }
  if (normalized === "player" || normalized === "玩家") {
    return runtime.getPlayerCharacter();
  }
  return runtime.getNpc(target);
}

async function updateCharacterTarget(
  target: string,
  patch: Partial<CharacterCard>,
  input: AiTurnInput,
  runtime: AiToolRuntime,
): Promise<CharacterCard | NpcCharacter> {
  const current = resolveCharacterTarget(target, input, runtime);
  if (!current) {
    throw new Error(`找不到角色卡：${target}`);
  }
  const normalized = normalizeGeneratedCharacter(
    { ...current, ...patch },
    current.rulesetId,
    current.characterType,
  );
  if ("kind" in current && current.kind === "npc") {
    const updated: NpcCharacter = {
      ...current,
      ...normalized,
      campaignId: current.campaignId,
      kind: "npc",
      isActive: current.isActive,
      createdBy: current.createdBy,
      updatedAt: nowIso(),
    };
    await runtime.saveNpc(updated);
    return updated;
  }
  await runtime.savePlayerCharacter(normalized);
  return normalized;
}

async function createNpcFromTool(
  args: Record<string, unknown>,
  input: AiTurnInput,
  runtime: AiToolRuntime,
): Promise<NpcCharacter> {
  const cardInput =
    typeof args.card === "object" && args.card
      ? args.card
      : typeof args.seed === "object" && args.seed
        ? args.seed
        : {};
  const seed = cardInput as Partial<CharacterCard>;
  const base = createEmptyCharacter(
    input.detail.campaign.rulesetId,
    seed.concept || "战役中的新 NPC",
    input.detail.character?.characterType,
  );
  const card = normalizeGeneratedCharacter(
    {
      ...base,
      ...seed,
      id: createId("npc"),
      name: seed.name || "未命名 NPC",
      concept: seed.concept || base.concept,
      background: seed.background || base.background,
    },
    input.detail.campaign.rulesetId,
    input.detail.character?.characterType,
  );
  const npc: NpcCharacter = {
    ...card,
    campaignId: input.detail.campaign.id,
    kind: "npc",
    isActive: true,
    createdBy: "GM",
    avatarUrl:
      card.avatarUrl ??
      DEFAULT_NPC_AVATARS[
        input.detail.npcs.length % DEFAULT_NPC_AVATARS.length
      ],
    updatedAt: nowIso(),
  };
  await runtime.createNpc(npc);
  return npc;
}

async function searchRecords(
  args: Record<string, unknown>,
  runtime: AiToolRuntime,
): Promise<{
  query: string;
  results: Array<{ author: string; content: string; createdAt: string }>;
}> {
  const query = String(args.query ?? "").trim();
  if (!query) {
    throw new Error("search_records 需要提供 query 参数。");
  }
  if (!runtime.searchMessages) {
    throw new Error("当前环境不支持搜索记录。");
  }
  const limit = clampInteger(args.limit, 1, 20, 5);
  const messages = await runtime.searchMessages(query, limit);
  return {
    query,
    results: messages.map((message) => ({
      author: message.authorLabel ?? message.author,
      content: message.content.slice(0, 500),
      createdAt: message.createdAt,
    })),
  };
}

export async function generateCharacterWithAi(
  settings: AiSettings,
  rulesetId: string,
  seed: CharacterSeedInput,
  characterType = "通用",
): Promise<CharacterCard> {
  const provider = findProvider(settings, settings.defaultProviderId);
  const model = resolveModel(provider);

  if (!provider.apiKey.trim()) {
    return normalizeGeneratedCharacter(
      {
        name: seed.concept ? `${seed.concept}的主角` : "离线生成角色",
        concept: seed.concept || "被命运推上舞台的普通人",
        background: `这是一个离线草案。职业倾向：${seed.profession || "未指定"}。`,
        notes: `调性：${seed.tone || "未指定"}。配置 API Key 后可生成更细致的角色。`,
      },
      rulesetId,
      characterType,
    );
  }

  const ruleset = getRuleset(rulesetId);
  const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const requestBody = {
    model,
    messages: [
      {
        role: "system",
        content: "你只输出可解析 JSON，不要 Markdown，不要解释。",
      },
      {
        role: "user",
        content: ruleset.buildCharacterPrompt(seed),
      },
    ],
    temperature: 0.8,
    response_format: { type: "json_object" as const },
  };
  const response = await postJsonModeChatCompletion(
    endpoint,
    provider.apiKey,
    requestBody,
    "角色卡生成失败",
  );

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("角色卡生成没有返回内容。");
  }

  return normalizeGeneratedCharacter(
    extractGeneratedCharacter(parseJsonObject(content)),
    rulesetId,
    characterType,
  );
}

export async function generateProxyActionOptions(
  settings: AiSettings,
  detail: CampaignDetail,
): Promise<string[]> {
  const provider = findProvider(settings, settings.defaultProviderId);
  const model = resolveModel(provider);
  const prompt = [
    "你是单人跑团的玩家代理，只负责给真人玩家提出可选行动，不要推进剧情。",
    `战役：${detail.campaign.title}`,
    `摘要：${detail.campaign.summary}`,
    `世界状态：${detail.campaign.worldState}`,
    `角色：${detail.character?.name ?? "未绑定角色"} - ${detail.character?.concept ?? ""}`,
    `最近消息：${recentMessages(detail.messages).join("\n") || "暂无"}`,
    '请输出 4 个中文行动选项。只返回 JSON：{"options":["..."]}。',
  ].join("\n");

  if (!provider.apiKey.trim()) {
    return [
      "我先观察附近最不寻常的细节。",
      "我向最近的 NPC 询问这里发生过什么。",
      "我检查随身物品，寻找可用线索。",
      "我谨慎后退，重新评估风险。",
    ];
  }

  const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const requestBody = {
    model,
    messages: [
      {
        role: "system",
        content: "你只输出可解析 JSON，不要 Markdown，不要解释。",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.7,
    response_format: { type: "json_object" as const },
  };
  const response = await postJsonModeChatCompletion(
    endpoint,
    provider.apiKey,
    requestBody,
    "代理选项生成失败",
  );

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("代理选项生成没有返回内容。");
  }

  return normalizeProxyOptions(parseJsonObject(content));
}

function normalizeProxyOptions(raw: unknown): string[] {
  const value = raw as { options?: unknown };
  const options = Array.isArray(value.options) ? value.options : [];
  return options
    .map((option) => (typeof option === "string" ? option.trim() : ""))
    .filter(Boolean)
    .slice(0, 4);
}

function extractGeneratedCharacter(raw: unknown): unknown {
  if (Array.isArray(raw)) {
    return raw[0] ?? {};
  }
  if (typeof raw !== "object" || !raw) {
    return raw;
  }
  const record = raw as Record<string, unknown>;
  return (
    record.character ??
    record.card ??
    record.characterCard ??
    record.data ??
    raw
  );
}

async function postChatCompletion(
  endpoint: string,
  apiKey: string,
  body: unknown,
): Promise<Response> {
  return fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

async function postJsonModeChatCompletion<
  T extends { response_format?: { type: "json_object" } },
>(
  endpoint: string,
  apiKey: string,
  body: T,
  errorPrefix: string,
): Promise<Response> {
  const response = await postChatCompletion(endpoint, apiKey, body);
  if (response.ok) {
    return response;
  }

  const errorText = await response.text();
  if (!body.response_format || !shouldRetryWithoutJsonMode(errorText)) {
    throw new Error(`${errorPrefix}：${response.status} ${errorText}`);
  }

  const compatibleBody = { ...body };
  delete compatibleBody.response_format;
  const retry = await postChatCompletion(endpoint, apiKey, compatibleBody);
  if (!retry.ok) {
    throw new Error(`${errorPrefix}：${retry.status} ${await retry.text()}`);
  }
  return retry;
}

async function readChatCompletionResponse(
  response: Response,
): Promise<{
  content: string;
  reasoningContent: string;
  toolCalls: ChatCompletionToolCall[];
}> {
  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        reasoning_content?: string | null;
        tool_calls?: ChatCompletionToolCall[];
      };
    }>;
  };
  const message = data.choices?.[0]?.message;
  return {
    content: message?.content?.trim() ?? "",
    reasoningContent: message?.reasoning_content?.trim() ?? "",
    toolCalls: message?.tool_calls ?? [],
  };
}

function shouldRetryWithoutJsonMode(errorText: string): boolean {
  const normalized = errorText.toLowerCase();
  return (
    normalized.includes("response_format") ||
    normalized.includes("json_object") ||
    normalized.includes("unexpected")
  );
}

function shouldReportToolSupportError(errorText: string): boolean {
  const normalized = errorText.toLowerCase();
  return (
    normalized.includes("tool") ||
    normalized.includes("function") ||
    normalized.includes("unsupported") ||
    normalized.includes("unrecognized") ||
    normalized.includes("unknown parameter")
  );
}

async function* readChatCompletionStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const token = parseStreamLine(line);
      if (token) {
        yield token;
      }
    }
  }

  const tail = decoder.decode();
  if (tail) {
    buffer += tail;
  }
  const token = parseStreamLine(buffer);
  if (token) {
    yield token;
  }
}

function parseStreamLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return "";
  }
  const data = trimmed.slice("data:".length).trim();
  if (!data || data === "[DONE]") {
    return "";
  }

  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{
        delta?: { content?: string };
        message?: { content?: string };
      }>;
    };
    return (
      parsed.choices?.[0]?.delta?.content ??
      parsed.choices?.[0]?.message?.content ??
      ""
    );
  } catch {
    throw new Error(`AI 流式响应不是有效 JSON：${data.slice(0, 120)}`);
  }
}

export async function fetchProviderModels(
  provider: AiProviderConfig,
): Promise<string[]> {
  if (!provider.apiKey.trim()) {
    throw new Error(`Provider「${provider.name}」缺少 API Key。`);
  }

  const response = await fetch(
    `${provider.baseUrl.replace(/\/$/, "")}/models`,
    {
      headers: {
        authorization: `Bearer ${provider.apiKey}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `获取 ${provider.name} 模型失败：${response.status} ${await response.text()}`,
    );
  }

  const data = (await response.json()) as { data?: Array<{ id?: string }> };
  const models = (data.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => Boolean(id))
    .sort((a, b) => a.localeCompare(b));

  if (!models.length) {
    throw new Error(`Provider「${provider.name}」没有返回模型列表。`);
  }

  return models;
}

export interface ProviderConnectionTestResult {
  providerName: string;
  model: string;
  latencyMs: number;
  content: string;
}

export async function testProviderConnection(
  provider: AiProviderConfig,
): Promise<ProviderConnectionTestResult> {
  if (!provider.apiKey.trim()) {
    throw new Error(`Provider「${provider.name}」缺少 API Key。`);
  }

  const model = resolveModel(provider);
  const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const startedAt = Date.now();
  const response = await postChatCompletion(endpoint, provider.apiKey, {
    model,
    messages: [
      {
        role: "system",
        content: "你是 Provider 连通性测试。只回复 OK。",
      },
      {
        role: "user",
        content: "请只回复 OK，用于确认当前 API Key、Base URL 和模型可用。",
      },
    ],
    temperature: 0,
  });

  if (!response.ok) {
    throw new Error(
      `测试 ${provider.name} 失败：${response.status} ${await response.text()}`,
    );
  }

  const result = await readChatCompletionResponse(response);
  if (!result.content) {
    throw new Error(`Provider「${provider.name}」响应为空。`);
  }

  return {
    providerName: provider.name,
    model,
    latencyMs: Date.now() - startedAt,
    content: result.content,
  };
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(withoutFence.slice(start, end + 1));
      } catch {
        throw new Error(
          `AI 返回的角色卡不是有效 JSON：${trimmed.slice(0, 120)}`,
        );
      }
    }
    throw new Error(`AI 返回的角色卡不是有效 JSON：${trimmed.slice(0, 120)}`);
  }
}
