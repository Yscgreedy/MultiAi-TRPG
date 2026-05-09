export type AiRole = "GM" | "Companion" | "RulesJudge" | "Archivist";

export type CampaignStatus = "draft" | "active" | "archived";

export type MessageAuthor = "player" | AiRole | "NPC" | "system";

export type AttributeBlock = Record<string, number>;

export interface CharacterCard {
  id: string;
  rulesetId: string;
  characterType?: string;
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

export type CharacterCreationMessageAuthor = "player" | "GM" | "tool";

export interface CharacterCreationMessage {
  id: string;
  author: CharacterCreationMessageAuthor;
  content: string;
  createdAt: string;
}

export type CharacterCreationStatus =
  | "chatting"
  | "ready"
  | "generating"
  | "completed";

export interface CharacterCreationToolResult {
  toolName: string;
  result: unknown;
  createdAt: string;
}

export interface CharacterCreationSession {
  id: string;
  rulesetId: string;
  characterType: string;
  draft: CharacterCard;
  messages: CharacterCreationMessage[];
  toolResults: CharacterCreationToolResult[];
  status: CharacterCreationStatus;
  rulesContext?: string;
  createdAt: string;
  updatedAt: string;
}

export type CharacterCreationDraftScope = "library" | "campaign";

export interface CharacterCreationDraftRecord {
  scope: CharacterCreationDraftScope;
  session: CharacterCreationSession | null;
  input: string;
  state: Record<string, unknown>;
  overlayOpen: boolean;
  updatedAt: string;
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

export interface AiRagSettings {
  enabled: boolean;
  source: "local" | "pinecone";
  embeddingProviderId?: string;
  embeddingModel: string;
  rerankProviderId?: string;
  rerankModel: string;
  pineconeApiKey: string;
  pineconeIndexName: string;
  pineconeNamespace: string;
  pineconeCloud: string;
  pineconeRegion: string;
  pineconeEmbeddingModel: string;
  pineconeRerankEnabled: boolean;
  pineconeRerankModel: string;
  pineconeGlobalFallbackEnabled: boolean;
  topK: number;
  chunkSize: number;
}

export interface AiSettings {
  providers: AiProviderConfig[];
  defaultProviderId: string;
  agents: AiAgentConfig[];
  rag: AiRagSettings;
  gmFullContext?: boolean;
  responseMode?: "complete" | "fast";
}

export interface CampaignDetail {
  campaign: Campaign;
  session: GameSession;
  character?: CharacterCard;
  npcs: NpcCharacter[];
  messages: GameMessage[];
  events: GameEvent[];
}

export interface RulebookDocument {
  id: string;
  rulesetId: string;
  characterType?: string;
  title: string;
  sourceName: string;
  content: string;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RulebookChunk {
  id: string;
  documentId: string;
  rulesetId: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  createdAt: string;
}
