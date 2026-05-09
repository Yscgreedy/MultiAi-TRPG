import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultAiSettings, normalizeAiSettings } from "@/lib/ai";
import { buildRulesRagContext, importRulebookDocument } from "@/lib/rag";
import { BrowserRepository } from "@/lib/storage";

const store = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
});

describe("rulebook RAG", () => {
  beforeEach(() => {
    store.clear();
    vi.restoreAllMocks();
  });

  it("imports rulebook chunks and retrieves without rerank when rerank model is empty", async () => {
    const requests: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return jsonResponse({
        data: inputs.map((input: string) => ({
          embedding: input.includes("撬锁") || input.includes("锁") ? [1, 0] : [0, 1],
        })),
      });
    });
    const settings = normalizeAiSettings({
      ...defaultAiSettings,
      providers: [{ ...defaultAiSettings.providers[0], apiKey: "test-key" }],
      rag: {
        ...defaultAiSettings.rag,
        rerankModel: "",
        topK: 1,
        chunkSize: 30,
      },
    });
    const repository = new BrowserRepository();
    await repository.init();
    const lockRule = "撬锁时使用 mind + 调查。".repeat(25);
    const chaseRule = "追逐时使用 body + 运动。".repeat(25);

    const document = await importRulebookDocument(repository, {
      rulesetId: "light-rules-v1",
      title: "判定规则",
      sourceName: "rules.md",
      content: `${lockRule}\n\n${chaseRule}`,
      settings,
    });
    const context = await buildRulesRagContext(
      repository,
      settings,
      "light-rules-v1",
      "我尝试撬锁。",
    );

    expect(document.chunkCount).toBeGreaterThan(1);
    expect(context).toContain("撬锁时使用");
    expect(context).not.toContain("追逐时使用");
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests)).not.toContain("rerank");
  });

  it("uses Pinecone integrated embedding and leaves rerank disabled by default", async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const body = init?.body ? parseBody(init.body) : undefined;
      requests.push({ url, body });
      if (url.includes("/indexes/multi-ai-trpg-rag") && requests.length === 1) {
        return new Response("missing", { status: 404 });
      }
      if (url.endsWith("/indexes/create-for-model") && init?.method === "POST") {
        return jsonResponse({ name: "multi-ai-trpg-rag" });
      }
      if (url.includes("/indexes/multi-ai-trpg-rag")) {
        return jsonResponse({
          name: "multi-ai-trpg-rag",
          host: "test-index.svc.pinecone.io",
          status: { ready: true },
        });
      }
      if (url.includes("/upsert")) {
        return jsonResponse({});
      }
      if (url.includes("/search")) {
        return jsonResponse({
          result: {
            hits: [
              {
                _id: "rulechunk_1",
                _score: 0.91,
                fields: {
                  chunk_text: "撬锁时使用 mind + 调查。",
                  chunk_index: 0,
                },
              },
            ],
          },
          usage: { read_units: 1 },
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const settings = normalizeAiSettings({
      ...defaultAiSettings,
      rag: {
        ...defaultAiSettings.rag,
        source: "pinecone",
        pineconeApiKey: "pc-test-key",
        pineconeRerankEnabled: false,
      },
    });
    const repository = new BrowserRepository();
    await repository.init();

    await importRulebookDocument(repository, {
      rulesetId: "light-rules-v1",
      title: "判定规则",
      sourceName: "rules.md",
      content: "撬锁时使用 mind + 调查。",
      settings,
    });
    const context = await buildRulesRagContext(
      repository,
      settings,
      "light-rules-v1",
      "我尝试撬锁。",
    );

    expect(context).toContain("撬锁时使用");
    expect(requests.some((request) => request.url.includes("/upsert"))).toBe(true);
    expect(requests.some((request) => request.url.includes("/search"))).toBe(true);
    expect(JSON.stringify(requests)).not.toContain("rerank");
  });
});

function parseBody(body: BodyInit): unknown {
  if (typeof body !== "string") {
    return undefined;
  }
  if (body.includes("\n")) {
    return body.split("\n").map((line) => JSON.parse(line));
  }
  return JSON.parse(body);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
