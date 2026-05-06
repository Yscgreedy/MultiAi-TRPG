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
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
