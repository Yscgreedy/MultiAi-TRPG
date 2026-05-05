export type AiRole = "GM" | "Companion" | "RulesJudge" | "Archivist";

export type CampaignStatus = "draft" | "active" | "archived";

export type MessageAuthor = "player" | AiRole | "NPC" | "system";

export interface AttributeBlock {
  body: number;
  mind: number;
  spirit: number;
  charm: number;
}

export interface CharacterCard {
  id: string;
  rulesetId: string;
  name: string;
  concept: string;
  background: string;
  attributes: AttributeBlock;
  skills: Record<string, number>;
  inventory: string[];
  bonds: string[];
  conditions: string[];
  notes: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterLibraryEntry extends CharacterCard {
  source: "manual" | "ai" | "imported" | "random";
  lockedByCampaignId?: string;
  lockedByCampaignTitle?: string;
  lockedAt?: string;
}

export interface NpcCharacter extends CharacterCard {
  campaignId: string;
  kind: "npc";
  isActive: boolean;
  createdBy: "GM" | "player" | "system";
}

export interface CharacterExport {
  schemaVersion: 1;
  rulesetId: string;
  character: CharacterCard;
  metadata: {
    exportedAt: string;
    app: "multi-ai-trpg";
  };
}

export interface Campaign {
  id: string;
  title: string;
  rulesetId: string;
  status: CampaignStatus;
  premise: string;
  summary: string;
  worldState: string;
  activeCharacterId?: string;
  sourceCharacterId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GameSession {
  id: string;
  campaignId: string;
  title: string;
  checkpoint: string;
  createdAt: string;
  updatedAt: string;
}

export interface GameMessage {
  id: string;
  campaignId: string;
  sessionId: string;
  author: MessageAuthor;
  authorLabel?: string;
  actorId?: string;
  content: string;
  createdAt: string;
}

export interface GameEvent {
  id: string;
  campaignId: string;
  sessionId: string;
  eventType: string;
  payload: unknown;
  createdAt: string;
}

export interface AiAgentConfig {
  role: AiRole;
  label: string;
  providerId?: string;
  model?: string;
  enabled: boolean;
  systemPrompt: string;
}

export interface AiProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  defaultModel?: string;
}

export interface AiSettings {
  providers: AiProviderConfig[];
  defaultProviderId: string;
  agents: AiAgentConfig[];
}

export interface CampaignDetail {
  campaign: Campaign;
  session: GameSession;
  character?: CharacterCard;
  npcs: NpcCharacter[];
  messages: GameMessage[];
  events: GameEvent[];
}
