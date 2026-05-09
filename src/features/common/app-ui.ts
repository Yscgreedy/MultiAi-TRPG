import { characterSheetTemplates, rulesets } from "@/lib/rulesets";
import type { CharacterCard, RulebookDocument } from "@/types";
import type { AccentColor } from "@/lib/ui-state";
import { getDisplayFilePath } from "@/lib/rulebook-files";

export const defaultRulebookCharacterType = "通用";
export const rulebookCharacterTypeOptions = characterSheetTemplates.map(
  (template) => template.name,
);

export const defaultSeed = {
  concept: "",
  tone: "",
  profession: "",
};

export type CharacterSeedForm = typeof defaultSeed;

export const accentOptions: Array<{ value: AccentColor; label: string }> = [
  { value: "teal", label: "青绿" },
  { value: "indigo", label: "靛蓝" },
  { value: "rose", label: "玫红" },
  { value: "amber", label: "琥珀" },
];

export const diceExpressions = ["1d4", "1d6", "2d6", "1d8", "1d10", "1d12", "1d20", "1d100"];
export const maxVisiblePlayMessages = 120;

export interface DiceRollResult {
  expression: string;
  rolls: number[];
  total: number;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}

export function readStringState(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function readObjectState<T extends object>(value: unknown): Partial<T> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Partial<T>)
    : {};
}

export function getRulebookCategories(documents: RulebookDocument[]): string[] {
  return Array.from(
    new Set([
      "轻规则 v1",
      ...rulesets.map((ruleset) => ruleset.name),
      ...documents.map((document) => getRulebookCategoryLabel(document.rulesetId)),
    ]),
  ).filter(Boolean);
}

export function getCampaignRulebookOptions(
  documents: RulebookDocument[],
): Array<{ value: string; label: string }> {
  const importedIds = new Set(documents.map((document) => document.rulesetId));
  const options: Array<{ value: string; label: string }> = rulesets.map((ruleset) => {
    const hasImportedAlias = importedIds.has(ruleset.name);
    return {
      value: ruleset.id,
      label: hasImportedAlias ? `${ruleset.name}（内置规则）` : ruleset.name,
    };
  });
  const seen = new Set(options.map((option) => option.value));

  for (const document of documents) {
    if (seen.has(document.rulesetId)) {
      continue;
    }
    const label = getRulebookCategoryLabel(document.rulesetId);
    const characterType = getRulebookCharacterTypeLabel(document);
    const duplicatesBuiltinLabel = rulesets.some((ruleset) => ruleset.name === label);
    options.push({
      value: document.rulesetId,
      label: duplicatesBuiltinLabel
        ? `${label}（已导入规则书 · ${characterType}）`
        : `${label} · ${characterType}`,
    });
    seen.add(document.rulesetId);
  }

  return options;
}

export function getRulebookCategoryLabel(category: string): string {
  return rulesets.find((ruleset) => ruleset.id === category)?.name ?? category;
}

export function getRulebookCharacterTypeLabel(document?: RulebookDocument): string {
  return document?.characterType?.trim() || defaultRulebookCharacterType;
}

export function getRulebookCharacterTypeForRuleset(
  rulesetId: string,
  documents: RulebookDocument[],
): string {
  const document = documents.find((item) => item.rulesetId === rulesetId);
  if (document) {
    return getRulebookCharacterTypeLabel(document);
  }
  return rulesets.some((ruleset) => ruleset.id === rulesetId)
    ? defaultRulebookCharacterType
    : defaultRulebookCharacterType;
}

export function getCharacterTypeLabel(character?: Pick<CharacterCard, "characterType">): string {
  return character?.characterType?.trim() || defaultRulebookCharacterType;
}

export function getRulesetDescription(rulesetId: string): string {
  const ruleset = rulesets.find((item) => item.id === rulesetId);
  return ruleset?.description ?? "使用已导入的规则书知识库；角色卡类型由规则书标签决定。";
}

export function getRulebookCategoryAliases(category: string): string[] {
  const aliases = new Set([category]);
  const matchedRuleset = rulesets.find((ruleset) => ruleset.name === category);
  if (matchedRuleset) {
    aliases.add(matchedRuleset.id);
  }
  return Array.from(aliases);
}

export function dedupeRulebookFiles(files: File[]): File[] {
  const seen = new Set<string>();
  const result: File[] = [];
  for (const file of files) {
    const key = `${getDisplayFilePath(file)}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(file);
  }
  return result;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

