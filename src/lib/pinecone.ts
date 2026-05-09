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
  usage?: {
    read_units?: number;
    rerank_units?: number;
    embed_total_tokens?: number;
  };
}

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
): Promise<void> {
  validatePineconeSettings(rag);
  const host = await ensurePineconeIndex(rag);
  const namespace = encodeURIComponent(rag.pineconeNamespace.trim());
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
      throw new Error(`Pinecone 规则书上传失败：${response.status} ${await response.text()}`);
    }
  }
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
    throw new Error(`Pinecone 规则书检索失败：${response.status} ${await response.text()}`);
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
  throw new Error("Pinecone Index 正在初始化，请稍后重试。");
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
    throw new Error(`Pinecone Index 查询失败：${response.status} ${await response.text()}`);
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
    throw new Error(`Pinecone Index 创建失败：${response.status} ${await response.text()}`);
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
