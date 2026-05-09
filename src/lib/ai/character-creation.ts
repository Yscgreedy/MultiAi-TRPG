import type { AiSettings, CharacterCard, CharacterCreationMessage, CharacterCreationSession } from "@/types";
import { getCharacterSheetTemplate, getRuleset, normalizeGeneratedCharacter, type CharacterSeedInput } from "@/lib/rulesets";
import { createId, nowIso } from "@/lib/id";
import type { CharacterCreationRunContext, ChatMessage } from "./types";
import { findProvider, resolveModel } from "./settings";
import { postChatCompletion, postJsonModeChatCompletion, parseJsonObject, readChatCompletionResponse, readChatCompletionStream } from "./chat";
import { buildCharacterCreationTools, executeCharacterCreationTool } from "./tools";
import { createBlankCharacterCreationDraft } from "./character-draft";
import { formatCharacterForPrompt } from "./prompts";

export function createCharacterCreationSession(
  rulesetId: string,
  characterType = "通用",
  seed: CharacterSeedInput = { concept: "", tone: "", profession: "" },
  rulesContext = "",
): CharacterCreationSession {
  const timestamp = nowIso();
  const draft = createBlankCharacterCreationDraft(rulesetId, characterType, seed);
  return {
    id: createId("chargen"),
    rulesetId,
    characterType: draft.characterType ?? characterType,
    draft,
    messages: [
      {
        id: createId("chargenmsg"),
        author: "GM",
        content:
          "我们先聊角色。你可以描述想扮演什么样的人、来自哪里、擅长什么、害怕什么；数值和点数我会按规则自动处理。",
        createdAt: timestamp,
      },
    ],
    toolResults: [],
    status: "chatting",
    rulesContext,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function runCharacterCreationGmTurn(
  settings: AiSettings,
  session: CharacterCreationSession,
  playerReply: string,
  rulesContext = session.rulesContext ?? "",
  onToken?: (token: string) => void,
): Promise<CharacterCreationSession> {
  const reply = playerReply.trim();
  if (!reply) {
    throw new Error("请输入要告诉制卡 GM 的内容。");
  }

  const timestamp = nowIso();
  const playerMessage: CharacterCreationMessage = {
    id: createId("chargenmsg"),
    author: "player",
    content: reply,
    createdAt: timestamp,
  };
  const baseSession: CharacterCreationSession = {
    ...session,
    rulesContext,
    messages: [...session.messages, playerMessage],
    status: "chatting",
    updatedAt: timestamp,
  };
  const provider = findProvider(settings, settings.defaultProviderId);

  if (!provider.apiKey.trim()) {
    return {
      ...baseSession,
      draft: normalizeGeneratedCharacter(
        {
          ...baseSession.draft,
          concept:
            baseSession.draft.concept === "待确定"
              ? reply.slice(0, 40)
              : baseSession.draft.concept,
          background: [baseSession.draft.background, `玩家补充：${reply}`]
            .filter(Boolean)
            .join("\n"),
        },
        baseSession.rulesetId,
        baseSession.characterType,
      ),
      messages: [
        ...baseSession.messages,
        {
          id: createId("chargenmsg"),
          author: "GM",
          content: emitCharacterCreationTokens(
            `[${provider.name} 未配置 API Key] 我已记录这条设定。继续补充角色的动机、弱点或关系；最终生成时我会用当前模板自动完成数值。`,
            onToken,
          ),
          createdAt: nowIso(),
        },
      ],
      updatedAt: nowIso(),
    };
  }

  const context: CharacterCreationRunContext = {
    draft: baseSession.draft,
    toolResults: [...baseSession.toolResults],
  };
  const model = resolveModel(provider);
  const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const tools = buildCharacterCreationTools();
  const messages = buildCharacterCreationMessages(baseSession);
  let response = await postChatCompletion(endpoint, provider.apiKey, {
    model,
    messages,
    temperature: 0.75,
    stream: false,
    tools,
    tool_choice: "auto",
  });
  if (!response.ok) {
    throw new Error(`制卡 GM 调用失败：${response.status} ${await response.text()}`);
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
      const result = await executeCharacterCreationTool(
        toolCall,
        baseSession,
        context,
      );
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
    response = await postChatCompletion(endpoint, provider.apiKey, {
      model,
      messages,
      temperature: 0.75,
      stream: false,
      tools,
      tool_choice: "auto",
    });
    if (!response.ok) {
      throw new Error(
        `制卡 GM 工具调用后生成回复失败：${response.status} ${await response.text()}`,
      );
    }
    data = await readChatCompletionResponse(response);
  }
  if (data.toolCalls.length) {
    throw new Error("制卡 GM 工具调用超过最大轮数。");
  }
  const streamedContent = onToken
    ? await streamCharacterCreationReply(endpoint, provider.apiKey, model, messages, onToken)
    : "";
  const content = streamedContent || data.content.trim();

  return {
    ...baseSession,
    draft: context.draft,
    toolResults: context.toolResults,
    messages: [
      ...baseSession.messages,
      {
        id: createId("chargenmsg"),
        author: "GM",
        content,
        createdAt: nowIso(),
      },
    ],
    status: "ready",
    updatedAt: nowIso(),
  };
}

export async function finalizeCharacterCreation(
  settings: AiSettings,
  session: CharacterCreationSession,
): Promise<CharacterCard> {
  const provider = findProvider(settings, settings.defaultProviderId);
  if (!provider.apiKey.trim()) {
    return normalizeGeneratedCharacter(
      {
        ...session.draft,
        notes: `${session.draft.notes}\n离线制卡：已根据当前草稿和模板自动补齐数值。`,
      },
      session.rulesetId,
      session.characterType,
    );
  }

  const model = resolveModel(provider);
  const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await postJsonModeChatCompletion(
    endpoint,
    provider.apiKey,
    {
      model,
      messages: buildCharacterFinalizationMessages(session),
      temperature: 0.45,
      response_format: { type: "json_object" as const },
    },
    "制卡最终生成失败",
  );
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("制卡最终生成没有返回内容。");
  }
  return normalizeGeneratedCharacter(
    extractGeneratedCharacter(parseJsonObject(content)),
    session.rulesetId,
    session.characterType,
  );
}

function buildCharacterCreationMessages(
  session: CharacterCreationSession,
): ChatMessage[] {
  const template = getCharacterSheetTemplate(session.characterType);
  const ruleset = getRuleset(session.rulesetId);
  const conversation = session.messages
    .map((message) => `${message.author}: ${message.content}`)
    .join("\n");
  return [
    {
      role: "system",
      content: [
        "你是玩家角色卡的制卡 GM，不是正式战役 GM。",
        "你的目标是通过简短中文交流，帮助玩家做出更可玩的一张玩家角色卡。",
        "玩家不需要手动分配点数；属性、技能、点数经济和随机分点由你按规则处理。",
        "如果当前规则书或角色创建规则要求随机分点、随机背景表或骰点来源，你必须调用 roll_dice 工具取得随机结果。",
        "你只能通过制卡工具读取、更新或重置当前制卡草稿；不要创建或修改 NPC，不要写入正式战役记录。",
        "每轮回复要自然、简洁，并在需要时提 1-2 个能推进制卡的具体问题。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `规则书：${ruleset.name}（${session.rulesetId}）`,
        `规则说明：${ruleset.description}`,
        `判定规则：${ruleset.diceExpression}`,
        `角色卡模板 JSON：${JSON.stringify(template)}`,
        session.rulesContext ? `规则书 RAG 片段：\n${session.rulesContext}` : "",
        `当前制卡草稿：${formatCharacterForPrompt(session.draft)}`,
        session.toolResults.length
          ? `已发生工具结果：${JSON.stringify(session.toolResults)}`
          : "",
        `制卡对话：\n${conversation}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

function buildCharacterFinalizationMessages(
  session: CharacterCreationSession,
): ChatMessage[] {
  const template = getCharacterSheetTemplate(session.characterType);
  const conversation = session.messages
    .map((message) => `${message.author}: ${message.content}`)
    .join("\n");
  return [
    {
      role: "system",
      content:
        "你只输出可解析 JSON，不要 Markdown，不要解释。输出一张最终玩家角色卡。",
    },
    {
      role: "user",
      content: [
        "根据制卡对话、当前草稿、规则书片段、角色卡模板和工具结果，生成最终玩家角色卡 JSON。",
        "字段必须包含：name, concept, background, attributes, skills, inventory, bonds, conditions, notes。",
        "不要要求玩家手动分点；如果已有骰点或随机结果，把它们体现在 notes 或数值分配依据中。",
        `规则书：${session.rulesetId}`,
        `角色卡类型：${session.characterType}`,
        `角色卡模板 JSON：${JSON.stringify(template)}`,
        session.rulesContext ? `规则书 RAG 片段：\n${session.rulesContext}` : "",
        `当前草稿：${formatCharacterForPrompt(session.draft)}`,
        session.toolResults.length
          ? `工具结果：${JSON.stringify(session.toolResults)}`
          : "",
        `对话：\n${conversation}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

async function streamCharacterCreationReply(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  onToken: (token: string) => void,
): Promise<string> {
  const response = await postChatCompletion(endpoint, apiKey, {
    model,
    messages: [
      ...messages,
      {
        role: "user",
        content:
          "请基于以上制卡上下文、当前草稿和工具结果，输出本轮给玩家看的制卡 GM 回复。可以使用 Markdown。",
      },
    ],
    temperature: 0.75,
    stream: true,
  });
  if (!response.ok) {
    throw new Error(`制卡 GM 流式回复失败：${response.status} ${await response.text()}`);
  }
  if (!response.body) {
    throw new Error("制卡 GM 流式回复没有返回响应体。");
  }
  let content = "";
  for await (const token of readChatCompletionStream(response.body)) {
    content += token;
    onToken(token);
  }
  return content.trim();
}

function emitCharacterCreationTokens(
  content: string,
  onToken?: (token: string) => void,
): string {
  if (onToken) {
    for (const token of content.match(/.{1,8}/gs) ?? [content]) {
      onToken(token);
    }
  }
  return content;
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
