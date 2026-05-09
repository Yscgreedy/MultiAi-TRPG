import { z } from "zod";

import type {
  AttributeBlock,
  CharacterCard,
  CharacterExport,
  CharacterLibraryEntry,
} from "@/types";
import { createId, nowIso } from "@/lib/id";

export interface RulesetAdapter {
  id: string;
  name: string;
  version: string;
  description: string;
  defaultAttributes: AttributeBlock;
  defaultSkills: Record<string, number>;
  diceExpression: string;
  statusFields: string[];
  characterSchema: z.ZodType<CharacterCard>;
  buildCharacterPrompt(input: CharacterSeedInput): string;
  buildActionPrompt(input: ActionPromptInput): string;
}

export interface CharacterSeedInput {
  concept: string;
  tone: string;
  profession: string;
}

export interface ActionPromptInput {
  playerAction: string;
  summary: string;
  worldState: string;
  character?: CharacterCard;
  recentMessages: string[];
}

export interface CharacterSheetTemplate {
  id: string;
  name: string;
  description: string;
  defaultAttributes: AttributeBlock;
  defaultSkills: Record<string, number>;
  attributeMin: number;
  attributeMax: number;
  skillMin: number;
  skillMax: number;
}

export const characterSheetTemplates: CharacterSheetTemplate[] = [
  {
    id: "通用",
    name: "通用",
    description: "四属性轻量角色卡，适合未知或自定义规则书。",
    defaultAttributes: { body: 2, mind: 2, spirit: 2, charm: 2 },
    defaultSkills: { 观察: 1, 交涉: 1, 潜行: 1, 战斗: 1, 学识: 1 },
    attributeMin: 1,
    attributeMax: 5,
    skillMin: 0,
    skillMax: 5,
  },
  {
    id: "DnD",
    name: "DnD",
    description: "D&D 风格六属性角色卡。",
    defaultAttributes: { 力量: 10, 敏捷: 10, 体质: 10, 智力: 10, 感知: 10, 魅力: 10 },
    defaultSkills: { 察觉: 0, 调查: 0, 隐匿: 0, 说服: 0, 奥秘: 0, 运动: 0 },
    attributeMin: 1,
    attributeMax: 20,
    skillMin: 0,
    skillMax: 10,
  },
  {
    id: "CoC",
    name: "CoC",
    description: "克苏鲁调查风格百分制角色卡。",
    defaultAttributes: { 力量: 50, 体质: 50, 体型: 50, 敏捷: 50, 外貌: 50, 智力: 50, 意志: 50, 教育: 50 },
    defaultSkills: { 侦查: 25, 聆听: 20, 图书馆使用: 20, 心理学: 10, 神秘学: 5, 潜行: 20 },
    attributeMin: 1,
    attributeMax: 100,
    skillMin: 0,
    skillMax: 100,
  },
  {
    id: "PF2e",
    name: "PF2e",
    description: "Pathfinder 风格六属性角色卡。",
    defaultAttributes: { 力量: 10, 敏捷: 10, 体质: 10, 智力: 10, 感知: 10, 魅力: 10 },
    defaultSkills: { 运动: 0, 特技: 0, 奥法: 0, 自然: 0, 医药: 0, 社群: 0 },
    attributeMin: 1,
    attributeMax: 20,
    skillMin: 0,
    skillMax: 10,
  },
  {
    id: "Fate",
    name: "Fate",
    description: "Fate 风格技能阶梯角色卡。",
    defaultAttributes: { 体魄: 1, 机敏: 1, 意志: 1, 社交: 1 },
    defaultSkills: { 调查: 1, 战斗: 1, 交流: 1, 资源: 1, 工艺: 1, 潜行: 1 },
    attributeMin: 0,
    attributeMax: 5,
    skillMin: 0,
    skillMax: 5,
  },
];

export function getCharacterSheetTemplate(characterType?: string): CharacterSheetTemplate {
  const normalized = characterType?.trim().toLowerCase();
  return (
    characterSheetTemplates.find(
      (template) =>
        template.id.toLowerCase() === normalized ||
        template.name.toLowerCase() === normalized,
    ) ?? characterSheetTemplates[0]
  );
}

const attributeSchema = z.record(z.string(), z.number().int());

export const characterCardSchema: z.ZodType<CharacterCard> = z.object({
  id: z.string().min(1),
  rulesetId: z.string().min(1),
  characterType: z.string().optional(),
  name: z.string().min(1),
  concept: z.string().min(1),
  background: z.string().default(""),
  attributes: attributeSchema,
  skills: z.record(z.string(), z.number().int().min(0)),
  inventory: z.array(z.string()),
  bonds: z.array(z.string()),
  conditions: z.array(z.string()),
  notes: z.string(),
  avatarUrl: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const characterExportSchema: z.ZodType<CharacterExport> = z.object({
  schemaVersion: z.literal(1),
  rulesetId: z.string(),
  character: characterCardSchema,
  metadata: z.object({
    exportedAt: z.string(),
    app: z.literal("multi-ai-trpg"),
  }),
});

export const lightRulesV1: RulesetAdapter = {
  id: "light-rules-v1",
  name: "轻规则 v1",
  version: "1.0.0",
  description: "面向单人叙事跑团的四属性轻量规则，使用 2d6 + 属性 + 技能判定。",
  defaultAttributes: {
    body: 2,
    mind: 2,
    spirit: 2,
    charm: 2,
  },
  defaultSkills: {
    观察: 1,
    交涉: 1,
    潜行: 1,
    战斗: 1,
    学识: 1,
  },
  diceExpression: "2d6 + 属性 + 技能，10+ 成功，7-9 部分成功，6- 失败并引入代价。",
  statusFields: ["体力", "压力", "线索", "关系"],
  characterSchema: characterCardSchema,
  buildCharacterPrompt(input) {
    return [
      "你是单人跑团的角色卡生成器。请基于轻规则 v1 生成 JSON，不要输出 Markdown。",
      `玩家概念：${input.concept || "未指定"}`,
      `故事调性：${input.tone || "奇幻调查"}`,
      `职业倾向：${input.profession || "自由冒险者"}`,
      "JSON 字段必须包含：name, concept, background, attributes(body,mind,spirit,charm 各 1-5), skills, inventory, bonds, conditions, notes。",
      "技能值范围 0-5，属性总和建议 8-11。",
    ].join("\n");
  },
  buildActionPrompt(input) {
    return [
      "你是多 AI 单人跑团的主持人。根据当前存档推进一轮游戏，输出紧凑但有画面感的中文叙事。",
      `规则：${this.diceExpression}`,
      `角色：${input.character?.name ?? "未绑定角色"} - ${
        input.character?.concept ?? "未知概念"
      }`,
      `战役摘要：${input.summary || "暂无摘要"}`,
      `世界状态：${input.worldState || "暂无世界状态"}`,
      `近期记录：${input.recentMessages.join("\n") || "暂无"}`,
      `玩家行动：${input.playerAction}`,
      "输出应包含：场景反馈、可能的判定和已经发生的后果。不要在结尾追问玩家后续行动。",
      "不要替 NPC 说台词；需要 NPC 回应时只写 @NPC名称。",
    ].join("\n");
  },
};

export const rulesets = [lightRulesV1];

export function getRuleset(rulesetId: string): RulesetAdapter {
  return rulesets.find((ruleset) => ruleset.id === rulesetId) ?? lightRulesV1;
}

export function createEmptyCharacter(
  rulesetId = lightRulesV1.id,
  concept = "待确定",
  characterType = "通用",
): CharacterCard {
  const template = getCharacterSheetTemplate(characterType);
  const timestamp = nowIso();

  return {
    id: createId("char"),
    rulesetId,
    characterType: template.id,
    name: "未命名角色",
    concept,
    background: "",
    attributes: { ...template.defaultAttributes },
    skills: { ...template.defaultSkills },
    inventory: [],
    bonds: [],
    conditions: [],
    notes: `角色卡类型：${template.name}`,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createRandomCharacter(
  rulesetId = lightRulesV1.id,
  characterType = "通用",
): CharacterCard {
  const concepts = [
    "负债的旧书店店主",
    "追踪传说的邮差",
    "隐姓埋名的退役骑士",
    "会修钟表的街头术士",
    "被海雾选中的灯塔看守",
  ];
  const names = ["林岚", "沈烛", "周砚", "陆青", "许望"];
  const concept = concepts[Math.floor(Math.random() * concepts.length)];
  const character = createEmptyCharacter(rulesetId, concept, characterType);

  return {
    ...character,
    name: names[Math.floor(Math.random() * names.length)],
    background: `这个角色以“${concept}”的身份进入故事，带着一段尚未公开的旧事。`,
  };
}

export function toLibraryEntry(
  character: CharacterCard,
  source: CharacterLibraryEntry["source"],
): CharacterLibraryEntry {
  return {
    ...character,
    source,
  };
}

export function cloneCharacterForCampaign(character: CharacterCard): CharacterCard {
  const timestamp = nowIso();
  return {
    ...character,
    id: createId("char"),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeGeneratedCharacter(
  raw: unknown,
  rulesetId = lightRulesV1.id,
  characterType = "通用",
): CharacterCard {
  const data = typeof raw === "object" && raw ? (raw as Partial<CharacterCard>) : {};
  const template = getCharacterSheetTemplate(data.characterType || characterType);
  const base = createEmptyCharacter(rulesetId, undefined, template.id);

  return characterCardSchema.parse({
    ...base,
    ...data,
    id: data.id || base.id,
    rulesetId,
    characterType: template.id,
    attributes: normalizeAttributes(data.attributes, base.attributes, template),
    skills: normalizeSkillMap(data.skills, base.skills, template),
    inventory: normalizeStringList(data.inventory, base.inventory),
    bonds: normalizeStringList(data.bonds, base.bonds),
    conditions: normalizeStringList(data.conditions, base.conditions),
    createdAt: data.createdAt || base.createdAt,
    updatedAt: nowIso(),
  });
}

function normalizeAttributes(
  value: unknown,
  fallback: AttributeBlock,
  template: CharacterSheetTemplate,
): AttributeBlock {
  const record = typeof value === "object" && value ? value as Record<string, unknown> : {};
  const keys = new Set([...Object.keys(fallback), ...Object.keys(record)]);
  return Object.fromEntries(
    [...keys].map((key) => [
      key,
      normalizeNumber(
        record[key],
        fallback[key] ?? template.attributeMin,
        template.attributeMin,
        template.attributeMax,
      ),
    ]),
  );
}

function normalizeSkillMap(
  value: unknown,
  fallback: Record<string, number>,
  template = getCharacterSheetTemplate(),
): Record<string, number> {
  if (Array.isArray(value)) {
    const entries = value
      .map((item) => {
        if (typeof item === "string") {
          return [item, 1] as const;
        }
        if (typeof item === "object" && item) {
          const record = item as Record<string, unknown>;
          const name = record.name ?? record.label ?? record.skill;
          if (typeof name === "string" && name.trim()) {
            return [
              name.trim(),
              normalizeNumber(record.value ?? record.level, 1, template.skillMin, template.skillMax),
            ] as const;
          }
        }
        return undefined;
      })
      .filter((item): item is readonly [string, number] => Boolean(item));
    return entries.length ? Object.fromEntries(entries) : fallback;
  }
  if (typeof value !== "object" || !value) {
    return fallback;
  }
  const normalized = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [
        key,
        normalizeNumber(item, 1, template.skillMin, template.skillMax),
      ] as const)
      .filter(([key]) => key.trim()),
  );
  return Object.keys(normalized).length ? { ...fallback, ...normalized } : fallback;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value
    .map((item) => stringifyGeneratedListItem(item))
    .map((item) => item.trim())
    .filter(Boolean);

  return normalized.length ? normalized : fallback;
}

function stringifyGeneratedListItem(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object" && value) {
    const record = value as Record<string, unknown>;
    const preferred = record.name ?? record.title ?? record.label ?? record.description;
    if (typeof preferred === "string" && preferred.trim()) {
      return preferred;
    }
    return Object.entries(record)
      .map(([key, item]) => `${key}: ${stringifyGeneratedListItem(item)}`)
      .join("，");
  }
  return "";
}

export function parseCharacterExport(jsonText: string): CharacterCard {
  const parsed = characterExportSchema.parse(JSON.parse(jsonText));
  if (parsed.rulesetId !== parsed.character.rulesetId) {
    throw new Error("角色卡规则书 ID 不一致。");
  }

  getRuleset(parsed.rulesetId).characterSchema.parse(parsed.character);
  return parsed.character;
}

export function serializeCharacterExport(character: CharacterCard): string {
  const payload: CharacterExport = {
    schemaVersion: 1,
    rulesetId: character.rulesetId,
    character,
    metadata: {
      exportedAt: nowIso(),
      app: "multi-ai-trpg",
    },
  };

  return JSON.stringify(payload, null, 2);
}
