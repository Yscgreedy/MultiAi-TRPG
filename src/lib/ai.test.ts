import { describe, expect, it, vi } from "vitest";

import {
  buildAgentMessages,
  createCharacterCreationSession,
  defaultAiSettings,
  finalizeCharacterCreation,
  generateCharacterWithAi,
  generateProxyActionOptions,
  normalizeAiSettings,
  runAiAgentTurn,
  runAiAgentTurnStreaming,
  runCharacterCreationGmTurn,
  testProviderConnection,
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
                reasoning_content: "需要先掷骰判断撬门结果。",
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
    expect(JSON.stringify(requests[1])).toContain("需要先掷骰判断撬门结果。");
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

  it("retries JSON-mode character generation against compatible providers", async () => {
    const requests: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      if ("response_format" in body) {
        return new Response("unknown parameter: response_format", { status: 400 });
      }
      return jsonResponse({
        choices: [
          {
            message: {
              content: "{\"name\":\"林岚\",\"concept\":\"调查员\"}",
            },
          },
        ],
      });
    });

    const character = await generateCharacterWithAi(withApiKey(), "light-rules-v1", {
      concept: "调查员",
      tone: "悬疑",
      profession: "记者",
    });

    expect(character.name).toBe("林岚");
    expect(requests).toHaveLength(2);
    expect(requests[0]).toHaveProperty("response_format");
    expect(requests[1]).not.toHaveProperty("response_format");
  });

  it("retries JSON-mode proxy options against compatible providers", async () => {
    const requests: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      if ("response_format" in body) {
        return new Response("json_object is unsupported", { status: 400 });
      }
      return jsonResponse({
        choices: [
          {
            message: {
              content: "{\"options\":[\"观察雾气\",\"询问守卫\"]}",
            },
          },
        ],
      });
    });

    const options = await generateProxyActionOptions(withApiKey(), detail);

    expect(options).toEqual(["观察雾气", "询问守卫"]);
    expect(requests).toHaveLength(2);
    expect(requests[1]).not.toHaveProperty("response_format");
  });

  it("builds character creation GM prompts with RAG, template, draft, and player reply", async () => {
    const requests: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      return jsonResponse({ choices: [{ message: { content: "我会先记录这个调查员概念。" } }] });
    });
    const session = createCharacterCreationSession(
      "light-rules-v1",
      "通用",
      { concept: "民俗调查员", tone: "悬疑", profession: "记者" },
      "RAG：角色创建时属性总和随机决定。",
    );

    const next = await runCharacterCreationGmTurn(
      withApiKey(),
      session,
      "我想要一个害怕深海但很会观察的人。",
    );

    const firstRequest = JSON.stringify(requests[0]);
    expect(firstRequest).toContain("RAG：角色创建时属性总和随机决定。");
    expect(firstRequest).toContain("角色卡模板 JSON");
    expect(firstRequest).toContain("民俗调查员");
    expect(firstRequest).toContain("害怕深海");
    expect(next.messages[next.messages.length - 1]?.content).toContain("调查员");
  });

  it("starts character creation with a blank draft instead of default character flavor", () => {
    const session = createCharacterCreationSession("light-rules-v1", "通用");

    expect(session.draft.name).toBe("待定角色");
    expect(session.draft.concept).toBe("待确定");
    expect(session.draft.background).toBe("");
    expect(session.draft.inventory).toEqual([]);
    expect(session.draft.bonds).toEqual([]);
    expect(session.draft.notes).not.toContain("民俗调查员");
    expect(session.draft.notes).not.toContain("调查员");
  });

  it("lets the character creation GM roll dice and replays tool results", async () => {
    const requests: unknown[] = [];
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
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
                    id: "roll_1",
                    type: "function",
                    function: {
                      name: "roll_dice",
                      arguments: JSON.stringify({ count: 2, sides: 6 }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      return jsonResponse({ choices: [{ message: { content: "骰点会用于随机分点。" } }] });
    });
    const session = createCharacterCreationSession("light-rules-v1", "通用");

    const next = await runCharacterCreationGmTurn(withApiKey(), session, "请随机分点。");

    expect(next.toolResults[0].toolName).toBe("roll_dice");
    const replayedToolMessage = (
      requests[1] as { messages: Array<{ role: string; content: string }> }
    ).messages.find((message) => message.role === "tool");
    expect(replayedToolMessage?.content).toContain("\"expression\":\"2d6\"");
    expect(replayedToolMessage?.content).toContain("\"total\":8");
    expect(next.messages[next.messages.length - 1]?.content).toContain("随机分点");
    random.mockRestore();
  });

  it("normalizes character creation draft patches from tool calls", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.messages.length === 2) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "patch_1",
                    type: "function",
                    function: {
                      name: "update_creation_character_card",
                      arguments: JSON.stringify({
                        patch: {
                          name: "许望",
                          attributes: { body: 999 },
                          skills: { 观察: 99 },
                        },
                      }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      return jsonResponse({ choices: [{ message: { content: "草稿已更新。" } }] });
    });
    const session = createCharacterCreationSession("light-rules-v1", "通用");

    const next = await runCharacterCreationGmTurn(withApiKey(), session, "我想特别强壮。");

    expect(next.draft.name).toBe("许望");
    expect(next.draft.attributes.body).toBe(5);
    expect(next.draft.skills.观察).toBe(5);
  });

  it("finalizes character creation through JSON mode with compatible-provider retry", async () => {
    const requests: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      if ("response_format" in body) {
        return new Response("json_object is unsupported", { status: 400 });
      }
      return jsonResponse({
        choices: [
          {
            message: {
              content:
                "{\"character\":{\"name\":\"沈烛\",\"concept\":\"港口调查员\",\"attributes\":{\"mind\":4},\"skills\":{\"观察\":3}}}",
            },
          },
        ],
      });
    });
    const session = createCharacterCreationSession("light-rules-v1", "通用");

    const character = await finalizeCharacterCreation(withApiKey(), session);

    expect(character.name).toBe("沈烛");
    expect(character.skills.观察).toBe(3);
    expect(requests).toHaveLength(2);
    expect(requests[1]).not.toHaveProperty("response_format");
  });

  it("reports malformed streaming JSON instead of dropping it", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("data: {not-json}\n\n"));
            controller.close();
          },
        }),
        { status: 200 },
      ),
    );

    await expect(
      runAiAgentTurnStreaming(
        defaultAiSettings.agents[0],
        {
          detail,
          playerAction: "我查看信件。",
          settings: withApiKey(),
        },
        () => {},
      ),
    ).rejects.toThrow("AI 流式响应不是有效 JSON");
  });

  it("tests provider connectivity with the provider default model", async () => {
    const requests: Array<{ url: string; body: unknown; authorization?: string }> = [];
    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_123);
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      requests.push({
        url,
        body: JSON.parse(String(init.body)),
        authorization: new Headers(init.headers).get("authorization") ?? undefined,
      });
      return jsonResponse({ choices: [{ message: { content: "OK" } }] });
    });

    const result = await testProviderConnection({
      ...defaultAiSettings.providers[0],
      baseUrl: "http://localhost:11434/v1/",
      apiKey: "test-key",
      defaultModel: "qwen-test",
    });

    expect(result).toEqual({
      providerName: "OpenAI",
      model: "qwen-test",
      latencyMs: 123,
      content: "OK",
    });
    expect(requests[0].url).toBe("http://localhost:11434/v1/chat/completions");
    expect(requests[0].authorization).toBe("Bearer test-key");
    expect(requests[0].body).toMatchObject({
      model: "qwen-test",
      temperature: 0,
    });
    expect(JSON.stringify(requests[0].body)).toContain("只回复 OK");
    nowSpy.mockRestore();
  });

  it("reports provider connectivity test failures", async () => {
    vi.stubGlobal("fetch", async () => new Response("bad key", { status: 401 }));

    await expect(
      testProviderConnection({
        ...defaultAiSettings.providers[0],
        apiKey: "bad-key",
      }),
    ).rejects.toThrow("测试 OpenAI 失败：401 bad key");
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
