import type { GameMessage } from "@/types";
import type { PineconeUsageEvent } from "@/lib/rag";

export interface PlayTurnStreamHandlers {
  onMessageAppend?: (message: GameMessage) => void;
  onMessageDelta?: (messageId: string, token: string) => void;
  onPineconeUsage?: (event: PineconeUsageEvent) => void;
}

export interface NewCampaignInput {
  title: string;
  premise: string;
  rulesetId: string;
  characterConcept: string;
}
