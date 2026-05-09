import { getArchivistAgent, resolvePrivateChatTarget, runAiAgentTurn, runAiAgentTurnStreaming, type AiToolExecutionResult, type AiTurnInput, type AiTurnOutput } from "@/lib/ai";
import { createId, nowIso } from "@/lib/id";
import type { AiSettings, CampaignDetail, GameMessage } from "@/types";
import type { GameRepository } from "@/lib/storage";
import type { PlayTurnStreamHandlers } from "./types";
import { createToolRuntime } from "./tool-runtime";

export async function runHiddenRulesJudgeTurn(
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

export async function runArchivistTurn(
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

export async function handleGmMentions(
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

