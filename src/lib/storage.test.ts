import { beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapCampaign, playTurn, playTurnStreaming } from "@/lib/game";
import { BrowserRepository } from "@/lib/storage";
import { defaultAiSettings } from "@/lib/ai";
import { createEmptyCharacter, toLibraryEntry } from "@/lib/rulesets";
import type { NpcCharacter } from "@/types";

const store = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
});

describe("browser repository fallback", () => {
  beforeEach(() => {
    store.clear();
  });

  it("persists a campaign and restores it by id", async () => {
    const repository = new BrowserRepository();
    await repository.init();
    const detail = await bootstrapCampaign(repository, {
      title: "测试战役",
      premise: "测试开局",
      rulesetId: "light-rules-v1",
      characterConcept: "测试角色",
    });

    const restored = await repository.getCampaignDetail(detail.campaign.id);

    expect(restored?.campaign.title).toBe("测试战役");
    expect(restored?.character?.concept).toBe("测试角色");
  });

  it("writes player and AI messages during a turn", async () => {
    const repository = new BrowserRepository();
    await repository.init();
    const detail = await bootstrapCampaign(repository, {
      title: "测试战役",
      premise: "测试开局",
      rulesetId: "light-rules-v1",
      characterConcept: "测试角色",
    });

    const updated = await playTurn(repository, detail, "我观察门锁。", defaultAiSettings);

    expect(updated.messages.some((message) => message.author === "player")).toBe(true);
    expect(updated.messages.some((message) => message.author === "GM")).toBe(true);
    expect(updated.events).toHaveLength(1);
  });

  it("streams AI messages through callbacks before returning the stored turn", async () => {
    const repository = new BrowserRepository();
    await repository.init();
    const detail = await bootstrapCampaign(repository, {
      title: "流式战役",
      premise: "测试开局",
      rulesetId: "light-rules-v1",
      characterConcept: "测试角色",
    });
    const appended: string[] = [];
    const deltas: string[] = [];

    const updated = await playTurnStreaming(
      repository,
      detail,
      "我观察门锁。",
      defaultAiSettings,
      {
        onMessageAppend: (message) => appended.push(message.author),
        onMessageDelta: (_messageId, token) => deltas.push(token),
      },
    );

    expect(appended).toContain("player");
    expect(appended).toContain("GM");
    expect(deltas.join("")).toContain("离线模式回应");
    expect(updated.messages.some((message) => message.author === "GM")).toBe(true);
  });

  it("locks library characters while a campaign uses them and releases on delete", async () => {
    const repository = new BrowserRepository();
    await repository.init();
    const libraryCharacter = toLibraryEntry(
      createEmptyCharacter("light-rules-v1", "锁定测试角色"),
      "manual",
    );
    await repository.saveLibraryCharacter(libraryCharacter);

    const detail = await repository.createCampaign({
      title: "锁定战役",
      premise: "测试开局",
      rulesetId: "light-rules-v1",
      character: libraryCharacter,
      sourceCharacterId: libraryCharacter.id,
    });
    const locked = await repository.listLibraryCharacters();

    expect(locked[0].lockedByCampaignId).toBe(detail.campaign.id);

    await repository.deleteCampaign(detail.campaign.id);
    const released = await repository.listLibraryCharacters();

    expect(released[0].lockedByCampaignId).toBeUndefined();
  });

  it("removes deleted campaigns from the resume list", async () => {
    const repository = new BrowserRepository();
    await repository.init();
    const detail = await bootstrapCampaign(repository, {
      title: "待删除战役",
      premise: "测试开局",
      rulesetId: "light-rules-v1",
      characterConcept: "测试角色",
    });

    await repository.deleteCampaign(detail.campaign.id);

    expect(await repository.listCampaigns()).toHaveLength(0);
    expect(await repository.getCampaignDetail(detail.campaign.id)).toBeUndefined();
  });

  it("releases legacy library locks by campaign id even without sourceCharacterId", async () => {
    const repository = new BrowserRepository();
    await repository.init();
    const libraryCharacter = {
      ...toLibraryEntry(createEmptyCharacter("light-rules-v1", "旧锁角色"), "manual"),
      lockedByCampaignId: "legacy-campaign",
      lockedByCampaignTitle: "旧战役",
      lockedAt: "2026-01-01T00:00:00.000Z",
    };
    await repository.saveLibraryCharacter(libraryCharacter);

    await repository.releaseLibraryCharactersLockedByCampaign("legacy-campaign");
    const released = await repository.listLibraryCharacters();

    expect(released[0].lockedByCampaignId).toBeUndefined();
    expect(released[0].lockedByCampaignTitle).toBeUndefined();
  });

  it("persists NPC characters and removes them with the campaign", async () => {
    const repository = new BrowserRepository();
    await repository.init();
    const detail = await bootstrapCampaign(repository, {
      title: "NPC 战役",
      premise: "测试开局",
      rulesetId: "light-rules-v1",
      characterConcept: "测试角色",
    });
    const npc: NpcCharacter = {
      ...createEmptyCharacter("light-rules-v1", "港口守卫"),
      id: "npc_guard",
      name: "守卫",
      campaignId: detail.campaign.id,
      kind: "npc",
      isActive: true,
      createdBy: "GM",
    };

    await repository.saveNpcCharacter(npc);
    expect(
      (await repository.listNpcCharacters(detail.campaign.id)).some(
        (item) => item.id === npc.id,
      ),
    ).toBe(true);

    await repository.saveNpcCharacter({ ...npc, notes: "已经被 GM 更新。" });
    const updated = await repository.getCampaignDetail(detail.campaign.id);
    expect(updated?.npcs.find((item) => item.id === npc.id)?.notes).toBe(
      "已经被 GM 更新。",
    );

    await repository.deleteCampaign(detail.campaign.id);
    expect(await repository.listNpcCharacters(detail.campaign.id)).toHaveLength(0);
  });

  it("accepts exact private chat targets and rejects manual aliases", async () => {
    const repository = new BrowserRepository();
    await repository.init();
    const detail = await bootstrapCampaign(repository, {
      title: "私聊战役",
      premise: "测试开局",
      rulesetId: "light-rules-v1",
      characterConcept: "测试角色",
    });

    const targetNpc = detail.npcs[0];
    const updated = await playTurn(
      repository,
      detail,
      `@${targetNpc.name} 我低声询问线索。`,
      defaultAiSettings,
    );

    expect(updated.events[0].eventType).toBe("private_chat_attempt");
    await expect(
      playTurn(repository, detail, "@队友 我低声询问线索。", defaultAiSettings),
    ).rejects.toThrow("不是当前可交流对象");
  });
});
