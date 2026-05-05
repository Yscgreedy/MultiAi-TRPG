import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultAiSettings, normalizeAiSettings } from "@/lib/ai";
import { bootstrapCampaign, playTurnStreaming } from "@/lib/game";
import { createEmptyCharacter } from "@/lib/rulesets";
import { BrowserRepository } from "@/lib/storage";
import type { AiSettings, CampaignDetail, NpcCharacter } from "@/types";

const store = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
});

describe("game orchestration", () => {
  beforeEach(() => {
    store.clear();
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    });
  });

  it("lets GM @ an NPC and trigger an immediate NPC reply", async () => {
    const { repository, detail } = await setupRepositoryWithNpc();
    if (!detail) {
      throw new Error("missing detail");
    }
    let callIndex = 0;
    vi.stubGlobal("fetch", async () => {
      const count = callIndex;
      callIndex += 1;
      return jsonResponse({
        choices: [
          {
            message: {
              content: count === 0 ? "@守卫 请回答。" : "我听见了，会守住门口。",
            },
          },
        ],
      });
    });

    const updated = await playTurnStreaming(
      repository,
      detail,
      "我观察门口。",
      gmOnlySettings(),
    );

    expect(updated.messages.some((message) => message.author === "NPC" && message.authorLabel === "守卫")).toBe(true);
  });

  it("records a pending player reply when GM mentions the player", async () => {
    const { repository, detail } = await setupRepositoryWithNpc();
    if (!detail) {
      throw new Error("missing detail");
    }
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ choices: [{ message: { content: "@玩家 你现在怎么做？" } }] }),
    );

    const updated = await playTurnStreaming(
      repository,
      detail,
      "我等待 GM。",
      gmOnlySettings(),
    );

    expect(updated.messages.some((message) => message.author === "system" && message.content.includes("GM 指定玩家回复"))).toBe(true);
    expect(updated.events.some((event) => event.eventType === "gm_player_mention")).toBe(true);
  });

  it("allows player private chat targeting a real NPC", async () => {
    const { repository, detail } = await setupRepositoryWithNpc();
    if (!detail) {
      throw new Error("missing detail");
    }

    const updated = await playTurnStreaming(
      repository,
      detail,
      "@守卫 我低声询问发生了什么。",
      defaultAiSettings,
    );

    expect(updated.events[0].eventType).toBe("private_chat_attempt");
    expect(updated.messages.some((message) => message.author === "NPC" && message.authorLabel === "守卫")).toBe(true);
  });

  it("keeps default RulesJudge output private and passes it to GM", async () => {
    const { repository, detail } = await setupRepositoryWithNpc();
    const cleanDetail = { ...detail, npcs: [] };
    const requests: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      return jsonResponse({
        choices: [
          {
            message: {
              content: requests.length === 1 ? "需要判定：观察。" : "你发现信封边缘有盐渍。",
            },
          },
        ],
      });
    });

    const updated = await playTurnStreaming(
      repository,
      cleanDetail,
      "我检查信封。",
      gmAndRulesSettings(),
    );

    expect(updated.messages.some((message) => message.author === "RulesJudge")).toBe(false);
    expect(updated.events.some((event) => event.eventType === "rules_judge_private")).toBe(true);
    expect(JSON.stringify(requests[1])).toContain("规则裁判建议");
    expect(JSON.stringify(requests[1])).toContain("需要判定");
  });

  it("publishes RulesJudge output when the player explicitly targets it", async () => {
    const { repository, detail } = await setupRepositoryWithNpc();

    const updated = await playTurnStreaming(
      repository,
      { ...detail, npcs: [] },
      "@RulesJudge 这需要判定吗？",
      defaultAiSettings,
    );

    expect(updated.messages.some((message) => message.author === "RulesJudge")).toBe(true);
    expect(updated.events.some((event) => event.eventType === "rules_judge_private")).toBe(false);
  });
});

async function setupRepositoryWithNpc(): Promise<{
  repository: BrowserRepository;
  detail: CampaignDetail;
}> {
  const repository = new BrowserRepository();
  await repository.init();
  const detail = await bootstrapCampaign(repository, {
    title: "测试战役",
    premise: "测试开局",
    rulesetId: "light-rules-v1",
    characterConcept: "测试角色",
  });
  const npc: NpcCharacter = {
    ...createEmptyCharacter("light-rules-v1", "港口守卫"),
    id: "npc_guard",
    name: "守卫",
    campaignId: detail.campaign.id,
    kind: "npc",
    isActive: true,
    createdBy: "GM",
  };
  await repository.saveNpcCharacter(npc);
  const updated = await repository.getCampaignDetail(detail.campaign.id);
  if (!updated) {
    throw new Error("missing detail");
  }
  return { repository, detail: updated };
}

function gmOnlySettings(): AiSettings {
  const settings = normalizeAiSettings({
    ...defaultAiSettings,
    providers: [{ ...defaultAiSettings.providers[0], apiKey: "test-key" }],
  });
  return {
    ...settings,
    agents: settings.agents.map((agent) => ({ ...agent, enabled: agent.role === "GM" })),
  };
}

function gmAndRulesSettings(): AiSettings {
  const settings = normalizeAiSettings({
    ...defaultAiSettings,
    providers: [{ ...defaultAiSettings.providers[0], apiKey: "test-key" }],
  });
  return {
    ...settings,
    agents: settings.agents.map((agent) => ({
      ...agent,
      enabled: agent.role === "GM" || agent.role === "RulesJudge",
    })),
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
