import { getTurnAgents, resolvePrivateChatTarget, runAiAgentTurnStreaming, runMultiAgentTurn, type AiToolExecutionResult } from "@/lib/ai";
import { createId, nowIso } from "@/lib/id";
import { buildRulesRagContext } from "@/lib/rag";
import type { AiSettings, CampaignDetail, GameEvent, GameMessage } from "@/types";
import type { GameRepository } from "@/lib/storage";
import type { PlayTurnStreamHandlers } from "./types";
import { runArchivistTurn, runHiddenRulesJudgeTurn, handleGmMentions } from "./agent-side-effects";
import { createToolRuntime, findNpcForAgent } from "./tool-runtime";
import { summarizeSnapshot } from "./snapshot";

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
  const fastResponseMode = settings.responseMode === "fast";
  const rulesContext = await buildRulesRagContext(
    repository,
    settings,
    detail.campaign.rulesetId,
    action,
    { onPineconeUsage: handlers.onPineconeUsage },
  );
  const hiddenRulesOutput = fastResponseMode
    ? undefined
    : await runHiddenRulesJudgeTurn(baseDetail, action, settings, rulesContext);
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
  if (!fastResponseMode) {
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

