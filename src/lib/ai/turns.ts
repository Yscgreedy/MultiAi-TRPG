import type { AiAgentConfig, AiSettings, CampaignDetail, CharacterCard, NpcCharacter } from "@/types";
import { getRuleset, normalizeGeneratedCharacter, type CharacterSeedInput } from "@/lib/rulesets";
import type { AiTurnInput, AiTurnOutput, PrivateChatTarget } from "./types";
import { buildAgentMessages, recentMessages } from "./prompts";
import { buildToolsForTurn, executeAiTool } from "./tools";
import { findProvider, resolveModel } from "./settings";
import { parseJsonObject, postChatCompletion, postJsonModeChatCompletion, readChatCompletionResponse, readChatCompletionStream, shouldReportToolSupportError } from "./chat";

export async function runAiAgentTurn(
  agent: AiAgentConfig,
  input: AiTurnInput,
): Promise<AiTurnOutput> {
  const provider = findProvider(input.settings, agent.providerId);
  const model = resolveModel(provider, agent.model);

  if (!provider.apiKey.trim()) {
    return {
      role: agent.role,
      label: agent.label,
      content: `[${provider.name} 未配置 API Key] ${agent.label} 暂以离线模式回应：已记录“${input.playerAction}”，请在设置中填入 Provider API Key 后启用真实 AI。`,
    };
  }

  const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const tools = buildToolsForTurn(agent, input);
  const messages = buildAgentMessages(agent, input);
  let response = await postChatCompletion(endpoint, provider.apiKey, {
    model,
    messages,
    temperature: agent.role === "RulesJudge" ? 0.3 : 0.8,
    stream: false,
    ...(tools.length ? { tools, tool_choice: "auto" } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (tools.length && shouldReportToolSupportError(errorText)) {
      throw new Error(
        `${provider.name} 不支持 OpenAI tools/tool_calls：${errorText}`,
      );
    }
    throw new Error(`${agent.label} 调用失败：${response.status} ${errorText}`);
  }

  let data = await readChatCompletionResponse(response);
  for (let index = 0; index < 4 && data.toolCalls.length; index += 1) {
    messages.push({
      role: "assistant",
      content: data.content,
      ...(data.reasoningContent
        ? { reasoning_content: data.reasoningContent }
        : {}),
      tool_calls: data.toolCalls,
    });
    for (const toolCall of data.toolCalls) {
      const result = await executeAiTool(toolCall, input);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
    response = await postChatCompletion(endpoint, provider.apiKey, {
      model,
      messages,
      temperature: agent.role === "RulesJudge" ? 0.3 : 0.8,
      stream: false,
      tools,
      tool_choice: "auto",
    });
    if (!response.ok) {
      throw new Error(
        `${agent.label} 工具调用后生成回复失败：${response.status} ${await response.text()}`,
      );
    }
    data = await readChatCompletionResponse(response);
  }
  if (data.toolCalls.length) {
    throw new Error(`${agent.label} 工具调用超过最大轮数。`);
  }
  const content = data.content.trim();

  return {
    role: agent.role,
    label: agent.label,
    content,
  };
}

export async function runAiAgentTurnStreaming(
  agent: AiAgentConfig,
  input: AiTurnInput,
  onToken: (token: string) => void,
): Promise<AiTurnOutput> {
  if (input.toolRuntime) {
    const output = await runAiAgentTurn(agent, input);
    if (output.content) {
      onToken(output.content);
    }
    return output;
  }

  const provider = findProvider(input.settings, agent.providerId);
  const model = resolveModel(provider, agent.model);

  if (!provider.apiKey.trim()) {
    const content = `[${provider.name} 未配置 API Key] ${agent.label} 暂以离线模式回应：已记录“${input.playerAction}”，请在设置中填入 Provider API Key 后启用真实 AI。`;
    onToken(content);
    return {
      role: agent.role,
      label: agent.label,
      content,
    };
  }

  const response = await fetch(
    `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: buildAgentMessages(agent, input),
        temperature: agent.role === "RulesJudge" ? 0.3 : 0.8,
        stream: true,
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${agent.label} 调用失败：${response.status} ${errorText}`);
  }
  if (!response.body) {
    throw new Error(`${agent.label} 没有返回流式内容。`);
  }

  let content = "";
  for await (const token of readChatCompletionStream(response.body)) {
    content += token;
    onToken(token);
  }

  return {
    role: agent.role,
    label: agent.label,
    content: content.trim(),
  };
}

export async function runMultiAgentTurn(
  input: AiTurnInput,
): Promise<AiTurnOutput[]> {
  const enabledAgents = getTurnAgents(input);
  const results: AiTurnOutput[] = [];

  for (const agent of enabledAgents) {
    const output = await runAiAgentTurn(agent, input);
    if (output.content.trim()) {
      results.push(output);
    }
  }

  return results;
}

export function getTurnAgents(input: AiTurnInput): AiAgentConfig[] {
  if (input.privateChat) {
    return privateChatAgents(input.settings.agents, input.privateChat.agent);
  }
  return [
    ...input.settings.agents.filter(
      (agent) =>
        agent.enabled &&
        agent.role !== "Companion" &&
        agent.role !== "RulesJudge" &&
        agent.role !== "Archivist",
    ),
    ...npcTurnAgents(input.detail.npcs ?? [], input.settings),
  ];
}

export function getArchivistAgent(
  input: AiTurnInput,
): AiAgentConfig | undefined {
  if (input.privateChat) {
    return undefined;
  }
  return input.settings.agents.find(
    (agent) => agent.role === "Archivist" && agent.enabled,
  );
}

function npcTurnAgents(
  npcs: NpcCharacter[],
  settings: AiSettings,
): AiAgentConfig[] {
  return npcs
    .filter((npc) => npc.isActive)
    .map((npc) => ({
      role: "Companion",
      label: npc.name,
      providerId: settings.defaultProviderId,
      enabled: true,
      systemPrompt: "",
    }));
}

function privateChatAgents(
  agents: AiAgentConfig[],
  targetAgent: AiAgentConfig,
): AiAgentConfig[] {
  const gm = agents.find((agent) => agent.role === "GM" && agent.enabled);
  const target =
    agents.find(
      (agent) =>
        agent.role === targetAgent.role &&
        agent.label === targetAgent.label &&
        agent.enabled,
    ) ?? (targetAgent.enabled ? targetAgent : undefined);
  const participants = [gm, target].filter((agent): agent is AiAgentConfig =>
    Boolean(agent),
  );
  return participants.filter(
    (agent, index, list) =>
      list.findIndex((item) => item.role === agent.role) === index,
  );
}

export function resolvePrivateChatTarget(
  action: string,
  settings: AiSettings,
  npcs: NpcCharacter[] = [],
): PrivateChatTarget | undefined {
  const match = action.trim().match(/^@([^\s，,：:]+)\s*(.*)$/);
  if (!match) {
    return undefined;
  }

  const raw = match[1];
  const npc = npcs.find((item) => item.name === raw || item.id === raw);
  if (npc) {
    return {
      raw,
      agent: {
        role: "Companion",
        label: npc.name,
        providerId: settings.defaultProviderId,
        enabled: true,
        systemPrompt: "",
      },
    };
  }
  const agent = settings.agents
    .filter((item) => item.enabled)
    .find((item) => item.label === raw || item.role === raw);
  if (!agent) {
    throw new Error(
      `「${raw}」不是当前可交流对象。可用对象：${communicableNames(settings, npcs).join("、")}`,
    );
  }

  return { raw, agent };
}

function communicableNames(
  settings: AiSettings,
  npcs: NpcCharacter[] = [],
): string[] {
  return [
    ...settings.agents
      .filter((agent) => agent.enabled)
      .map((agent) => agent.label),
    ...npcs.map((npc) => npc.name),
  ];
}

export async function generateCharacterWithAi(
  settings: AiSettings,
  rulesetId: string,
  seed: CharacterSeedInput,
  characterType = "通用",
): Promise<CharacterCard> {
  const provider = findProvider(settings, settings.defaultProviderId);
  const model = resolveModel(provider);

  if (!provider.apiKey.trim()) {
    return normalizeGeneratedCharacter(
      {
        name: seed.concept ? `${seed.concept}的主角` : "离线生成角色",
        concept: seed.concept || "被命运推上舞台的普通人",
        background: `这是一个离线草案。职业倾向：${seed.profession || "未指定"}。`,
        notes: `调性：${seed.tone || "未指定"}。配置 API Key 后可生成更细致的角色。`,
      },
      rulesetId,
      characterType,
    );
  }

  const ruleset = getRuleset(rulesetId);
  const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const requestBody = {
    model,
    messages: [
      {
        role: "system",
        content: "你只输出可解析 JSON，不要 Markdown，不要解释。",
      },
      {
        role: "user",
        content: ruleset.buildCharacterPrompt(seed),
      },
    ],
    temperature: 0.8,
    response_format: { type: "json_object" as const },
  };
  const response = await postJsonModeChatCompletion(
    endpoint,
    provider.apiKey,
    requestBody,
    "角色卡生成失败",
  );

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("角色卡生成没有返回内容。");
  }

  return normalizeGeneratedCharacter(
    extractGeneratedCharacter(parseJsonObject(content)),
    rulesetId,
    characterType,
  );
}

export async function generateProxyActionOptions(
  settings: AiSettings,
  detail: CampaignDetail,
): Promise<string[]> {
  const provider = findProvider(settings, settings.defaultProviderId);
  const model = resolveModel(provider);
  const prompt = [
    "你是单人跑团的玩家代理，只负责给真人玩家提出可选行动，不要推进剧情。",
    `战役：${detail.campaign.title}`,
    `摘要：${detail.campaign.summary}`,
    `世界状态：${detail.campaign.worldState}`,
    `角色：${detail.character?.name ?? "未绑定角色"} - ${detail.character?.concept ?? ""}`,
    `最近消息：${recentMessages(detail.messages).join("\n") || "暂无"}`,
    '请输出 4 个中文行动选项。只返回 JSON：{"options":["..."]}。',
  ].join("\n");

  if (!provider.apiKey.trim()) {
    return [
      "我先观察附近最不寻常的细节。",
      "我向最近的 NPC 询问这里发生过什么。",
      "我检查随身物品，寻找可用线索。",
      "我谨慎后退，重新评估风险。",
    ];
  }

  const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const requestBody = {
    model,
    messages: [
      {
        role: "system",
        content: "你只输出可解析 JSON，不要 Markdown，不要解释。",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.7,
    response_format: { type: "json_object" as const },
  };
  const response = await postJsonModeChatCompletion(
    endpoint,
    provider.apiKey,
    requestBody,
    "代理选项生成失败",
  );

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("代理选项生成没有返回内容。");
  }

  return normalizeProxyOptions(parseJsonObject(content));
}

function normalizeProxyOptions(raw: unknown): string[] {
  const value = raw as { options?: unknown };
  const options = Array.isArray(value.options) ? value.options : [];
  return options
    .map((option) => (typeof option === "string" ? option.trim() : ""))
    .filter(Boolean)
    .slice(0, 4);
}

function extractGeneratedCharacter(raw: unknown): unknown {
  if (Array.isArray(raw)) {
    return raw[0] ?? {};
  }
  if (typeof raw !== "object" || !raw) {
    return raw;
  }
  const record = raw as Record<string, unknown>;
  return (
    record.character ??
    record.card ??
    record.characterCard ??
    record.data ??
    raw
  );
}
