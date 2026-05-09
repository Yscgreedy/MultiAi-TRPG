import { nowIso } from "@/lib/id";
import type { CampaignDetail, GameMessage } from "@/types";

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

