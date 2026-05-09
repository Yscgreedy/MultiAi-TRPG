import type {
  AiSettings,
  Campaign,
  CampaignDetail,
  CharacterCard,
  CharacterCreationDraftRecord,
  CharacterCreationDraftScope,
  CharacterLibraryEntry,
  GameEvent,
  GameMessage,
  GameSession,
  NpcCharacter,
  RulebookChunk,
  RulebookDocument,
} from "@/types";

export interface GameRepository {
  init(): Promise<void>;
  getSettings(): Promise<AiSettings>;
  saveSettings(settings: AiSettings): Promise<void>;
  getCharacterCreationDraft(
    scope: CharacterCreationDraftScope,
  ): Promise<CharacterCreationDraftRecord | undefined>;
  saveCharacterCreationDraft(draft: CharacterCreationDraftRecord): Promise<void>;
  deleteCharacterCreationDraft(scope: CharacterCreationDraftScope): Promise<void>;
  listLibraryCharacters(rulesetId?: string): Promise<CharacterLibraryEntry[]>;
  saveLibraryCharacter(character: CharacterLibraryEntry): Promise<void>;
  deleteLibraryCharacter(characterId: string): Promise<void>;
  lockLibraryCharacter(
    characterId: string,
    campaign: Pick<Campaign, "id" | "title">,
  ): Promise<void>;
  releaseLibraryCharacter(
    characterId: string,
    campaignId?: string,
  ): Promise<void>;
  releaseLibraryCharactersLockedByCampaign(campaignId: string): Promise<void>;
  listRulebookDocuments(rulesetId?: string): Promise<RulebookDocument[]>;
  saveRulebookDocument(
    document: RulebookDocument,
    chunks: RulebookChunk[],
  ): Promise<void>;
  updateRulebookDocumentMeta(
    documentId: string,
    meta: Pick<RulebookDocument, "characterType">,
  ): Promise<void>;
  deleteRulebookDocument(documentId: string): Promise<void>;
  listRulebookChunks(rulesetId?: string): Promise<RulebookChunk[]>;
  listCampaigns(): Promise<Campaign[]>;
  createCampaign(input: {
    title: string;
    premise: string;
    rulesetId: string;
    character?: CharacterCard;
    sourceCharacterId?: string;
  }): Promise<CampaignDetail>;
  deleteCampaign(campaignId: string): Promise<void>;
  getCampaignDetail(campaignId: string): Promise<CampaignDetail | undefined>;
  saveCharacter(campaignId: string, character: CharacterCard): Promise<void>;
  listNpcCharacters(campaignId: string): Promise<NpcCharacter[]>;
  saveNpcCharacter(npc: NpcCharacter): Promise<void>;
  deleteNpcCharacter(npcId: string): Promise<void>;
  appendMessage(message: GameMessage): Promise<void>;
  updateMessageContent(messageId: string, content: string): Promise<void>;
  searchMessages(
    campaignId: string,
    query: string,
    limit?: number,
  ): Promise<GameMessage[]>;
  appendEvent(event: GameEvent): Promise<void>;
  updateCampaignSnapshot(
    campaignId: string,
    snapshot: Pick<Campaign, "summary" | "worldState">,
  ): Promise<void>;
}

export interface BrowserStore {
  settings: AiSettings;
  libraryCharacters: CharacterLibraryEntry[];
  campaigns: Campaign[];
  sessions: GameSession[];
  characters: CharacterCard[];
  npcCharacters: NpcCharacter[];
  rulebookDocuments: RulebookDocument[];
  rulebookChunks: RulebookChunk[];
  characterCreationDrafts: CharacterCreationDraftRecord[];
  messages: GameMessage[];
  events: GameEvent[];
}
