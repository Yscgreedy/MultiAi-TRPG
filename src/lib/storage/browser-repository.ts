import { normalizeAiSettings } from "@/lib/ai";
import { createId, nowIso } from "@/lib/id";
import { createEmptyCharacter } from "@/lib/rulesets";
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
import type { GameRepository } from "./types";
import { BROWSER_STORE_KEY, createDefaultCompanion, emptyStore, parseJson, withoutLibraryLock } from "./shared";

export class BrowserRepository implements GameRepository {
  private store = emptyStore();

  async init(): Promise<void> {
    this.store = parseJson(
      localStorage.getItem(BROWSER_STORE_KEY),
      emptyStore(),
    );
    this.store.settings = normalizeAiSettings(this.store.settings);
    this.store.libraryCharacters = this.store.libraryCharacters ?? [];
    this.store.npcCharacters = this.store.npcCharacters ?? [];
    this.store.rulebookDocuments = this.store.rulebookDocuments ?? [];
    this.store.rulebookChunks = this.store.rulebookChunks ?? [];
    this.store.characterCreationDrafts =
      this.store.characterCreationDrafts ?? [];
    this.persist();
  }

  async getSettings(): Promise<AiSettings> {
    return normalizeAiSettings(this.store.settings);
  }

  async saveSettings(settings: AiSettings): Promise<void> {
    this.store.settings = normalizeAiSettings(settings);
    this.persist();
  }

  async getCharacterCreationDraft(
    scope: CharacterCreationDraftScope,
  ): Promise<CharacterCreationDraftRecord | undefined> {
    return this.store.characterCreationDrafts.find(
      (draft) => draft.scope === scope,
    );
  }

  async saveCharacterCreationDraft(
    draft: CharacterCreationDraftRecord,
  ): Promise<void> {
    this.store.characterCreationDrafts = [
      draft,
      ...this.store.characterCreationDrafts.filter(
        (item) => item.scope !== draft.scope,
      ),
    ];
    this.persist();
  }

  async deleteCharacterCreationDraft(
    scope: CharacterCreationDraftScope,
  ): Promise<void> {
    this.store.characterCreationDrafts = this.store.characterCreationDrafts.filter(
      (draft) => draft.scope !== scope,
    );
    this.persist();
  }

  async listLibraryCharacters(
    rulesetId?: string,
  ): Promise<CharacterLibraryEntry[]> {
    return this.store.libraryCharacters
      .filter((character) => !rulesetId || character.rulesetId === rulesetId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async saveLibraryCharacter(character: CharacterLibraryEntry): Promise<void> {
    const existingIndex = this.store.libraryCharacters.findIndex(
      (item) => item.id === character.id,
    );
    if (existingIndex >= 0) {
      this.store.libraryCharacters[existingIndex] = character;
    } else {
      this.store.libraryCharacters.push(character);
    }
    this.persist();
  }

  async deleteLibraryCharacter(characterId: string): Promise<void> {
    const character = this.store.libraryCharacters.find(
      (item) => item.id === characterId,
    );
    if (character?.lockedByCampaignId) {
      throw new Error("角色卡正在战役中使用，删除对应战役后才能删除。");
    }
    this.store.libraryCharacters = this.store.libraryCharacters.filter(
      (character) => character.id !== characterId,
    );
    this.persist();
  }

  async lockLibraryCharacter(
    characterId: string,
    campaign: Pick<Campaign, "id" | "title">,
  ): Promise<void> {
    const timestamp = nowIso();
    this.store.libraryCharacters = this.store.libraryCharacters.map(
      (character) => {
        if (character.id !== characterId) {
          return character;
        }
        if (
          character.lockedByCampaignId &&
          character.lockedByCampaignId !== campaign.id
        ) {
          throw new Error("该角色卡已经加入其他战役，不能重复使用。");
        }
        return {
          ...character,
          lockedByCampaignId: campaign.id,
          lockedByCampaignTitle: campaign.title,
          lockedAt: timestamp,
          updatedAt: timestamp,
        };
      },
    );
    this.persist();
  }

  async releaseLibraryCharacter(
    characterId: string,
    campaignId?: string,
  ): Promise<void> {
    this.store.libraryCharacters = this.store.libraryCharacters.map(
      (character) => {
        if (character.id !== characterId) {
          return character;
        }
        if (campaignId && character.lockedByCampaignId !== campaignId) {
          return character;
        }
        const released = withoutLibraryLock(character);
        return { ...released, updatedAt: nowIso() };
      },
    );
    this.persist();
  }

  async releaseLibraryCharactersLockedByCampaign(
    campaignId: string,
  ): Promise<void> {
    let changed = false;
    this.store.libraryCharacters = this.store.libraryCharacters.map(
      (character) => {
        if (character.lockedByCampaignId !== campaignId) {
          return character;
        }
        changed = true;
        return { ...withoutLibraryLock(character), updatedAt: nowIso() };
      },
    );
    if (changed) {
      this.persist();
    }
  }

  async listRulebookDocuments(rulesetId?: string): Promise<RulebookDocument[]> {
    return this.store.rulebookDocuments
      .filter((document) => !rulesetId || document.rulesetId === rulesetId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async saveRulebookDocument(
    document: RulebookDocument,
    chunks: RulebookChunk[],
  ): Promise<void> {
    this.store.rulebookDocuments = [
      document,
      ...this.store.rulebookDocuments.filter((item) => item.id !== document.id),
    ];
    this.store.rulebookChunks = [
      ...this.store.rulebookChunks.filter(
        (chunk) => chunk.documentId !== document.id,
      ),
      ...chunks,
    ];
    this.persist();
  }

  async updateRulebookDocumentMeta(
    documentId: string,
    meta: Pick<RulebookDocument, "characterType">,
  ): Promise<void> {
    this.store.rulebookDocuments = this.store.rulebookDocuments.map((document) =>
      document.id === documentId
        ? {
            ...document,
            characterType: meta.characterType?.trim() || "通用",
            updatedAt: nowIso(),
          }
        : document,
    );
    this.persist();
  }

  async deleteRulebookDocument(documentId: string): Promise<void> {
    this.store.rulebookDocuments = this.store.rulebookDocuments.filter(
      (document) => document.id !== documentId,
    );
    this.store.rulebookChunks = this.store.rulebookChunks.filter(
      (chunk) => chunk.documentId !== documentId,
    );
    this.persist();
  }

  async listRulebookChunks(rulesetId?: string): Promise<RulebookChunk[]> {
    return this.store.rulebookChunks
      .filter((chunk) => !rulesetId || chunk.rulesetId === rulesetId)
      .sort((a, b) => a.chunkIndex - b.chunkIndex);
  }

  async listCampaigns(): Promise<Campaign[]> {
    return [...this.store.campaigns].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  async createCampaign(input: {
    title: string;
    premise: string;
    rulesetId: string;
    character?: CharacterCard;
    sourceCharacterId?: string;
  }): Promise<CampaignDetail> {
    const timestamp = nowIso();
    const character = input.character ?? createEmptyCharacter(input.rulesetId);
    const campaign: Campaign = {
      id: createId("camp"),
      title: input.title,
      rulesetId: input.rulesetId,
      status: "active",
      premise: input.premise,
      summary: "战役刚刚开始，玩家尚未建立关键记录。",
      worldState: "世界状态等待第一轮行动更新。",
      activeCharacterId: character.id,
      sourceCharacterId: input.sourceCharacterId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const session: GameSession = {
      id: createId("sess"),
      campaignId: campaign.id,
      title: "第一幕",
      checkpoint: "初始断点",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const message: GameMessage = {
      id: createId("msg"),
      campaignId: campaign.id,
      sessionId: session.id,
      author: "system",
      content: `战役创建：${campaign.premise}`,
      createdAt: timestamp,
    };
    const companion = createDefaultCompanion(
      campaign.id,
      input.rulesetId,
      timestamp,
    );

    this.store.campaigns.unshift(campaign);
    this.store.sessions.unshift(session);
    this.store.characters.unshift(character);
    this.store.npcCharacters.unshift(companion);
    this.store.messages.push(message);
    if (input.sourceCharacterId) {
      await this.lockLibraryCharacter(input.sourceCharacterId, campaign);
    }
    this.persist();

    return {
      campaign,
      session,
      character,
      npcs: [companion],
      messages: [message],
      events: [],
    };
  }

  async deleteCampaign(campaignId: string): Promise<void> {
    const campaign = this.store.campaigns.find(
      (item) => item.id === campaignId,
    );
    this.store.campaigns = this.store.campaigns.filter(
      (item) => item.id !== campaignId,
    );
    this.store.sessions = this.store.sessions.filter(
      (item) => item.campaignId !== campaignId,
    );
    this.store.npcCharacters = this.store.npcCharacters.filter(
      (item) => item.campaignId !== campaignId,
    );
    this.store.characters = this.store.characters.filter(
      (item) => item.id !== campaign?.activeCharacterId,
    );
    this.store.messages = this.store.messages.filter(
      (item) => item.campaignId !== campaignId,
    );
    this.store.events = this.store.events.filter(
      (item) => item.campaignId !== campaignId,
    );
    if (campaign?.sourceCharacterId) {
      await this.releaseLibraryCharacter(
        campaign.sourceCharacterId,
        campaignId,
      );
    }
    await this.releaseLibraryCharactersLockedByCampaign(campaignId);
    this.persist();
  }

  async getCampaignDetail(
    campaignId: string,
  ): Promise<CampaignDetail | undefined> {
    const campaign = this.store.campaigns.find(
      (item) => item.id === campaignId,
    );
    const session = this.store.sessions.find(
      (item) => item.campaignId === campaignId,
    );

    if (!campaign || !session) {
      return undefined;
    }

    return {
      campaign,
      session,
      character: this.store.characters.find(
        (item) => item.id === campaign.activeCharacterId,
      ),
      npcs: this.store.npcCharacters
        .filter((item) => item.campaignId === campaignId && item.isActive)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      messages: this.store.messages.filter(
        (item) => item.campaignId === campaignId,
      ),
      events: this.store.events.filter(
        (item) => item.campaignId === campaignId,
      ),
    };
  }

  async saveCharacter(
    campaignId: string,
    character: CharacterCard,
  ): Promise<void> {
    const existingIndex = this.store.characters.findIndex(
      (item) => item.id === character.id,
    );
    if (existingIndex >= 0) {
      this.store.characters[existingIndex] = character;
    } else {
      this.store.characters.push(character);
    }

    this.store.campaigns = this.store.campaigns.map((campaign) =>
      campaign.id === campaignId
        ? { ...campaign, activeCharacterId: character.id, updatedAt: nowIso() }
        : campaign,
    );
    this.persist();
  }

  async listNpcCharacters(campaignId: string): Promise<NpcCharacter[]> {
    return this.store.npcCharacters
      .filter((npc) => npc.campaignId === campaignId && npc.isActive)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async saveNpcCharacter(npc: NpcCharacter): Promise<void> {
    const existingIndex = this.store.npcCharacters.findIndex(
      (item) => item.id === npc.id,
    );
    if (existingIndex >= 0) {
      this.store.npcCharacters[existingIndex] = npc;
    } else {
      this.store.npcCharacters.push(npc);
    }
    this.touchCampaign(npc.campaignId);
  }

  async deleteNpcCharacter(npcId: string): Promise<void> {
    const npc = this.store.npcCharacters.find((item) => item.id === npcId);
    this.store.npcCharacters = this.store.npcCharacters.filter(
      (item) => item.id !== npcId,
    );
    if (npc) {
      this.touchCampaign(npc.campaignId);
    } else {
      this.persist();
    }
  }

  async appendMessage(message: GameMessage): Promise<void> {
    this.store.messages.push(message);
    this.touchCampaign(message.campaignId);
  }

  async updateMessageContent(
    messageId: string,
    content: string,
  ): Promise<void> {
    let campaignId: string | undefined;
    this.store.messages = this.store.messages.map((message) => {
      if (message.id !== messageId) {
        return message;
      }
      campaignId = message.campaignId;
      return { ...message, content };
    });
    if (campaignId) {
      this.touchCampaign(campaignId);
    } else {
      this.persist();
    }
  }

  async searchMessages(
    campaignId: string,
    query: string,
    limit = 10,
  ): Promise<GameMessage[]> {
    const lowerQuery = query.toLowerCase();
    return this.store.messages
      .filter(
        (message) =>
          message.campaignId === campaignId &&
          message.content.toLowerCase().includes(lowerQuery),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async appendEvent(event: GameEvent): Promise<void> {
    this.store.events.push(event);
    this.touchCampaign(event.campaignId);
  }

  async updateCampaignSnapshot(
    campaignId: string,
    snapshot: Pick<Campaign, "summary" | "worldState">,
  ): Promise<void> {
    this.store.campaigns = this.store.campaigns.map((campaign) =>
      campaign.id === campaignId
        ? { ...campaign, ...snapshot, updatedAt: nowIso() }
        : campaign,
    );
    this.persist();
  }

  private touchCampaign(campaignId: string): void {
    this.store.campaigns = this.store.campaigns.map((campaign) =>
      campaign.id === campaignId
        ? { ...campaign, updatedAt: nowIso() }
        : campaign,
    );
    this.persist();
  }

  private persist(): void {
    localStorage.setItem(BROWSER_STORE_KEY, JSON.stringify(this.store));
  }
}
