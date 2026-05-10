import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultAiSettings, normalizeAiSettings } from "@/lib/ai";
import {
  buildRulesRagContext,
  importRulebookDocument,
  type PineconeUsageEvent,
} from "@/lib/rag";
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
    const cachedContext = await buildRulesRagContext(
      repository,
      settings,
      "light-rules-v1",
      "我尝试撬锁。",
    );

    expect(document.chunkCount).toBeGreaterThan(1);
    expect(context).toContain("撬锁时使用");
    expect(cachedContext).toBe(context);
    expect(context).not.toContain("追逐时使用");
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests)).not.toContain("rerank");
  });

  it("invalidates local RAG cache when rulebook documents change", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return jsonResponse({
        data: inputs.map((input: string) => ({
          embedding: input.includes("旧版") || input.includes("老锁") ? [1, 0] : [0, 1],
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
        chunkSize: 120,
      },
    });
    const repository = new BrowserRepository();
    await repository.init();

    const oldDocument = await importRulebookDocument(repository, {
      rulesetId: "light-rules-v1",
      title: "旧判定规则",
      sourceName: "old-rules.md",
      content: "老锁规则：旧版撬锁检定使用 mind + 调查，并承受风险。",
      settings,
    });
    const oldContext = await buildRulesRagContext(
      repository,
      settings,
      "light-rules-v1",
      "我想撬锁",
    );

    await repository.deleteRulebookDocument(oldDocument.id);
    await importRulebookDocument(repository, {
      rulesetId: "light-rules-v1",
      title: "新判定规则",
      sourceName: "new-rules.md",
      content: "新版开锁规则：撬锁时优先使用 finesse + 工具，并可请求协助。",
      settings,
    });
    const refreshedContext = await buildRulesRagContext(
      repository,
      settings,
      "light-rules-v1",
      "我想撬锁",
    );

    expect(oldContext).toContain("老锁规则");
    expect(refreshedContext).toContain("新版开锁规则");
    expect(refreshedContext).not.toContain("老锁规则");
  });

  it("does not fall back across rulebooks locally by default", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return jsonResponse({
        data: inputs.map((input: string) => ({
          embedding: input.includes("星舰") ? [1, 0] : [0, 1],
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
      },
    });
    const repository = new BrowserRepository();
    await repository.init();

    await importRulebookDocument(repository, {
      rulesetId: "space-rules",
      title: "太空规则",
      sourceName: "space.md",
      content: "星舰闪避依赖 agility + piloting。",
      settings,
    });
    const context = await buildRulesRagContext(
      repository,
      settings,
      "light-rules-v1",
      "我要驾驶星舰闪避炮火",
    );

    expect(context).toBe("");
  });

  it("falls back across rulebooks locally only when enabled", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return jsonResponse({
        data: inputs.map((input: string) => ({
          embedding: input.includes("星舰") ? [1, 0] : [0, 1],
        })),
      });
    });
    const settings = normalizeAiSettings({
      ...defaultAiSettings,
      providers: [{ ...defaultAiSettings.providers[0], apiKey: "test-key" }],
      rag: {
        ...defaultAiSettings.rag,
        crossRulebookFallbackEnabled: true,
        rerankModel: "",
        topK: 1,
      },
    });
    const repository = new BrowserRepository();
    await repository.init();

    await importRulebookDocument(repository, {
      rulesetId: "space-rules",
      title: "太空规则",
      sourceName: "space.md",
      content: "星舰闪避依赖 agility + piloting。",
      settings,
    });
    const context = await buildRulesRagContext(
      repository,
      settings,
      "light-rules-v1",
      "我要驾驶星舰闪避炮火",
    );

    expect(context).toContain("星舰闪避");
  });

  it("invalidates fallback cache when another rulebook changes", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return jsonResponse({
        data: inputs.map((input: string) => ({
          embedding:
            input.includes("星舰") || input.includes("相位") || input.includes("曲速")
              ? [1, 0]
              : [0, 1],
        })),
      });
    });
    const settings = normalizeAiSettings({
      ...defaultAiSettings,
      providers: [{ ...defaultAiSettings.providers[0], apiKey: "test-key" }],
      rag: {
        ...defaultAiSettings.rag,
        crossRulebookFallbackEnabled: true,
        rerankModel: "",
        topK: 1,
      },
    });
    const repository = new BrowserRepository();
    await repository.init();

    const originalDocument = await importRulebookDocument(repository, {
      rulesetId: "space-rules",
      title: "旧太空规则",
      sourceName: "space-old.md",
      content: "星舰相位闪避依赖 agility + piloting。",
      settings,
    });
    const oldContext = await buildRulesRagContext(
      repository,
      settings,
      "light-rules-v1",
      "我要驾驶星舰闪避炮火",
    );

    await repository.deleteRulebookDocument(originalDocument.id);
    await importRulebookDocument(repository, {
      rulesetId: "space-rules",
      title: "新太空规则",
      sourceName: "space-new.md",
      content: "星舰曲速规避优先使用 insight + piloting。",
      settings,
    });
    const refreshedContext = await buildRulesRagContext(
      repository,
      settings,
      "light-rules-v1",
      "我要驾驶星舰闪避炮火",
    );

    expect(oldContext).toContain("星舰相位闪避");
    expect(refreshedContext).toContain("星舰曲速规避");
    expect(refreshedContext).not.toContain("星舰相位闪避");
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
    const usageEvents: PineconeUsageEvent[] = [];

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
      { onPineconeUsage: (event) => usageEvents.push(event) },
    );

    expect(context).toContain("撬锁时使用");
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0].usage?.read_units).toBe(1);
    expect(usageEvents[0].hitCount).toBe(1);
    expect(requests.some((request) => request.url.includes("/upsert"))).toBe(true);
    expect(requests.some((request) => request.url.includes("/search"))).toBe(true);
    expect(JSON.stringify(requests)).not.toContain("rerank");
  });

  it("uses the unified fallback setting for Pinecone global fallback", async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const body = init?.body ? parseBody(init.body) : undefined;
      requests.push({ url, body });
      if (url.includes("/indexes/multi-ai-trpg-rag")) {
        return jsonResponse({
          name: "multi-ai-trpg-rag",
          host: "test-index.svc.pinecone.io",
          status: { ready: true },
        });
      }
      if (url.includes("/search") && requests.filter((request) => request.url.includes("/search")).length === 1) {
        return jsonResponse({ result: { hits: [] }, usage: { read_units: 1 } });
      }
      if (url.includes("/search")) {
        return jsonResponse({
          result: {
            hits: [
              {
                _id: "rulechunk_2",
                _score: 0.82,
                fields: {
                  chunk_text: "跨规则书命中的备用片段。",
                  chunk_index: 1,
                },
              },
            ],
          },
          usage: { read_units: 2 },
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
        crossRulebookFallbackEnabled: true,
      },
    });
    const repository = new BrowserRepository();
    await repository.init();
    const usageEvents: PineconeUsageEvent[] = [];

    const context = await buildRulesRagContext(
      repository,
      settings,
      "light-rules-v1",
      "我尝试撬锁。",
      { onPineconeUsage: (event) => usageEvents.push(event) },
    );

    expect(context).toContain("跨规则书命中的备用片段");
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0].fallbackToGlobalSearch).toBe(true);
    expect(usageEvents[0].usage?.read_units).toBe(3);
  });

  it("reports Pinecone 429 quota errors with Chinese downgrade guidance", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/indexes/multi-ai-trpg-rag")) {
        return jsonResponse({
          name: "multi-ai-trpg-rag",
          host: "test-index.svc.pinecone.io",
          status: { ready: true },
        });
      }
      if (url.includes("/search")) {
        return new Response("quota exceeded", { status: 429 });
      }
      return new Response("unexpected", { status: 500 });
    });
    const settings = normalizeAiSettings({
      ...defaultAiSettings,
      rag: {
        ...defaultAiSettings.rag,
        source: "pinecone",
        pineconeApiKey: "pc-test-key",
      },
    });
    const repository = new BrowserRepository();
    await repository.init();

    await expect(
      buildRulesRagContext(repository, settings, "light-rules-v1", "我尝试撬锁。"),
    ).rejects.toThrow(/关闭 Pinecone rerank、减少检索片段数/);
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
