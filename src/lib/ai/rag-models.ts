import type { AiSettings } from "@/types";
import { findProvider } from "./settings";
import { postChatCompletion } from "./chat";

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

