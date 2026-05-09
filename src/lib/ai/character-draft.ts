import type { CharacterCard } from "@/types";
import { createEmptyCharacter, type CharacterSeedInput } from "@/lib/rulesets";

export function createBlankCharacterCreationDraft(
  rulesetId: string,
  characterType: string,
  seed: Partial<CharacterSeedInput> = {},
): CharacterCard {
  const draft = createEmptyCharacter(rulesetId, "待确定", characterType);
  return {
    ...draft,
    name: "待定角色",
    concept: "待确定",
    background: "",
    inventory: [],
    bonds: [],
    conditions: [],
    notes: [
      `角色卡类型：${draft.characterType ?? characterType}`,
      seed.concept?.trim() ? `玩家初始概念：${seed.concept.trim()}` : "",
      seed.tone?.trim() ? `期望调性：${seed.tone.trim()}` : "",
      seed.profession?.trim() ? `职业倾向：${seed.profession.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
