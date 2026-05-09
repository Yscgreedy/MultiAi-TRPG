import Database from "@tauri-apps/plugin-sql";

import { defaultAiSettings, normalizeAiSettings } from "@/lib/ai";
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
import { DB_URL, SETTINGS_KEY, createDefaultCompanion, parseJson, withoutLibraryLock } from "./shared";
import {
  campaignFromRow,
  characterCreationDraftFromRow,
  characterFromRow,
  eventFromRow,
  libraryCharacterFromRow,
  messageFromRow,
  npcCharacterFromRow,
  rulebookChunkFromRow,
  rulebookDocumentFromRow,
  sessionFromRow,
  type CampaignRow,
  type CharacterCreationDraftRow,
  type CharacterLibraryRow,
  type CharacterRow,
  type EventRow,
  type MessageRow,
  type NpcCharacterRow,
  type RulebookChunkRow,
  type RulebookDocumentRow,
  type SessionRow,
} from "./mappers";

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

  async getCharacterCreationDraft(
    scope: CharacterCreationDraftScope,
  ): Promise<CharacterCreationDraftRecord | undefined> {
    const rows = await this.select<CharacterCreationDraftRow>(
      "SELECT * FROM character_creation_drafts WHERE scope = $1 LIMIT 1",
      [scope],
    );
    return rows[0] ? characterCreationDraftFromRow(rows[0]) : undefined;
  }

  async saveCharacterCreationDraft(
    draft: CharacterCreationDraftRecord,
  ): Promise<void> {
    await this.execute(
      `INSERT INTO character_creation_drafts (scope, data, updated_at)
       VALUES ($1,$2,$3)
       ON CONFLICT(scope) DO UPDATE SET
       data = excluded.data,
       updated_at = excluded.updated_at`,
      [draft.scope, JSON.stringify(draft), draft.updatedAt],
    );
  }

  async deleteCharacterCreationDraft(
    scope: CharacterCreationDraftScope,
  ): Promise<void> {
    await this.execute("DELETE FROM character_creation_drafts WHERE scope = $1", [
      scope,
    ]);
  }

  async listLibraryCharacters(
    rulesetId?: string,
  ): Promise<CharacterLibraryEntry[]> {
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
    await this.execute("DELETE FROM character_library WHERE id = $1", [
      characterId,
    ]);
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

  async releaseLibraryCharacter(
    characterId: string,
    campaignId?: string,
  ): Promise<void> {
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

  async releaseLibraryCharactersLockedByCampaign(
    campaignId: string,
  ): Promise<void> {
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

  async listRulebookDocuments(rulesetId?: string): Promise<RulebookDocument[]> {
    const rows = await this.select<RulebookDocumentRow>(
      rulesetId
        ? "SELECT * FROM rulebook_documents WHERE ruleset_id = $1 ORDER BY updated_at DESC"
        : "SELECT * FROM rulebook_documents ORDER BY updated_at DESC",
      rulesetId ? [rulesetId] : undefined,
    );
    return rows.map(rulebookDocumentFromRow);
  }

  async saveRulebookDocument(
    document: RulebookDocument,
    chunks: RulebookChunk[],
  ): Promise<void> {
    await this.execute(
      `INSERT INTO rulebook_documents
       (id, ruleset_id, character_type, title, source_name, content, chunk_count, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(id) DO UPDATE SET
       ruleset_id = excluded.ruleset_id,
       character_type = excluded.character_type,
       title = excluded.title,
       source_name = excluded.source_name,
       content = excluded.content,
       chunk_count = excluded.chunk_count,
       updated_at = excluded.updated_at`,
      [
        document.id,
        document.rulesetId,
        document.characterType || "通用",
        document.title,
        document.sourceName,
        document.content,
        document.chunkCount,
        document.createdAt,
        document.updatedAt,
      ],
    );
    await this.execute("DELETE FROM rulebook_chunks WHERE document_id = $1", [
      document.id,
    ]);
    for (const chunk of chunks) {
      await this.execute(
        `INSERT INTO rulebook_chunks
         (id, document_id, ruleset_id, chunk_index, content, embedding, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          chunk.id,
          chunk.documentId,
          chunk.rulesetId,
          chunk.chunkIndex,
          chunk.content,
          JSON.stringify(chunk.embedding),
          chunk.createdAt,
        ],
      );
    }
  }

  async updateRulebookDocumentMeta(
    documentId: string,
    meta: Pick<RulebookDocument, "characterType">,
  ): Promise<void> {
    await this.execute(
      `UPDATE rulebook_documents
       SET character_type = $1,
           updated_at = $2
       WHERE id = $3`,
      [meta.characterType?.trim() || "通用", nowIso(), documentId],
    );
  }

  async deleteRulebookDocument(documentId: string): Promise<void> {
    await this.execute("DELETE FROM rulebook_chunks WHERE document_id = $1", [
      documentId,
    ]);
    await this.execute("DELETE FROM rulebook_documents WHERE id = $1", [
      documentId,
    ]);
  }

  async listRulebookChunks(rulesetId?: string): Promise<RulebookChunk[]> {
    const rows = await this.select<RulebookChunkRow>(
      rulesetId
        ? "SELECT * FROM rulebook_chunks WHERE ruleset_id = $1 ORDER BY document_id, chunk_index ASC"
        : "SELECT * FROM rulebook_chunks ORDER BY document_id, chunk_index ASC",
      rulesetId ? [rulesetId] : undefined,
    );
    return rows.map(rulebookChunkFromRow);
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
    const companion = createDefaultCompanion(
      campaign.id,
      input.rulesetId,
      timestamp,
    );

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
    const campaignRows = await this.select<CampaignRow>(
      "SELECT * FROM campaigns WHERE id = $1 LIMIT 1",
      [campaignId],
    );
    const campaign = campaignRows[0]
      ? campaignFromRow(campaignRows[0])
      : undefined;
    const characterRows = await this.select<{ id: string }>(
      "SELECT id FROM characters WHERE campaign_id = $1",
      [campaignId],
    );

    for (const row of characterRows) {
      await this.execute(
        "DELETE FROM character_versions WHERE character_id = $1",
        [row.id],
      );
    }
    await this.execute("DELETE FROM game_events WHERE campaign_id = $1", [
      campaignId,
    ]);
    await this.execute("DELETE FROM messages WHERE campaign_id = $1", [
      campaignId,
    ]);
    await this.execute("DELETE FROM npc_characters WHERE campaign_id = $1", [
      campaignId,
    ]);
    await this.execute("DELETE FROM characters WHERE campaign_id = $1", [
      campaignId,
    ]);
    await this.execute("DELETE FROM sessions WHERE campaign_id = $1", [
      campaignId,
    ]);
    await this.execute("DELETE FROM campaigns WHERE id = $1", [campaignId]);
    if (campaign?.sourceCharacterId) {
      await this.releaseLibraryCharacter(
        campaign.sourceCharacterId,
        campaignId,
      );
    }
    await this.releaseLibraryCharactersLockedByCampaign(campaignId);
  }

  async getCampaignDetail(
    campaignId: string,
  ): Promise<CampaignDetail | undefined> {
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
      ? await this.select<CharacterRow>(
          "SELECT * FROM characters WHERE id = $1",
          [campaign.activeCharacterId],
        )
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
      character: characterRows[0]
        ? characterFromRow(characterRows[0])
        : undefined,
      npcs: npcRows.map(npcCharacterFromRow),
      messages: messageRows.map(messageFromRow),
      events: eventRows.map(eventFromRow),
    };
  }

  async saveCharacter(
    campaignId: string,
    character: CharacterCard,
  ): Promise<void> {
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

  async updateMessageContent(
    messageId: string,
    content: string,
  ): Promise<void> {
    await this.execute("UPDATE messages SET content = $1 WHERE id = $2", [
      content,
      messageId,
    ]);
  }

  async searchMessages(
    campaignId: string,
    query: string,
    limit = 10,
  ): Promise<GameMessage[]> {
    const rows = await this.select<MessageRow>(
      `SELECT * FROM messages
       WHERE campaign_id = $1 AND content LIKE $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [campaignId, `%${query}%`, limit],
    );
    return rows.map(messageFromRow);
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

