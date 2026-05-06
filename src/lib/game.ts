import {
  type AiToolExecutionResult,
  type AiToolRuntime,
  type AiTurnInput,
  type AiTurnOutput,
  defaultAiSettings,
  getArchivistAgent,
  getTurnAgents,
  normalizeAiSettings,
  resolvePrivateChatTarget,
  runAiAgentTurn,
  runAiAgentTurnStreaming,
  runMultiAgentTurn,
} from "@/lib/ai";
import { createId, nowIso } from "@/lib/id";
import { buildRulesRagContext } from "@/lib/rag";
import {
  createEmptyCharacter,
  normalizeGeneratedCharacter,
} from "@/lib/rulesets";
import type {
  AiSettings,
  CampaignDetail,
  CharacterCard,
  GameEvent,
  GameMessage,
  NpcCharacter,
} from "@/types";
import type { GameRepository } from "@/lib/storage";

export interface PlayTurnStreamHandlers {
  onMessageAppend?: (message: GameMessage) => void;
  onMessageDelta?: (messageId: string, token: string) => void;
}

export interface NewCampaignInput {
  title: string;
  premise: string;
  rulesetId: string;
  characterConcept: string;
}

export async function bootstrapCampaign(
  repository: GameRepository,
  input: NewCampaignInput,
): Promise<CampaignDetail> {
  const character = createEmptyCharacter(
    input.rulesetId,
    input.characterConcept,
  );
  return repository.createCampaign({
    title: input.title || "未命名战役",
    premise: input.premise || "一场尚未揭晓的单人冒险。",
    rulesetId: input.rulesetId,
    character,
  });
}

export async function saveGeneratedCharacter(
  repository: GameRepository,
  campaignId: string,
  raw: unknown,
  rulesetId: string,
): Promise<CharacterCard> {
  const character = normalizeGeneratedCharacter(raw, rulesetId);
  await repository.saveCharacter(campaignId, character);
  return character;
}

export async function playTurn(
  repository: GameRepository,
  detail: CampaignDetail,
  playerAction: string,
  settings: AiSettings,
): Promise<CampaignDetail> {
  const action = playerAction.trim();
  if (!action) {
    throw new Error("请输入玩家行动。");
  }
  const privateChat = resolvePrivateChatTarget(action, settings, detail.npcs);

  const playerMessage: GameMessage = {
    id: createId("msg"),
    campaignId: detail.campaign.id,
    sessionId: detail.session.id,
    author: "player",
    content: privateChat ? `私聊 @${privateChat.raw}：${action}` : action,
    createdAt: nowIso(),
  };
  await repository.appendMessage(playerMessage);

  const baseDetail: CampaignDetail = {
    ...detail,
    messages: [...detail.messages, playerMessage],
  };
  const rulesContext = await buildRulesRagContext(
    repository,
    settings,
    detail.campaign.rulesetId,
    action,
  );
  const hiddenRulesOutput = await runHiddenRulesJudgeTurn(
    baseDetail,
    action,
    settings,
    rulesContext,
  );
  const aiOutputs = await runMultiAgentTurn({
    detail: baseDetail,
    playerAction: action,
    settings,
    privateChat,
    hiddenRulesAdvice: hiddenRulesOutput?.content,
    rulesContext,
    toolRuntime: createToolRuntime(repository, baseDetail, "gm"),
  });

  const aiMessages: GameMessage[] = aiOutputs.map((output) => ({
    id: createId("msg"),
    campaignId: detail.campaign.id,
    sessionId: detail.session.id,
    author: output.role,
    content: output.content,
    createdAt: nowIso(),
  }));

  for (const message of aiMessages) {
    if (message.content.trim()) {
      await repository.appendMessage(message);
    }
  }

  // 记录员在每轮最后执行，可以看到本回合所有输出
  const archivistDetail: CampaignDetail = {
    ...baseDetail,
    messages: [...baseDetail.messages, ...aiMessages],
  };
  const archivistOutput = await runArchivistTurn(
    archivistDetail,
    action,
    settings,
    rulesContext,
  );
  if (archivistOutput) {
    const archivistMessage: GameMessage = {
      id: createId("msg"),
      campaignId: detail.campaign.id,
      sessionId: detail.session.id,
      author: archivistOutput.role,
      content: archivistOutput.content,
      createdAt: nowIso(),
    };
    if (archivistMessage.content.trim()) {
      await repository.appendMessage(archivistMessage);
      aiMessages.push(archivistMessage);
    }
  }

  const event: GameEvent = {
    id: createId("evt"),
    campaignId: detail.campaign.id,
    sessionId: detail.session.id,
    eventType: privateChat ? "private_chat_attempt" : "turn_completed",
    payload: {
      playerAction: action,
      agents: aiOutputs.map((output) => output.role),
      hiddenRulesJudge: hiddenRulesOutput
        ? {
            role: hiddenRulesOutput.role,
            label: hiddenRulesOutput.label,
            content: hiddenRulesOutput.content,
          }
        : undefined,
      privateChatTarget: privateChat
        ? {
            raw: privateChat.raw,
            role: privateChat.agent.role,
            label: privateChat.agent.label,
          }
        : undefined,
      rulesContext: rulesContext || undefined,
    },
    createdAt: nowIso(),
  };
  await repository.appendEvent(event);

  const snapshot = summarizeSnapshot(baseDetail, aiMessages);
  await repository.updateCampaignSnapshot(detail.campaign.id, snapshot);

  const updated = await repository.getCampaignDetail(detail.campaign.id);
  if (!updated) {
    throw new Error("回合已写入，但重新读取战役失败。");
  }

  return updated;
}

export async function playTurnStreaming(
  repository: GameRepository,
  detail: CampaignDetail,
  playerAction: string,
  settings: AiSettings,
  handlers: PlayTurnStreamHandlers = {},
): Promise<CampaignDetail> {
  const action = playerAction.trim();
  if (!action) {
    throw new Error("请输入玩家行动。");
  }
  const privateChat = resolvePrivateChatTarget(action, settings, detail.npcs);

  const playerMessage: GameMessage = {
    id: createId("msg"),
    campaignId: detail.campaign.id,
    sessionId: detail.session.id,
    author: "player",
    content: privateChat ? `私聊 @${privateChat.raw}：${action}` : action,
    createdAt: nowIso(),
  };
  await repository.appendMessage(playerMessage);
  handlers.onMessageAppend?.(playerMessage);

  const baseDetail: CampaignDetail = {
    ...detail,
    messages: [...detail.messages, playerMessage],
  };
  const input = {
    detail: baseDetail,
    playerAction: action,
    settings,
    privateChat,
  };
  const aiMessages: GameMessage[] = [];
  const turnEvents: GameEvent[] = [];
  const toolResults: AiToolExecutionResult[] = [];
  const rulesContext = await buildRulesRagContext(
    repository,
    settings,
    detail.campaign.rulesetId,
    action,
  );
  const hiddenRulesOutput = await runHiddenRulesJudgeTurn(
    baseDetail,
    action,
    settings,
    rulesContext,
  );
  if (hiddenRulesOutput?.content.trim()) {
    turnEvents.push({
      id: createId("evt"),
      campaignId: detail.campaign.id,
      sessionId: detail.session.id,
      eventType: "rules_judge_private",
      payload: {
        label: hiddenRulesOutput.label,
        content: hiddenRulesOutput.content,
      },
      createdAt: nowIso(),
    });
  }

  for (const agent of getTurnAgents({
    ...input,
    hiddenRulesAdvice: hiddenRulesOutput?.content,
    rulesContext,
  })) {
    const agentNpc = findNpcForAgent(agent, baseDetail.npcs);
    const message: GameMessage = {
      id: createId("msg"),
      campaignId: detail.campaign.id,
      sessionId: detail.session.id,
      author: agentNpc ? "NPC" : agent.role,
      authorLabel: agentNpc?.name,
      actorId: agentNpc?.id,
      content: "",
      createdAt: nowIso(),
    };
    let messageAppended = false;
    let messageAppendPromise: Promise<void> = Promise.resolve();
    let content = "";
    const agentInput = {
      ...input,
      hiddenRulesAdvice: hiddenRulesOutput?.content,
      rulesContext,
      npc: agentNpc,
      toolRuntime:
        agent.role === "GM"
          ? createToolRuntime(
              repository,
              baseDetail,
              "gm",
              undefined,
              toolResults,
            )
          : agentNpc
            ? createToolRuntime(
                repository,
                baseDetail,
                "npc",
                agentNpc,
                toolResults,
              )
            : undefined,
    };
    const output = await runAiAgentTurnStreaming(agent, agentInput, (token) => {
      content += token;
      if (!messageAppended && content.trim()) {
        messageAppended = true;
        messageAppendPromise = repository.appendMessage(message);
        handlers.onMessageAppend?.(message);
      }
      if (!messageAppended) {
        return;
      }
      handlers.onMessageDelta?.(message.id, token);
    });
    const finalizedMessage = { ...message, content: output.content || content };
    if (finalizedMessage.content.trim()) {
      if (!messageAppended) {
        messageAppendPromise = repository.appendMessage(message);
        handlers.onMessageAppend?.(message);
      }
      await messageAppendPromise;
      await repository.updateMessageContent(
        message.id,
        finalizedMessage.content,
      );
      aiMessages.push(finalizedMessage);
      if (agent.role === "GM") {
        const triggeredMessages = await handleGmMentions(
          repository,
          baseDetail,
          finalizedMessage.content,
          settings,
          toolResults,
          handlers,
        );
        aiMessages.push(...triggeredMessages);
        for (const triggeredMessage of triggeredMessages) {
          if (triggeredMessage.author === "system") {
            turnEvents.push({
              id: createId("evt"),
              campaignId: detail.campaign.id,
              sessionId: detail.session.id,
              eventType: "gm_player_mention",
              payload: { message: triggeredMessage.content },
              createdAt: nowIso(),
            });
          }
        }
      }
    }
  }

  // 记录员在每轮最后执行，可以看到本回合所有输出
  {
    const archivistDetail: CampaignDetail = {
      ...baseDetail,
      messages: [...baseDetail.messages, ...aiMessages],
    };
    const archivistOutput = await runArchivistTurn(
      archivistDetail,
      action,
      settings,
      rulesContext,
    );
    if (archivistOutput) {
      const archivistMessage: GameMessage = {
        id: createId("msg"),
        campaignId: detail.campaign.id,
        sessionId: detail.session.id,
        author: archivistOutput.role,
        content: archivistOutput.content,
        createdAt: nowIso(),
      };
      if (archivistMessage.content.trim()) {
        await repository.appendMessage(archivistMessage);
        handlers.onMessageAppend?.(archivistMessage);
        aiMessages.push(archivistMessage);
      }
    }
  }

  const event: GameEvent = {
    id: createId("evt"),
    campaignId: detail.campaign.id,
    sessionId: detail.session.id,
    eventType: privateChat ? "private_chat_attempt" : "turn_completed",
    payload: {
      playerAction: action,
      agents: aiMessages.map((message) => message.author),
      streaming: true,
      hiddenRulesJudge: hiddenRulesOutput
        ? {
            role: hiddenRulesOutput.role,
            label: hiddenRulesOutput.label,
            content: hiddenRulesOutput.content,
          }
        : undefined,
      toolResults,
      privateChatTarget: privateChat
        ? {
            raw: privateChat.raw,
            role: privateChat.agent.role,
            label: privateChat.agent.label,
          }
        : undefined,
      rulesContext: rulesContext || undefined,
    },
    createdAt: nowIso(),
  };
  await repository.appendEvent(event);
  for (const turnEvent of turnEvents) {
    await repository.appendEvent(turnEvent);
  }

  const snapshot = summarizeSnapshot(baseDetail, aiMessages);
  await repository.updateCampaignSnapshot(detail.campaign.id, snapshot);

  const updated = await repository.getCampaignDetail(detail.campaign.id);
  if (!updated) {
    throw new Error("回合已写入，但重新读取战役失败。");
  }

  return updated;
}

export function summarizeSnapshot(
  detail: CampaignDetail,
  newMessages: GameMessage[],
): Pick<CampaignDetail["campaign"], "summary" | "worldState"> {
  const lastAgentLines = newMessages
    .filter((message) => message.author !== "player")
    .map((message) => `${message.author}: ${message.content}`)
    .join("\n")
    .slice(0, 900);

  return {
    summary: [detail.campaign.summary, lastAgentLines]
      .filter(Boolean)
      .join("\n\n")
      .slice(-1600),
    worldState:
      `最近更新于 ${nowIso()}。\n${lastAgentLines || detail.campaign.worldState}`.slice(
        0,
        1200,
      ),
  };
}

async function runHiddenRulesJudgeTurn(
  detail: CampaignDetail,
  playerAction: string,
  settings: AiSettings,
  rulesContext = "",
): Promise<AiTurnOutput | undefined> {
  const rulesJudge = settings.agents.find(
    (agent) => agent.role === "RulesJudge" && agent.enabled,
  );
  if (!rulesJudge) {
    return undefined;
  }
  const explicitTarget = resolvePrivateChatTarget(
    playerAction,
    settings,
    detail.npcs,
  );
  if (explicitTarget?.agent.role === "RulesJudge") {
    return undefined;
  }
  const input: AiTurnInput = {
    detail,
    playerAction,
    settings,
    rulesContext,
  };
  const output = await runAiAgentTurn(rulesJudge, input);
  return output.content.trim() ? output : undefined;
}

async function runArchivistTurn(
  detail: CampaignDetail,
  playerAction: string,
  settings: AiSettings,
  rulesContext = "",
): Promise<AiTurnOutput | undefined> {
  const archivist = getArchivistAgent({
    detail,
    playerAction,
    settings,
    rulesContext,
  });
  if (!archivist) {
    return undefined;
  }
  const output = await runAiAgentTurn(archivist, {
    detail,
    playerAction,
    settings,
    rulesContext,
  });
  return output.content.trim() ? output : undefined;
}

function createToolRuntime(
  repository: GameRepository,
  detail: CampaignDetail,
  mode: AiToolRuntime["mode"],
  npc?: NpcCharacter,
  toolResults?: AiToolExecutionResult[],
): AiToolRuntime {
  let playerCharacter = detail.character;
  const npcs = [...detail.npcs];
  return {
    mode,
    getPlayerCharacter: () => playerCharacter,
    savePlayerCharacter: async (character) => {
      playerCharacter = character;
      await repository.saveCharacter(detail.campaign.id, character);
    },
    listNpcs: () => npcs,
    getNpc: (target) =>
      npcs.find((item) => item.id === target || item.name === target) ??
      (npc && (target === "self" || target === npc.id || target === npc.name)
        ? npc
        : undefined),
    saveNpc: async (updatedNpc) => {
      const index = npcs.findIndex((item) => item.id === updatedNpc.id);
      if (index >= 0) {
        npcs[index] = updatedNpc;
      } else {
        npcs.push(updatedNpc);
      }
      await repository.saveNpcCharacter(updatedNpc);
    },
    createNpc: async (createdNpc) => {
      npcs.push(createdNpc);
      detail.npcs.push(createdNpc);
      await repository.saveNpcCharacter(createdNpc);
    },
    searchMessages: async (query, limit) =>
      repository.searchMessages(detail.campaign.id, query, limit),
    onToolResult: toolResults
      ? (result) => {
          toolResults.push(result);
        }
      : undefined,
  };
}

function findNpcForAgent(
  agent: { label: string; role: string },
  npcs: NpcCharacter[],
): NpcCharacter | undefined {
  if (agent.role !== "Companion") {
    return undefined;
  }
  return npcs.find((npc) => npc.name === agent.label || npc.id === agent.label);
}

async function handleGmMentions(
  repository: GameRepository,
  detail: CampaignDetail,
  gmContent: string,
  settings: AiSettings,
  toolResults: AiToolExecutionResult[],
  handlers: PlayTurnStreamHandlers,
): Promise<GameMessage[]> {
  const messages: GameMessage[] = [];
  const mentionsPlayer =
    gmContent.includes("@玩家") || /@player\b/i.test(gmContent);
  if (mentionsPlayer) {
    const message: GameMessage = {
      id: createId("msg"),
      campaignId: detail.campaign.id,
      sessionId: detail.session.id,
      author: "system",
      content: "GM 指定玩家回复。请在输入栏继续你的行动或台词。",
      createdAt: nowIso(),
    };
    await repository.appendMessage(message);
    handlers.onMessageAppend?.(message);
    messages.push(message);
  }

  const targetNpc = detail.npcs.find((npc) =>
    gmContent.includes(`@${npc.name}`),
  );
  if (!targetNpc) {
    return messages;
  }
  const npcAgent = {
    role: "Companion" as const,
    label: targetNpc.name,
    providerId: settings.defaultProviderId,
    enabled: true,
    systemPrompt: "",
  };
  const npcMessage: GameMessage = {
    id: createId("msg"),
    campaignId: detail.campaign.id,
    sessionId: detail.session.id,
    author: "NPC",
    authorLabel: targetNpc.name,
    actorId: targetNpc.id,
    content: "",
    createdAt: nowIso(),
  };
  const npcInput = {
    detail: {
      ...detail,
      messages: [
        ...detail.messages,
        {
          id: createId("msg"),
          campaignId: detail.campaign.id,
          sessionId: detail.session.id,
          author: "GM" as const,
          content: gmContent,
          createdAt: nowIso(),
        },
        ...messages,
      ],
    },
    playerAction: `GM 指定 @${targetNpc.name} 立刻回应：${gmContent}`,
    settings,
    npc: targetNpc,
    toolRuntime: createToolRuntime(
      repository,
      detail,
      "npc",
      targetNpc,
      toolResults,
    ),
  };
  const output = await runAiAgentTurnStreaming(npcAgent, npcInput, () => {});
  if (!output.content.trim()) {
    return messages;
  }
  const finalized = { ...npcMessage, content: output.content };
  await repository.appendMessage(finalized);
  handlers.onMessageAppend?.(finalized);
  messages.push(finalized);
  return messages;
}

export function mergeSettings(
  current: AiSettings | undefined,
  patch: Partial<AiSettings>,
): AiSettings {
  const normalized = normalizeAiSettings(current ?? defaultAiSettings);
  return normalizeAiSettings({
    ...normalized,
    ...patch,
    providers: patch.providers ?? normalized.providers,
    agents: patch.agents ?? normalized.agents,
  });
}
