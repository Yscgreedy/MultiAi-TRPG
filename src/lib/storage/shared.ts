import { defaultAiSettings } from "@/lib/ai";
import { createId } from "@/lib/id";
import { createRandomCharacter } from "@/lib/rulesets";
import type { BrowserStore } from "./types";
import type { CharacterLibraryEntry, NpcCharacter } from "@/types";

export const DB_URL = "sqlite:multi-ai-trpg.db";
export const SETTINGS_KEY = "ai-settings";
export const BROWSER_STORE_KEY = "multi-ai-trpg-store";
const DEFAULT_NPC_AVATARS = [
  "/avatars/npc-default-male.png",
  "/avatars/npc-default-female.png",
];

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function emptyStore(): BrowserStore {
  return {
    settings: defaultAiSettings,
    libraryCharacters: [],
    campaigns: [],
    sessions: [],
    characters: [],
    npcCharacters: [],
    rulebookDocuments: [],
    rulebookChunks: [],
    characterCreationDrafts: [],
    messages: [],
    events: [],
  };
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

export function createDefaultCompanion(
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
    avatarUrl:
      DEFAULT_NPC_AVATARS[
        Math.floor(Math.random() * DEFAULT_NPC_AVATARS.length)
      ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
