import { describe, expect, it, vi } from "vitest";

import {
  buildAgentMessages,
  defaultAiSettings,
  generateCharacterWithAi,
  normalizeAiSettings,
  runAiAgentTurn,
} from "@/lib/ai";
import { createEmptyCharacter } from "@/lib/rulesets";
import type { AiSettings, CampaignDetail, NpcCharacter } from "@/types";

const detail: CampaignDetail = {
  campaign: {
    id: "camp_1",
    title: "雾港",
    rulesetId: "light-rules-v1",
    status: "active",
    premise: "灯塔求救信",
    summary: "玩家抵达港口。",
    worldState: "雾很重。",
    activeCharacterId: "char_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  session: {
    id: "sess_1",
    campaignId: "camp_1",
    title: "第一幕",
    checkpoint: "港口",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  character: createEmptyCharacter("light-rules-v1", "调查员"),
  npcs: [],
  messages: [
    {
      id: "msg_1",
      campaignId: "camp_1",
      sessionId: "sess_1",
      author: "player",
      content: "我查看信件。",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  events: [],
};

describe("ai prompt builder", () => {
  it("includes role boundaries and current game context", () => {
    const messages = buildAgentMessages(defaultAiSettings.agents[0], {
      detail,
      playerAction: "我去旧灯塔。",
      settings: defaultAiSettings,
    });

    expect(messages[0].content).toContain("主持人");
    expect(messages[1].content).toContain("我去旧灯塔");
    expect(messages[1].content).toContain("玩家抵达港口");
  });

  it("keeps non-GM agents out of narrator prompts", () => {
    const rulesJudge = defaultAiSettings.agents.find(
      (agent) => agent.role === "RulesJudge",
    );
    if (!rulesJudge) {
      throw new Error("missing rules judge");
    }

    const messages = buildAgentMessages(rulesJudge, {
      detail,
      playerAction: "我检查信件。",
      settings: defaultAiSettings,
    });

    expect(messages[0].content).toContain("只有 GM 可以推进场景");
    expect(messages[1].content).toContain("只做规则裁判");
    expect(messages[1].content).not.toContain("你是多 AI 单人跑团的主持人");
  });

  it("allows archivist to return empty content when not participating", () => {
    const archivist = defaultAiSettings.agents.find(
      (agent) => agent.role === "Archivist",
    );
    if (!archivist) {
      throw new Error("missing archivist");
    }

    const messages = buildAgentMessages(archivist, {
      detail,
      playerAction: "我检查信件。",
      settings: defaultAiSettings,
    });

    expect(messages[0].content).toContain("直接返回空内容");
    expect(messages[1].content).toContain("如果本轮没有新的稳定事实需要记录，返回空内容");
  });

  it("migrates legacy single-provider settings", () => {
    const settings = normalizeAiSettings({
      baseUrl: "http://localhost:9986/v1",
      apiKey: "test-key",
      defaultModel: "local-model",
      agents: [{ ...defaultAiSettings.agents[0], model: "gm-model" }],
    });

    expect(settings.providers).toHaveLength(1);
    expect(settings.providers[0].baseUrl).toBe("http://localhost:9986/v1");
    expect(settings.providers[0].models).toContain("local-model");
    expect(settings.agents[0].providerId).toBe(settings.defaultProviderId);
    expect(settings.agents[0].model).toBe("gm-model");
  });

  it("sends GM tools and feeds tool results back to the model", async () => {
    const requests: unknown[] = [];
    const player = createEmptyCharacter("light-rules-v1", "调查员");
    const npc = createNpc("守卫");
    const settings = withApiKey();
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      if (requests.length === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "roll_dice",
                      arguments: JSON.stringify({ sides: 6, count: 2 }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      return jsonResponse({ choices: [{ message: { content: "骰子已经落定。" } }] });
    });

    const output = await runAiAgentTurn(defaultAiSettings.agents[0], {
      detail: { ...detail, character: player, npcs: [npc] },
      playerAction: "我撬门。",
      settings,
      toolRuntime: {
        mode: "gm",
        getPlayerCharacter: () => player,
        savePlayerCharacter: async () => {},
        listNpcs: () => [npc],
        getNpc: () => npc,
        saveNpc: async () => {},
        createNpc: async () => {},
      },
    });

    expect(output.content).toBe("骰子已经落定。");
    expect((requests[0] as { tools: Array<{ function: { name: string } }> }).tools.map((tool) => tool.function.name)).toContain("roll_dice");
    expect(JSON.stringify(requests[1])).toContain("2d6");
  });

  it("only exposes self card inspection for NPC turns", async () => {
    const requests: unknown[] = [];
    const npc = createNpc("守卫");
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return jsonResponse({ choices: [{ message: { content: "我检查了自己的状态。" } }] });
    });

    await runAiAgentTurn(
      { role: "Companion", label: npc.name, providerId: "openai", enabled: true, systemPrompt: "" },
      {
        detail: { ...detail, npcs: [npc] },
        playerAction: "GM 指定守卫回应。",
        settings: withApiKey(),
        npc,
        toolRuntime: {
          mode: "npc",
          getPlayerCharacter: () => detail.character,
          savePlayerCharacter: async () => {},
          listNpcs: () => [npc],
          getNpc: () => npc,
          saveNpc: async () => {},
          createNpc: async () => {},
        },
      },
    );

    const tools = (requests[0] as { tools: Array<{ function: { name: string } }> }).tools;
    expect(tools.map((tool) => tool.function.name)).toEqual(["get_character_card"]);
  });

  it("normalizes wrapped and object-list character generation output", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content:
                "```json\n{\"character\":{\"name\":\"林岚\",\"concept\":\"调查员\",\"attributes\":{\"mind\":\"4\"},\"skills\":[{\"name\":\"神秘学\",\"value\":\"2\"}],\"inventory\":[{\"name\":\"录音笔\"}],\"bonds\":[{\"name\":\"报社编辑\"}],\"conditions\":[],\"notes\":\"可靠\"}}\n```",
            },
          },
        ],
      }),
    );

    const character = await generateCharacterWithAi(withApiKey(), "light-rules-v1", {
      concept: "调查员",
      tone: "悬疑",
      profession: "记者",
    });

    expect(character.name).toBe("林岚");
    expect(character.attributes.mind).toBe(4);
    expect(character.skills.神秘学).toBe(2);
    expect(character.inventory).toEqual(["录音笔"]);
  });
});

function withApiKey(): AiSettings {
  return normalizeAiSettings({
    ...defaultAiSettings,
    providers: [{ ...defaultAiSettings.providers[0], apiKey: "test-key" }],
  });
}

function createNpc(name: string): NpcCharacter {
  return {
    ...createEmptyCharacter("light-rules-v1", "港口守卫"),
    id: `npc_${name}`,
    name,
    campaignId: detail.campaign.id,
    kind: "npc",
    isActive: true,
    createdBy: "GM",
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
