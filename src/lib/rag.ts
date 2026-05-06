import { generateEmbeddings, rerankDocuments } from "@/lib/ai";
import { createId, nowIso } from "@/lib/id";
import type { GameRepository } from "@/lib/storage";
import type { AiSettings, RulebookChunk, RulebookDocument } from "@/types";

export interface ImportRulebookInput {
  rulesetId: string;
  title: string;
  sourceName: string;
  content: string;
  settings: AiSettings;
}

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
  const embeddings = await generateEmbeddings(input.settings, chunks);
  const document: RulebookDocument = {
    id: documentId,
    rulesetId: input.rulesetId,
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

  await repository.saveRulebookDocument(document, rulebookChunks);
  return document;
}

export async function buildRulesRagContext(
  repository: GameRepository,
  settings: AiSettings,
  rulesetId: string,
  query: string,
): Promise<string> {
  if (!settings.rag.enabled || !query.trim()) {
    return "";
  }
  const chunks = await repository.listRulebookChunks(rulesetId);
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
