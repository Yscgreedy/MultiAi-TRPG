import type { AiAgentConfig, AiProviderConfig, AiRagSettings, AiSettings } from "@/types";
import { clampInteger } from "./utils";

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
    crossRulebookFallbackEnabled: false,
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
    topK: 4,
    chunkSize: 900,
  },
};

interface LegacyAiRagSettings extends Partial<AiRagSettings> {
  pineconeGlobalFallbackEnabled?: boolean;
}

interface LegacyAiSettings {
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  agents?: AiAgentConfig[];
  providers?: AiProviderConfig[];
  defaultProviderId?: string;
  responseMode?: AiSettings["responseMode"];
  rag?: LegacyAiRagSettings;
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
  raw: LegacyAiRagSettings | undefined,
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
    crossRulebookFallbackEnabled:
      raw?.crossRulebookFallbackEnabled ?? raw?.pineconeGlobalFallbackEnabled ?? false,
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

export function findProvider(
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

export function resolveModel(provider: AiProviderConfig, model?: string): string {
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
