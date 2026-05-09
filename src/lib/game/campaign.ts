import { createEmptyCharacter, normalizeGeneratedCharacter } from "@/lib/rulesets";
import type { CampaignDetail, CharacterCard } from "@/types";
import type { GameRepository } from "@/lib/storage";
import type { NewCampaignInput } from "./types";


export async function bootstrapCampaign(
  repository: GameRepository,
  input: NewCampaignInput,
): Promise<CampaignDetail> {
  const character = createEmptyCharacter(
    input.rulesetId,
    input.characterConcept,
  );
  return repository.createCampaign({
    title: input.title || "未命名战役",
    premise: input.premise || "一场尚未揭晓的单人冒险。",
    rulesetId: input.rulesetId,
    character,
  });
}

export async function saveGeneratedCharacter(
  repository: GameRepository,
  campaignId: string,
  raw: unknown,
  rulesetId: string,
): Promise<CharacterCard> {
  const character = normalizeGeneratedCharacter(raw, rulesetId);
  await repository.saveCharacter(campaignId, character);
  return character;
}

