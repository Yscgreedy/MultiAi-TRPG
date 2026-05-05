import Database from "@tauri-apps/plugin-sql";

import { defaultAiSettings, normalizeAiSettings } from "@/lib/ai";
import { createId, nowIso } from "@/lib/id";
import { createEmptyCharacter, createRandomCharacter } from "@/lib/rulesets";
import type {
  AiSettings,
  Campaign,
  CampaignDetail,
  CharacterCard,
  CharacterLibraryEntry,
  GameEvent,
  GameMessage,
  GameSession,
  NpcCharacter,
} from "@/types";

const DB_URL = "sqlite:multi-ai-trpg.db";
const SETTINGS_KEY = "ai-settings";
const BROWSER_STORE_KEY = "multi-ai-trpg-store";
const DEFAULT_NPC_AVATARS = [
  "/avatars/npc-default-male.png",
  "/avatars/npc-default-female.png",
];

export interface GameRepository {
  init(): Promise<void>;
  getSettings(): Promise<AiSettings>;
  saveSettings(settings: AiSettings): Promise<void>;
  listLibraryCharacters(rulesetId?: string): Promise<CharacterLibraryEntry[]>;
  saveLibraryCharacter(character: CharacterLibraryEntry): Promise<void>;
  deleteLibraryCharacter(characterId: string): Promise<void>;
  lockLibraryCharacter(
    characterId: string,
    campaign: Pick<Campaign, "id" | "title">,
  ): Promise<void>;
  releaseLibraryCharacter(characterId: string, campaignId?: string): Promise<void>;
  releaseLibraryCharactersLockedByCampaign(campaignId: string): Promise<void>;
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
  appendEvent(event: GameEvent): Promise<void>;
  updateCampaignSnapshot(
    campaignId: string,
    snapshot: Pick<Campaign, "summary" | "worldState">,
  ): Promise<void>;
}

interface BrowserStore {
  settings: AiSettings;
  libraryCharacters: CharacterLibraryEntry[];
  campaigns: Campaign[];
  sessions: GameSession[];
  characters: CharacterCard[];
  npcCharacters: NpcCharacter[];
  messages: GameMessage[];
  events: GameEvent[];
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function emptyStore(): BrowserStore {
  return {
    settings: defaultAiSettings,
    libraryCharacters: [],
    campaigns: [],
    sessions: [],
    characters: [],
    npcCharacters: [],
    messages: [],
    events: [],
  };
}

export class BrowserRepository implements GameRepository {
  private store = emptyStore();

  async init(): Promise<void> {
    this.store = parseJson(localStorage.getItem(BROWSER_STORE_KEY), emptyStore());
    this.store.settings = normalizeAiSettings(this.store.settings);
    this.store.libraryCharacters = this.store.libraryCharacters ?? [];
    this.store.npcCharacters = this.store.npcCharacters ?? [];
    this.persist();
  }

  async getSettings(): Promise<AiSettings> {
    return normalizeAiSettings(this.store.settings);
  }

  async saveSettings(settings: AiSettings): Promise<void> {
    this.store.settings = normalizeAiSettings(settings);
    this.persist();
  }

  async listLibraryCharacters(rulesetId?: string): Promise<CharacterLibraryEntry[]> {
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
    const character = this.store.libraryCharacters.find((item) => item.id === characterId);
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
    this.store.libraryCharacters = this.store.libraryCharacters.map((character) => {
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
    });
    this.persist();
  }

  async releaseLibraryCharacter(characterId: string, campaignId?: string): Promise<void> {
    this.store.libraryCharacters = this.store.libraryCharacters.map((character) => {
      if (character.id !== characterId) {
        return character;
      }
      if (campaignId && character.lockedByCampaignId !== campaignId) {
        return character;
      }
      const released = withoutLibraryLock(character);
      return { ...released, updatedAt: nowIso() };
    });
    this.persist();
  }

  async releaseLibraryCharactersLockedByCampaign(campaignId: string): Promise<void> {
    let changed = false;
    this.store.libraryCharacters = this.store.libraryCharacters.map((character) => {
      if (character.lockedByCampaignId !== campaignId) {
        return character;
      }
      changed = true;
      return { ...withoutLibraryLock(character), updatedAt: nowIso() };
    });
    if (changed) {
      this.persist();
    }
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
    const companion = createDefaultCompanion(campaign.id, input.rulesetId, timestamp);

    this.store.campaigns.unshift(campaign);
    this.store.sessions.unshift(session);
    this.store.characters.unshift(character);
    this.store.npcCharacters.unshift(companion);
    this.store.messages.push(message);
    if (input.sourceCharacterId) {
      await this.lockLibraryCharacter(input.sourceCharacterId, campaign);
    }
    this.persist();

    return { campaign, session, character, npcs: [companion], messages: [message], events: [] };
  }

  async deleteCampaign(campaignId: string): Promise<void> {
    const campaign = this.store.campaigns.find((item) => item.id === campaignId);
    this.store.campaigns = this.store.campaigns.filter((item) => item.id !== campaignId);
    this.store.sessions = this.store.sessions.filter((item) => item.campaignId !== campaignId);
    this.store.npcCharacters = this.store.npcCharacters.filter(
      (item) => item.campaignId !== campaignId,
    );
    this.store.characters = this.store.characters.filter(
      (item) => item.id !== campaign?.activeCharacterId,
    );
    this.store.messages = this.store.messages.filter((item) => item.campaignId !== campaignId);
    this.store.events = this.store.events.filter((item) => item.campaignId !== campaignId);
    if (campaign?.sourceCharacterId) {
      await this.releaseLibraryCharacter(campaign.sourceCharacterId, campaignId);
    }
    await this.releaseLibraryCharactersLockedByCampaign(campaignId);
    this.persist();
  }

  async getCampaignDetail(campaignId: string): Promise<CampaignDetail | undefined> {
    const campaign = this.store.campaigns.find((item) => item.id === campaignId);
    const session = this.store.sessions.find((item) => item.campaignId === campaignId);

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
      messages: this.store.messages.filter((item) => item.campaignId === campaignId),
      events: this.store.events.filter((item) => item.campaignId === campaignId),
    };
  }

  async saveCharacter(campaignId: string, character: CharacterCard): Promise<void> {
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
    const existingIndex = this.store.npcCharacters.findIndex((item) => item.id === npc.id);
    if (existingIndex >= 0) {
      this.store.npcCharacters[existingIndex] = npc;
    } else {
      this.store.npcCharacters.push(npc);
    }
    this.touchCampaign(npc.campaignId);
  }

  async deleteNpcCharacter(npcId: string): Promise<void> {
    const npc = this.store.npcCharacters.find((item) => item.id === npcId);
    this.store.npcCharacters = this.store.npcCharacters.filter((item) => item.id !== npcId);
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

  async updateMessageContent(messageId: string, content: string): Promise<void> {
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
      campaign.id === campaignId ? { ...campaign, updatedAt: nowIso() } : campaign,
    );
    this.persist();
  }

  private persist(): void {
    localStorage.setItem(BROWSER_STORE_KEY, JSON.stringify(this.store));
  }
}

export class SqliteRepository implements GameRepository {
  private db?: Database;

  async init(): Promise<void> {
    this.db = await Database.load(DB_URL);
    const settings = await this.getSetting<AiSettings>(SETTINGS_KEY);
    if (!settings) {
      await this.saveSettings(defaultAiSettings);
    } else {
      await this.saveSettings(normalizeAiSettings(settings));
    }
  }

  async getSettings(): Promise<AiSettings> {
    return normalizeAiSettings(
      (await this.getSetting<AiSettings>(SETTINGS_KEY)) ?? defaultAiSettings,
    );
  }

  async saveSettings(settings: AiSettings): Promise<void> {
    const normalized = normalizeAiSettings(settings);
    await this.execute(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [SETTINGS_KEY, JSON.stringify(normalized), nowIso()],
    );
  }

  async listLibraryCharacters(rulesetId?: string): Promise<CharacterLibraryEntry[]> {
    const rows = await this.select<CharacterLibraryRow>(
      rulesetId
        ? "SELECT * FROM character_library WHERE ruleset_id = $1 ORDER BY updated_at DESC"
        : "SELECT * FROM character_library ORDER BY updated_at DESC",
      rulesetId ? [rulesetId] : undefined,
    );
    return rows.map(libraryCharacterFromRow);
  }

  async saveLibraryCharacter(character: CharacterLibraryEntry): Promise<void> {
    await this.execute(
      `INSERT INTO character_library (id, ruleset_id, name, source, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(id) DO UPDATE SET
       ruleset_id = excluded.ruleset_id,
       name = excluded.name,
       source = excluded.source,
       data = excluded.data,
       updated_at = excluded.updated_at`,
      [
        character.id,
        character.rulesetId,
        character.name,
        character.source,
        JSON.stringify(character),
        character.createdAt,
        character.updatedAt,
      ],
    );
  }

  async deleteLibraryCharacter(characterId: string): Promise<void> {
    const rows = await this.select<{ locked: string | null }>(
      "SELECT json_extract(data, '$.lockedByCampaignId') AS locked FROM character_library WHERE id = $1 LIMIT 1",
      [characterId],
    );
    if (rows[0]?.locked) {
      throw new Error("角色卡正在战役中使用，删除对应战役后才能删除。");
    }
    await this.execute("DELETE FROM character_library WHERE id = $1", [characterId]);
  }

  async lockLibraryCharacter(
    characterId: string,
    campaign: Pick<Campaign, "id" | "title">,
  ): Promise<void> {
    const rows = await this.select<CharacterLibraryRow>(
      "SELECT data FROM character_library WHERE id = $1 LIMIT 1",
      [characterId],
    );
    const character = rows[0] ? libraryCharacterFromRow(rows[0]) : undefined;
    if (!character) {
      throw new Error("角色卡不存在，无法加入战役。");
    }
    if (
      character.lockedByCampaignId &&
      character.lockedByCampaignId !== campaign.id
    ) {
      throw new Error("该角色卡已经加入其他战役，不能重复使用。");
    }

    await this.saveLibraryCharacter({
      ...character,
      lockedByCampaignId: campaign.id,
      lockedByCampaignTitle: campaign.title,
      lockedAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  async releaseLibraryCharacter(characterId: string, campaignId?: string): Promise<void> {
    const rows = await this.select<CharacterLibraryRow>(
      "SELECT data FROM character_library WHERE id = $1 LIMIT 1",
      [characterId],
    );
    const character = rows[0] ? libraryCharacterFromRow(rows[0]) : undefined;
    if (!character) {
      return;
    }
    if (campaignId && character.lockedByCampaignId !== campaignId) {
      return;
    }
    const released = withoutLibraryLock(character);
    await this.saveLibraryCharacter({ ...released, updatedAt: nowIso() });
  }

  async releaseLibraryCharactersLockedByCampaign(campaignId: string): Promise<void> {
    const rows = await this.select<CharacterLibraryRow>(
      "SELECT data FROM character_library ORDER BY updated_at DESC",
    );
    await Promise.all(
      rows
        .map(libraryCharacterFromRow)
        .filter((character) => character.lockedByCampaignId === campaignId)
        .map((character) =>
          this.saveLibraryCharacter({
            ...withoutLibraryLock(character),
            updatedAt: nowIso(),
          }),
        ),
    );
  }

  async listCampaigns(): Promise<Campaign[]> {
    const rows = await this.select<CampaignRow>(
      "SELECT * FROM campaigns ORDER BY updated_at DESC",
    );
    return rows.map(campaignFromRow);
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
    const companion = createDefaultCompanion(campaign.id, input.rulesetId, timestamp);

    await this.execute(
      `INSERT INTO campaigns
       (id, title, ruleset_id, status, premise, summary, world_state, active_character_id, source_character_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        campaign.id,
        campaign.title,
        campaign.rulesetId,
        campaign.status,
        campaign.premise,
        campaign.summary,
        campaign.worldState,
        campaign.activeCharacterId,
        campaign.sourceCharacterId,
        campaign.createdAt,
        campaign.updatedAt,
      ],
    );
    await this.execute(
      `INSERT INTO sessions (id, campaign_id, title, checkpoint, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        session.id,
        session.campaignId,
        session.title,
        session.checkpoint,
        session.createdAt,
        session.updatedAt,
      ],
    );
    await this.saveCharacter(campaign.id, character);
    await this.saveNpcCharacter(companion);
    await this.appendMessage(message);
    if (input.sourceCharacterId) {
      await this.lockLibraryCharacter(input.sourceCharacterId, campaign);
    }

    return { campaign, session, character, npcs: [companion], messages: [message], events: [] };
  }

  async deleteCampaign(campaignId: string): Promise<void> {
    const campaignRows = await this.select<CampaignRow>(
      "SELECT * FROM campaigns WHERE id = $1 LIMIT 1",
      [campaignId],
    );
    const campaign = campaignRows[0] ? campaignFromRow(campaignRows[0]) : undefined;
    const characterRows = await this.select<{ id: string }>(
      "SELECT id FROM characters WHERE campaign_id = $1",
      [campaignId],
    );

    for (const row of characterRows) {
      await this.execute("DELETE FROM character_versions WHERE character_id = $1", [
        row.id,
      ]);
    }
    await this.execute("DELETE FROM game_events WHERE campaign_id = $1", [campaignId]);
    await this.execute("DELETE FROM messages WHERE campaign_id = $1", [campaignId]);
    await this.execute("DELETE FROM npc_characters WHERE campaign_id = $1", [campaignId]);
    await this.execute("DELETE FROM characters WHERE campaign_id = $1", [campaignId]);
    await this.execute("DELETE FROM sessions WHERE campaign_id = $1", [campaignId]);
    await this.execute("DELETE FROM campaigns WHERE id = $1", [campaignId]);
    if (campaign?.sourceCharacterId) {
      await this.releaseLibraryCharacter(campaign.sourceCharacterId, campaignId);
    }
    await this.releaseLibraryCharactersLockedByCampaign(campaignId);
  }

  async getCampaignDetail(campaignId: string): Promise<CampaignDetail | undefined> {
    const campaignRows = await this.select<CampaignRow>(
      "SELECT * FROM campaigns WHERE id = $1 LIMIT 1",
      [campaignId],
    );
    const sessionRows = await this.select<SessionRow>(
      "SELECT * FROM sessions WHERE campaign_id = $1 ORDER BY updated_at DESC LIMIT 1",
      [campaignId],
    );

    if (!campaignRows[0] || !sessionRows[0]) {
      return undefined;
    }

    const campaign = campaignFromRow(campaignRows[0]);
    const characterRows = campaign.activeCharacterId
      ? await this.select<CharacterRow>("SELECT * FROM characters WHERE id = $1", [
          campaign.activeCharacterId,
        ])
      : [];
    const messageRows = await this.select<MessageRow>(
      "SELECT * FROM messages WHERE campaign_id = $1 ORDER BY created_at ASC",
      [campaignId],
    );
    const eventRows = await this.select<EventRow>(
      "SELECT * FROM game_events WHERE campaign_id = $1 ORDER BY created_at ASC",
      [campaignId],
    );
    const npcRows = await this.select<NpcCharacterRow>(
      "SELECT data FROM npc_characters WHERE campaign_id = $1 AND is_active = 1 ORDER BY created_at ASC",
      [campaignId],
    );

    return {
      campaign,
      session: sessionFromRow(sessionRows[0]),
      character: characterRows[0] ? characterFromRow(characterRows[0]) : undefined,
      npcs: npcRows.map(npcCharacterFromRow),
      messages: messageRows.map(messageFromRow),
      events: eventRows.map(eventFromRow),
    };
  }

  async saveCharacter(campaignId: string, character: CharacterCard): Promise<void> {
    await this.execute(
      `INSERT INTO characters (id, campaign_id, ruleset_id, name, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at`,
      [
        character.id,
        campaignId,
        character.rulesetId,
        character.name,
        JSON.stringify(character),
        character.createdAt,
        character.updatedAt,
      ],
    );
    await this.execute(
      `INSERT INTO character_versions (id, character_id, data, created_at)
       VALUES ($1,$2,$3,$4)`,
      [createId("charver"), character.id, JSON.stringify(character), nowIso()],
    );
    await this.execute(
      "UPDATE campaigns SET active_character_id = $1, updated_at = $2 WHERE id = $3",
      [character.id, nowIso(), campaignId],
    );
  }

  async listNpcCharacters(campaignId: string): Promise<NpcCharacter[]> {
    const rows = await this.select<NpcCharacterRow>(
      "SELECT data FROM npc_characters WHERE campaign_id = $1 AND is_active = 1 ORDER BY created_at ASC",
      [campaignId],
    );
    return rows.map(npcCharacterFromRow);
  }

  async saveNpcCharacter(npc: NpcCharacter): Promise<void> {
    await this.execute(
      `INSERT INTO npc_characters
       (id, campaign_id, ruleset_id, name, data, is_active, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(id) DO UPDATE SET
       campaign_id = excluded.campaign_id,
       ruleset_id = excluded.ruleset_id,
       name = excluded.name,
       data = excluded.data,
       is_active = excluded.is_active,
       updated_at = excluded.updated_at`,
      [
        npc.id,
        npc.campaignId,
        npc.rulesetId,
        npc.name,
        JSON.stringify(npc),
        npc.isActive ? 1 : 0,
        npc.createdBy,
        npc.createdAt,
        npc.updatedAt,
      ],
    );
    await this.touchCampaign(npc.campaignId);
  }

  async deleteNpcCharacter(npcId: string): Promise<void> {
    const rows = await this.select<{ campaign_id: string }>(
      "SELECT campaign_id FROM npc_characters WHERE id = $1 LIMIT 1",
      [npcId],
    );
    await this.execute("DELETE FROM npc_characters WHERE id = $1", [npcId]);
    if (rows[0]?.campaign_id) {
      await this.touchCampaign(rows[0].campaign_id);
    }
  }

  async appendMessage(message: GameMessage): Promise<void> {
    await this.execute(
      `INSERT INTO messages (id, campaign_id, session_id, author, author_label, actor_id, content, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        message.id,
        message.campaignId,
        message.sessionId,
        message.author,
        message.authorLabel,
        message.actorId,
        message.content,
        message.createdAt,
      ],
    );
    await this.touchCampaign(message.campaignId);
  }

  async updateMessageContent(messageId: string, content: string): Promise<void> {
    await this.execute("UPDATE messages SET content = $1 WHERE id = $2", [
      content,
      messageId,
    ]);
  }

  async appendEvent(event: GameEvent): Promise<void> {
    await this.execute(
      `INSERT INTO game_events (id, campaign_id, session_id, event_type, payload, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        event.id,
        event.campaignId,
        event.sessionId,
        event.eventType,
        JSON.stringify(event.payload),
        event.createdAt,
      ],
    );
    await this.touchCampaign(event.campaignId);
  }

  async updateCampaignSnapshot(
    campaignId: string,
    snapshot: Pick<Campaign, "summary" | "worldState">,
  ): Promise<void> {
    await this.execute(
      "UPDATE campaigns SET summary = $1, world_state = $2, updated_at = $3 WHERE id = $4",
      [snapshot.summary, snapshot.worldState, nowIso(), campaignId],
    );
  }

  private async getSetting<T>(key: string): Promise<T | undefined> {
    const rows = await this.select<{ value: string }>(
      "SELECT value FROM settings WHERE key = $1 LIMIT 1",
      [key],
    );
    return parseJson<T | undefined>(rows[0]?.value, undefined);
  }

  private async touchCampaign(campaignId: string): Promise<void> {
    await this.execute("UPDATE campaigns SET updated_at = $1 WHERE id = $2", [
      nowIso(),
      campaignId,
    ]);
  }

  private async execute(query: string, values?: unknown[]): Promise<void> {
    if (!this.db) {
      throw new Error("SQLite 尚未初始化。");
    }
    await this.db.execute(query, values);
  }

  private async select<T>(query: string, values?: unknown[]): Promise<T[]> {
    if (!this.db) {
      throw new Error("SQLite 尚未初始化。");
    }
    return this.db.select<T[]>(query, values);
  }
}

interface CampaignRow {
  id: string;
  title: string;
  ruleset_id: string;
  status: Campaign["status"];
  premise: string;
  summary: string;
  world_state: string;
  active_character_id?: string;
  source_character_id?: string;
  created_at: string;
  updated_at: string;
}

interface SessionRow {
  id: string;
  campaign_id: string;
  title: string;
  checkpoint: string;
  created_at: string;
  updated_at: string;
}

interface CharacterRow {
  data: string;
}

interface CharacterLibraryRow {
  data: string;
}

interface NpcCharacterRow {
  data: string;
}

interface MessageRow {
  id: string;
  campaign_id: string;
  session_id: string;
  author: GameMessage["author"];
  author_label?: string;
  actor_id?: string;
  content: string;
  created_at: string;
}

interface EventRow {
  id: string;
  campaign_id: string;
  session_id: string;
  event_type: string;
  payload: string;
  created_at: string;
}

function campaignFromRow(row: CampaignRow): Campaign {
  return {
    id: row.id,
    title: row.title,
    rulesetId: row.ruleset_id,
    status: row.status,
    premise: row.premise,
    summary: row.summary,
    worldState: row.world_state,
    activeCharacterId: row.active_character_id,
    sourceCharacterId: row.source_character_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sessionFromRow(row: SessionRow): GameSession {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    title: row.title,
    checkpoint: row.checkpoint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function characterFromRow(row: CharacterRow): CharacterCard {
  return JSON.parse(row.data) as CharacterCard;
}

function libraryCharacterFromRow(row: CharacterLibraryRow): CharacterLibraryEntry {
  return JSON.parse(row.data) as CharacterLibraryEntry;
}

function npcCharacterFromRow(row: NpcCharacterRow): NpcCharacter {
  return JSON.parse(row.data) as NpcCharacter;
}

function withoutLibraryLock(character: CharacterLibraryEntry): CharacterLibraryEntry {
  const released: CharacterLibraryEntry = { ...character };
  delete released.lockedByCampaignId;
  delete released.lockedByCampaignTitle;
  delete released.lockedAt;
  return released;
}

function messageFromRow(row: MessageRow): GameMessage {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    sessionId: row.session_id,
    author: row.author,
    authorLabel: row.author_label,
    actorId: row.actor_id,
    content: row.content,
    createdAt: row.created_at,
  };
}

function eventFromRow(row: EventRow): GameEvent {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    sessionId: row.session_id,
    eventType: row.event_type,
    payload: parseJson(row.payload, {}),
    createdAt: row.created_at,
  };
}

function createDefaultCompanion(
  campaignId: string,
  rulesetId: string,
  timestamp: string,
): NpcCharacter {
  const character = createRandomCharacter(rulesetId);
  return {
    ...character,
    id: createId("npc"),
    name: character.name || "同行者",
    concept: character.concept || "与玩家同行的临时盟友",
    campaignId,
    kind: "npc",
    isActive: true,
    createdBy: "system",
    avatarUrl: DEFAULT_NPC_AVATARS[Math.floor(Math.random() * DEFAULT_NPC_AVATARS.length)],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createRepository(): GameRepository {
  return isTauriRuntime() ? new SqliteRepository() : new BrowserRepository();
}
