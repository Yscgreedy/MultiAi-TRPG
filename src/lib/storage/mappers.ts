import type {
  Campaign,
  CharacterCard,
  CharacterCreationDraftRecord,
  CharacterLibraryEntry,
  GameEvent,
  GameMessage,
  GameSession,
  NpcCharacter,
  RulebookChunk,
  RulebookDocument,
} from "@/types";
import { parseJson } from "./shared";

export interface CampaignRow {
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

export interface SessionRow {
  id: string;
  campaign_id: string;
  title: string;
  checkpoint: string;
  created_at: string;
  updated_at: string;
}

export interface CharacterRow {
  data: string;
}

export interface CharacterLibraryRow {
  data: string;
}

export interface NpcCharacterRow {
  data: string;
}

export interface RulebookDocumentRow {
  id: string;
  ruleset_id: string;
  character_type?: string;
  title: string;
  source_name: string;
  content: string;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

export interface RulebookChunkRow {
  id: string;
  document_id: string;
  ruleset_id: string;
  chunk_index: number;
  content: string;
  embedding: string;
  created_at: string;
}

export interface CharacterCreationDraftRow {
  data: string;
}

export interface MessageRow {
  id: string;
  campaign_id: string;
  session_id: string;
  author: GameMessage["author"];
  author_label?: string;
  actor_id?: string;
  content: string;
  created_at: string;
}

export interface EventRow {
  id: string;
  campaign_id: string;
  session_id: string;
  event_type: string;
  payload: string;
  created_at: string;
}

export function campaignFromRow(row: CampaignRow): Campaign {
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

export function sessionFromRow(row: SessionRow): GameSession {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    title: row.title,
    checkpoint: row.checkpoint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function characterFromRow(row: CharacterRow): CharacterCard {
  return JSON.parse(row.data) as CharacterCard;
}

export function libraryCharacterFromRow(
  row: CharacterLibraryRow,
): CharacterLibraryEntry {
  return JSON.parse(row.data) as CharacterLibraryEntry;
}

export function npcCharacterFromRow(row: NpcCharacterRow): NpcCharacter {
  return JSON.parse(row.data) as NpcCharacter;
}

export function rulebookDocumentFromRow(row: RulebookDocumentRow): RulebookDocument {
  return {
    id: row.id,
    rulesetId: row.ruleset_id,
    characterType: row.character_type || "通用",
    title: row.title,
    sourceName: row.source_name,
    content: row.content,
    chunkCount: row.chunk_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rulebookChunkFromRow(row: RulebookChunkRow): RulebookChunk {
  return {
    id: row.id,
    documentId: row.document_id,
    rulesetId: row.ruleset_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    embedding: parseJson(row.embedding, []),
    createdAt: row.created_at,
  };
}

export function characterCreationDraftFromRow(
  row: CharacterCreationDraftRow,
): CharacterCreationDraftRecord {
  return JSON.parse(row.data) as CharacterCreationDraftRecord;
}

export function withoutLibraryLock(
  character: CharacterLibraryEntry,
): CharacterLibraryEntry {
  const released: CharacterLibraryEntry = { ...character };
  delete released.lockedByCampaignId;
  delete released.lockedByCampaignTitle;
  delete released.lockedAt;
  return released;
}

export function messageFromRow(row: MessageRow): GameMessage {
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

export function eventFromRow(row: EventRow): GameEvent {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    sessionId: row.session_id,
    eventType: row.event_type,
    payload: parseJson(row.payload, {}),
    createdAt: row.created_at,
  };
}

