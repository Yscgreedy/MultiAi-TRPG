import type { AiRagSettings, RulebookChunk, RulebookDocument } from "@/types";

export const PINECONE_USAGE_URL =
  "https://app.pinecone.io/organizations/-/projects/-/usage";

const PINECONE_API_VERSION = "2026-04";
const CONTROL_PLANE_URL = "https://api.pinecone.io/indexes";
const CREATE_INDEX_FOR_MODEL_URL = `${CONTROL_PLANE_URL}/create-for-model`;
const TEXT_UPSERT_BATCH_SIZE = 96;

interface PineconeIndexDescription {
  name: string;
  host?: string;
  status?: {
    ready?: boolean;
    state?: string;
  };
}

interface PineconeSearchResult {
  _id?: string;
  id?: string;
  _score?: number;
  score?: number;
  fields?: {
    chunk_text?: string;
    content?: string;
    chunk_index?: number;
    document_id?: string;
    title?: string;
  };
}

interface PineconeSearchResponse {
  result?: {
    hits?: PineconeSearchResult[];
  };
  usage?: PineconeUsage;
}

export type PineconeUsage = Record<string, number | undefined>;

export interface PineconeRulebookHit {
  id: string;
  score: number;
  content: string;
  chunkIndex: number;
  documentId?: string;
  title?: string;
}

export interface PineconeSearchSummary {
  hits: PineconeRulebookHit[];
  usage?: PineconeSearchResponse["usage"];
}

export async function upsertRulebookToPinecone(
  rag: AiRagSettings,
  document: RulebookDocument,
  chunks: RulebookChunk[],
): Promise<PineconeUsage | undefined> {
  validatePineconeSettings(rag);
  const host = await ensurePineconeIndex(rag);
  const namespace = encodeURIComponent(rag.pineconeNamespace.trim());
  let usage: PineconeUsage | undefined;
  for (let start = 0; start < chunks.length; start += TEXT_UPSERT_BATCH_SIZE) {
    const batch = chunks.slice(start, start + TEXT_UPSERT_BATCH_SIZE);
    const response = await fetch(`https://${host}/records/namespaces/${namespace}/upsert`, {
      method: "POST",
      headers: {
        ...pineconeDataHeaders(rag),
        "content-type": "application/x-ndjson",
      },
      body: batch
        .map((chunk) =>
          JSON.stringify({
            _id: chunk.id,
            chunk_text: chunk.content,
            ruleset_id: chunk.rulesetId,
            document_id: document.id,
            chunk_index: chunk.chunkIndex,
            title: document.title,
            source_name: document.sourceName,
          }),
        )
        .join("\n"),
    });
    if (!response.ok) {
      throw new Error(await getPineconeHttpError(response, "规则书上传"));
    }
    usage = mergePineconeUsage(usage, await readPineconeUsage(response));
  }
  return usage;
}

export async function searchPineconeRulebook(
  rag: AiRagSettings,
  rulesetId: string | undefined,
  query: string,
): Promise<PineconeSearchSummary> {
  validatePineconeSettings(rag);
  const host = await ensurePineconeIndex(rag);
  const namespace = encodeURIComponent(rag.pineconeNamespace.trim());
  const body: Record<string, unknown> = {
    query: {
      top_k: Math.max(rag.topK * 3, rag.topK),
      inputs: {
        text: query,
      },
      ...(rulesetId
        ? {
            filter: {
              ruleset_id: { "$eq": rulesetId },
            },
          }
        : {}),
    },
    fields: ["chunk_text", "chunk_index", "document_id", "title"],
  };

  if (rag.pineconeRerankEnabled && rag.pineconeRerankModel.trim()) {
    body.rerank = {
      query,
      model: rag.pineconeRerankModel.trim(),
      top_n: rag.topK,
      rank_fields: ["chunk_text"],
    };
  }

  const response = await fetch(`https://${host}/records/namespaces/${namespace}/search`, {
    method: "POST",
    headers: pineconeDataHeaders(rag),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await getPineconeHttpError(response, "规则书检索"));
  }

  const data = (await response.json()) as PineconeSearchResponse;
  const hits = data.result?.hits ?? [];
  return {
    usage: data.usage,
    hits: hits
      .map((hit) => ({
        id: hit._id ?? hit.id ?? "",
        score: hit._score ?? hit.score ?? 0,
        content: hit.fields?.chunk_text ?? hit.fields?.content ?? "",
        chunkIndex: Number(hit.fields?.chunk_index ?? 0),
        documentId: hit.fields?.document_id,
        title: hit.fields?.title,
      }))
      .filter((hit) => hit.id && hit.content),
  };
}

function validatePineconeSettings(rag: AiRagSettings): void {
  if (!rag.pineconeApiKey.trim()) {
    throw new Error("请先填写 Pinecone API Key。");
  }
  if (!rag.pineconeIndexName.trim()) {
    throw new Error("请先填写 Pinecone Index 名称。");
  }
}

async function ensurePineconeIndex(rag: AiRagSettings): Promise<string> {
  const existing = await describePineconeIndex(rag);
  if (existing?.host && existing.status?.ready !== false) {
    return existing.host;
  }
  if (!existing) {
    await createPineconeIndex(rag);
  }

  const ready = await waitForPineconeIndex(rag);
  if (ready?.host && ready.status?.ready !== false) {
    return ready.host;
  }
  throw new Error(
    "Pinecone Index 正在初始化，暂时降级为不使用云端规则书检索。建议等待 1-2 分钟后重试导入或回合检索；如果一直未就绪，请到 Pinecone 控制台检查 index 状态和 region 配置。",
  );
}

async function describePineconeIndex(
  rag: AiRagSettings,
): Promise<PineconeIndexDescription | undefined> {
  const response = await fetch(`${CONTROL_PLANE_URL}/${rag.pineconeIndexName}`, {
    method: "GET",
    headers: pineconeControlHeaders(rag),
  });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(await getPineconeHttpError(response, "Index 查询"));
  }
  return (await response.json()) as PineconeIndexDescription;
}

async function createPineconeIndex(rag: AiRagSettings): Promise<void> {
  const response = await fetch(CREATE_INDEX_FOR_MODEL_URL, {
    method: "POST",
    headers: pineconeControlHeaders(rag),
    body: JSON.stringify({
      name: rag.pineconeIndexName,
      cloud: rag.pineconeCloud,
      region: rag.pineconeRegion,
      embed: {
        model: rag.pineconeEmbeddingModel,
        metric: "cosine",
        field_map: {
          text: "chunk_text",
        },
        write_parameters: {
          input_type: "passage",
          truncate: "END",
        },
        read_parameters: {
          input_type: "query",
          truncate: "END",
        },
      },
    }),
  });
  if (!response.ok && response.status !== 409) {
    throw new Error(await getPineconeHttpError(response, "Index 创建"));
  }
}

async function waitForPineconeIndex(
  rag: AiRagSettings,
): Promise<PineconeIndexDescription | undefined> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const description = await describePineconeIndex(rag);
    if (description?.host && description.status?.ready !== false) {
      return description;
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 1200));
  }
  return undefined;
}

function pineconeControlHeaders(rag: AiRagSettings): HeadersInit {
  return {
    "api-key": rag.pineconeApiKey.trim(),
    "x-pinecone-api-version": PINECONE_API_VERSION,
    "content-type": "application/json",
  };
}

function pineconeDataHeaders(rag: AiRagSettings): HeadersInit {
  return {
    "Api-Key": rag.pineconeApiKey.trim(),
    "X-Pinecone-API-Version": PINECONE_API_VERSION,
    "content-type": "application/json",
  };
}

async function getPineconeHttpError(response: Response, action: string): Promise<string> {
  const detail = await response.text();
  if (response.status === 429) {
    return `Pinecone ${action}被限流或额度不足，已降级为本次不使用 Pinecone RAG。建议先关闭 Pinecone rerank、减少检索片段数，或等待 Starter 额度/速率限制恢复；需要持续使用时请升级 Pinecone 计划。${formatPineconeDetail(detail)}`;
  }
  if (response.status === 404 || response.status === 409 || response.status === 503) {
    return `Pinecone ${action}暂不可用，可能是 Index 还没创建完成或尚未就绪。建议等待 1-2 分钟后重试，并确认 Index 名称、Cloud/Region 与控制台一致。${formatPineconeDetail(detail)}`;
  }
  return `Pinecone ${action}失败：HTTP ${response.status}。${formatPineconeDetail(detail)}`;
}

function formatPineconeDetail(detail: string): string {
  const trimmed = detail.trim();
  return trimmed ? `\nPinecone 返回：${trimmed}` : "";
}

async function readPineconeUsage(response: Response): Promise<PineconeUsage | undefined> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return undefined;
  }
  try {
    const data = (await response.clone().json()) as { usage?: PineconeUsage };
    return data.usage;
  } catch {
    return undefined;
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
