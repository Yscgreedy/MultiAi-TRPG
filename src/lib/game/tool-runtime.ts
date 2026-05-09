import type { AiToolExecutionResult, AiToolRuntime } from "@/lib/ai";
import type { CampaignDetail, NpcCharacter } from "@/types";
import type { GameRepository } from "@/lib/storage";

export function createToolRuntime(
  repository: GameRepository,
  detail: CampaignDetail,
  mode: AiToolRuntime["mode"],
  npc?: NpcCharacter,
  toolResults?: AiToolExecutionResult[],
): AiToolRuntime {
  let playerCharacter = detail.character;
  const npcs = [...detail.npcs];
  return {
    mode,
    getPlayerCharacter: () => playerCharacter,
    savePlayerCharacter: async (character) => {
      playerCharacter = character;
      await repository.saveCharacter(detail.campaign.id, character);
    },
    listNpcs: () => npcs,
    getNpc: (target) =>
      npcs.find((item) => item.id === target || item.name === target) ??
      (npc && (target === "self" || target === npc.id || target === npc.name)
        ? npc
        : undefined),
    saveNpc: async (updatedNpc) => {
      const index = npcs.findIndex((item) => item.id === updatedNpc.id);
      if (index >= 0) {
        npcs[index] = updatedNpc;
      } else {
        npcs.push(updatedNpc);
      }
      await repository.saveNpcCharacter(updatedNpc);
    },
    createNpc: async (createdNpc) => {
      npcs.push(createdNpc);
      detail.npcs.push(createdNpc);
      await repository.saveNpcCharacter(createdNpc);
    },
    searchMessages: async (query, limit) =>
      repository.searchMessages(detail.campaign.id, query, limit),
    onToolResult: toolResults
      ? (result) => {
          toolResults.push(result);
        }
      : undefined,
  };
}

export function findNpcForAgent(
  agent: { label: string; role: string },
  npcs: NpcCharacter[],
): NpcCharacter | undefined {
  if (agent.role !== "Companion") {
    return undefined;
  }
  return npcs.find((npc) => npc.name === agent.label || npc.id === agent.label);
}

