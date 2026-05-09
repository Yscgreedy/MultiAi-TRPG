import { describe, expect, it } from "vitest";

import {
  createEmptyCharacter,
  normalizeGeneratedCharacter,
  parseCharacterExport,
  serializeCharacterExport,
} from "@/lib/rulesets";

describe("rulesets", () => {
  it("creates a valid light-rules character", () => {
    const character = createEmptyCharacter("light-rules-v1", "调查员");

    expect(character.rulesetId).toBe("light-rules-v1");
    expect(character.concept).toBe("调查员");
    expect(character.attributes.body).toBeGreaterThan(0);
    expect(character.skills.观察).toBe(1);
    expect(character.background).toBe("");
    expect(character.inventory).toEqual([]);
    expect(character.bonds).toEqual([]);
  });

  it("round-trips character import and export", () => {
    const character = createEmptyCharacter();
    const exported = serializeCharacterExport(character);
    const imported = parseCharacterExport(exported);

    expect(imported.id).toBe(character.id);
    expect(imported.rulesetId).toBe(character.rulesetId);
  });

  it("normalizes AI output into the required character shape", () => {
    const character = normalizeGeneratedCharacter(
      {
        name: "林岚",
        concept: "灯塔调查员",
        attributes: { mind: 4 },
        skills: { 观察: 3, 神秘学: 2 },
      },
      "light-rules-v1",
    );

    expect(character.name).toBe("林岚");
    expect(character.attributes.mind).toBe(4);
    expect(character.attributes.body).toBe(2);
    expect(character.skills.神秘学).toBe(2);
  });

  it("clamps generated values to the selected character sheet template bounds", () => {
    const character = normalizeGeneratedCharacter(
      {
        name: "陆青",
        concept: "过度强化的调查员",
        attributes: { body: 999, mind: -10 },
        skills: { 观察: 99, 交涉: -2 },
      },
      "light-rules-v1",
      "通用",
    );

    expect(character.attributes.body).toBe(5);
    expect(character.attributes.mind).toBe(1);
    expect(character.skills.观察).toBe(5);
    expect(character.skills.交涉).toBe(0);
  });

  it("fills missing generated values from the template so players do not assign points manually", () => {
    const character = normalizeGeneratedCharacter(
      {
        name: "周砚",
        concept: "还没分点的角色",
      },
      "light-rules-v1",
      "通用",
    );

    expect(character.attributes).toMatchObject({
      body: 2,
      mind: 2,
      spirit: 2,
      charm: 2,
    });
    expect(character.skills).toMatchObject({
      观察: 1,
      交涉: 1,
      潜行: 1,
      战斗: 1,
      学识: 1,
    });
    expect(character.inventory).toEqual([]);
    expect(character.bonds).toEqual([]);
    expect(character.background).toBe("");
  });

  it("coerces object list items returned by AI into strings", () => {
    const character = normalizeGeneratedCharacter(
      {
        name: "沈烛",
        concept: "雾港记者",
        bonds: [
          { name: "旧灯塔看守", relation: "欠对方一次帮助" },
          { title: "报社编辑", description: "持续施压" },
        ],
        inventory: [{ name: "录音笔" }, "旧相机"],
        conditions: [{ description: "压力上升" }],
      },
      "light-rules-v1",
    );

    expect(character.bonds).toEqual(["旧灯塔看守", "报社编辑"]);
    expect(character.inventory).toEqual(["录音笔", "旧相机"]);
    expect(character.conditions).toEqual(["压力上升"]);
  });
});
