import { generateEmbeddings, rerankDocuments } from "@/lib/ai";
import { createId, nowIso } from "@/lib/id";
import {
  searchPineconeRulebook,
  upsertRulebookToPinecone,
  type PineconeUsage,
} from "@/lib/pinecone";
import type { GameRepository } from "@/lib/storage";
import type { AiSettings, RulebookChunk, RulebookDocument } from "@/types";

export interface ImportRulebookInput {
  rulesetId: string;
  characterType?: string;
  title: string;
  sourceName: string;
  content: string;
  settings: AiSettings;
  onPineconeUsage?: (event: PineconeUsageEvent) => void;
}

export interface PineconeUsageEvent {
  operation: "import" | "search";
  usage?: PineconeUsage;
  hitCount?: number;
  fallbackToGlobalSearch?: boolean;
  createdAt: string;
}

const ragContextCache = new Map<string, string>();
const maxRagContextCacheEntries = 50;

export async function importRulebookDocument(
  repository: GameRepository,
  input: ImportRulebookInput,
): Promise<RulebookDocument> {
  const content = normalizeRulebookText(input.content);
  if (!content) {
    throw new Error("规则书内容为空。");
  }
  if (!input.settings.rag.enabled) {
    throw new Error("请先在 AI 设置中启用 RAG。");
  }

  const timestamp = nowIso();
  const documentId = createId("rulebook");
  const chunks = chunkRulebookText(content, input.settings.rag.chunkSize);
  const embeddings =
    input.settings.rag.source === "pinecone"
      ? chunks.map(() => [])
      : await generateEmbeddings(input.settings, chunks);
  const document: RulebookDocument = {
    id: documentId,
    rulesetId: input.rulesetId,
    characterType: input.characterType?.trim() || "通用",
    title: input.title.trim() || input.sourceName || "未命名规则书",
    sourceName: input.sourceName || "manual",
    content,
    chunkCount: chunks.length,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const rulebookChunks: RulebookChunk[] = chunks.map((chunk, index) => ({
    id: createId("rulechunk"),
    documentId,
    rulesetId: input.rulesetId,
    chunkIndex: index,
    content: chunk,
    embedding: embeddings[index] ?? [],
    createdAt: timestamp,
  }));

  if (input.settings.rag.source === "pinecone") {
    const usage = await upsertRulebookToPinecone(
      input.settings.rag,
      document,
      rulebookChunks,
    );
    input.onPineconeUsage?.({
      operation: "import",
      usage,
      createdAt: nowIso(),
    });
  }
  await repository.saveRulebookDocument(document, rulebookChunks);
  return document;
}

export async function buildRulesRagContext(
  repository: GameRepository,
  settings: AiSettings,
  rulesetId: string,
  query: string,
  options: { onPineconeUsage?: (event: PineconeUsageEvent) => void } = {},
): Promise<string> {
  if (!settings.rag.enabled || !query.trim()) {
    return "";
  }
  if (settings.rag.source === "pinecone") {
    return buildRulesRagContextUncached(
      repository,
      settings,
      rulesetId,
      query,
      options,
    );
  }
  const documentVersion = await buildRulebookVersionSignature(
    repository,
    rulesetId,
    settings.rag.crossRulebookFallbackEnabled,
  );
  const cacheKey = createRagContextCacheKey(
    settings,
    rulesetId,
    query,
    documentVersion,
  );
  const cached = ragContextCache.get(cacheKey);
  if (cached !== undefined) {
    ragContextCache.delete(cacheKey);
    ragContextCache.set(cacheKey, cached);
    return cached;
  }
  const context = await buildRulesRagContextUncached(
    repository,
    settings,
    rulesetId,
    query,
    options,
  );
  rememberRagContext(cacheKey, context);
  return context;
}

async function buildRulesRagContextUncached(
  repository: GameRepository,
  settings: AiSettings,
  rulesetId: string,
  query: string,
  options: { onPineconeUsage?: (event: PineconeUsageEvent) => void },
): Promise<string> {
  if (settings.rag.source === "pinecone") {
    const scoped = await searchPineconeRulebook(settings.rag, rulesetId, query);
    const shouldFallback =
      settings.rag.crossRulebookFallbackEnabled && !scoped.hits.length;
    const result = scoped.hits.length || !shouldFallback
      ? scoped
      : await searchPineconeRulebook(settings.rag, undefined, query);
    options.onPineconeUsage?.({
      operation: "search",
      usage: !shouldFallback
        ? scoped.usage
        : mergePineconeUsage(scoped.usage, result.usage),
      hitCount: result.hits.length,
      fallbackToGlobalSearch: shouldFallback,
      createdAt: nowIso(),
    });
    return result.hits
      .slice(0, settings.rag.topK)
      .map(
        (hit, index) =>
          `[规则片段 ${index + 1} | chunk ${hit.chunkIndex + 1} | score ${hit.score.toFixed(3)}]\n${hit.content}`,
      )
      .join("\n\n");
  }
  let chunks = await repository.listRulebookChunks(rulesetId);
  if (!chunks.length && settings.rag.crossRulebookFallbackEnabled) {
    chunks = await repository.listRulebookChunks();
  }
  if (!chunks.length) {
    return "";
  }

  const [queryEmbedding] = await generateEmbeddings(settings, query);
  const candidates = chunks
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(settings.rag.topK * 3, settings.rag.topK));

  const reranked = await rerankDocuments(
    settings,
    query,
    candidates.map((candidate) => candidate.chunk.content),
  );
  const selected = (settings.rag.rerankModel.trim() ? reranked : [])
    .map((item) => candidates[item.index])
    .filter(Boolean)
    .slice(0, settings.rag.topK);
  const finalCandidates = selected.length
    ? selected
    : candidates.slice(0, settings.rag.topK);

  return finalCandidates
    .map(
      (candidate, index) =>
        `[规则片段 ${index + 1} | chunk ${candidate.chunk.chunkIndex + 1} | score ${candidate.score.toFixed(3)}]\n${candidate.chunk.content}`,
    )
    .join("\n\n");
}

function createRagContextCacheKey(
  settings: AiSettings,
  rulesetId: string,
  query: string,
  documentVersion: string,
): string {
  const rag = settings.rag;
  return JSON.stringify({
    rulesetId,
    query: query.trim(),
    documentVersion,
    source: rag.source,
    crossRulebookFallbackEnabled: rag.crossRulebookFallbackEnabled,
    topK: rag.topK,
    embeddingProviderId: rag.embeddingProviderId,
    embeddingModel: rag.embeddingModel,
    rerankProviderId: rag.rerankProviderId,
    rerankModel: rag.rerankModel,
    pineconeIndexName: rag.pineconeIndexName,
    pineconeNamespace: rag.pineconeNamespace,
    pineconeEmbeddingModel: rag.pineconeEmbeddingModel,
    pineconeRerankEnabled: rag.pineconeRerankEnabled,
    pineconeRerankModel: rag.pineconeRerankModel,
  });
}

async function buildRulebookVersionSignature(
  repository: GameRepository,
  rulesetId: string,
  includeFallbackCorpus: boolean,
): Promise<string> {
  const documents = includeFallbackCorpus
    ? await repository.listRulebookDocuments()
    : await repository.listRulebookDocuments(rulesetId);
  if (!documents.length) {
    return "none";
  }
  return documents
    .map((document) => `${document.id}:${document.updatedAt}:${document.chunkCount}`)
    .sort()
    .join("|");
}

function rememberRagContext(cacheKey: string, context: string): void {
  ragContextCache.set(cacheKey, context);
  if (ragContextCache.size <= maxRagContextCacheEntries) {
    return;
  }
  const oldest = ragContextCache.keys().next().value;
  if (oldest) {
    ragContextCache.delete(oldest);
  }
}

function mergePineconeUsage(
  current: PineconeUsage | undefined,
  next: PineconeUsage | undefined,
): PineconeUsage | undefined {
  if (!next) {
    return current;
  }
  const merged = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === "number") {
      merged[key] = (merged[key] ?? 0) + value;
    }
  }
  return Object.keys(merged).length ? merged : undefined;
}

export function chunkRulebookText(content: string, chunkSize: number): string[] {
  const normalized = normalizeRulebookText(content);
  const paragraphs = normalized.split(/\n{2,}/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }
    if (`${current}\n\n${paragraph}`.length <= chunkSize) {
      current = `${current}\n\n${paragraph}`;
      continue;
    }
    chunks.push(current);
    current = paragraph;
  }
  if (current) {
    chunks.push(current);
  }

  return chunks.flatMap((chunk) => splitOversizedChunk(chunk, chunkSize));
}

function splitOversizedChunk(chunk: string, chunkSize: number): string[] {
  if (chunk.length <= chunkSize) {
    return [chunk];
  }
  const result: string[] = [];
  for (let start = 0; start < chunk.length; start += chunkSize) {
    result.push(chunk.slice(start, start + chunkSize));
  }
  return result;
}

function normalizeRulebookText(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    aNorm += a[index] * a[index];
    bNorm += b[index] * b[index];
  }
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm) || 1);
}
