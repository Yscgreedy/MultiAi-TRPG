import type { AiAgentConfig, CharacterCard, CharacterCreationSession, NpcCharacter } from "@/types";
import { createEmptyCharacter, normalizeGeneratedCharacter } from "@/lib/rulesets";
import { createId, nowIso } from "@/lib/id";
import type { AiTurnInput, AiToolRuntime, CharacterCreationRunContext, ChatCompletionTool, ChatCompletionToolCall } from "./types";
import { clampInteger, parseToolArguments, rollDice } from "./utils";
import { createBlankCharacterCreationDraft } from "./character-draft";

const DEFAULT_NPC_AVATARS = [
  "/avatars/npc-default-male.png",
  "/avatars/npc-default-female.png",
];

export function buildToolsForTurn(
  agent: AiAgentConfig,
  input: AiTurnInput,
): ChatCompletionTool[] {
  if (!input.toolRuntime) {
    return [];
  }
  if (input.toolRuntime.mode === "npc" || input.npc) {
    return [getCharacterCardTool()];
  }
  if (agent.role !== "GM") {
    return [];
  }
  return [
    rollDiceTool(),
    getCharacterCardTool(),
    updateCharacterCardTool(),
    createNpcTool(),
    searchRecordsTool(),
  ];
}

export function buildCharacterCreationTools(): ChatCompletionTool[] {
  return [
    rollDiceTool(),
    getCreationCharacterCardTool(),
    updateCreationCharacterCardTool(),
    resetCreationCharacterCardTool(),
  ];
}

function getCreationCharacterCardTool(): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "get_creation_character_card",
      description: "Read the current player character creation draft.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  };
}

function updateCreationCharacterCardTool(): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "update_creation_character_card",
      description:
        "Patch the current player character creation draft. The result is normalized immediately.",
      parameters: {
        type: "object",
        properties: {
          patch: { type: "object" },
        },
        required: ["patch"],
        additionalProperties: false,
      },
    },
  };
}

function resetCreationCharacterCardTool(): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "reset_creation_character_card",
      description:
        "Reset the current player character creation draft to the selected character sheet template defaults.",
      parameters: {
        type: "object",
        properties: {
          concept: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  };
}

function rollDiceTool(): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "roll_dice",
      description:
        "Roll a number of same-sided dice and return every point plus the total.",
      parameters: {
        type: "object",
        properties: {
          sides: { type: "integer", minimum: 2, maximum: 100 },
          count: { type: "integer", minimum: 1, maximum: 20 },
        },
        required: ["sides", "count"],
        additionalProperties: false,
      },
    },
  };
}

function getCharacterCardTool(): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "get_character_card",
      description:
        "Read the player card, a named NPC card, or the current NPC's own card.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "player, self, or an NPC name/id",
          },
        },
        required: ["target"],
        additionalProperties: false,
      },
    },
  };
}

function updateCharacterCardTool(): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "update_character_card",
      description:
        "Update the player or NPC character card with a partial patch.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "player or an NPC name/id" },
          patch: { type: "object" },
        },
        required: ["target", "patch"],
        additionalProperties: false,
      },
    },
  };
}

function createNpcTool(): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "create_npc",
      description:
        "Create a persistent NPC character for the current campaign.",
      parameters: {
        type: "object",
        properties: {
          seed: {
            type: "object",
            properties: {
              name: { type: "string" },
              concept: { type: "string" },
              background: { type: "string" },
            },
          },
          card: { type: "object" },
        },
        additionalProperties: false,
      },
    },
  };
}

function searchRecordsTool(): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "search_records",
      description:
        "Search past game messages/records by keyword. Returns matching messages sorted by recency.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Keyword or phrase to search for in past records",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 20,
            description: "Max number of results (default 5)",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  };
}

export async function executeAiTool(
  toolCall: ChatCompletionToolCall,
  input: AiTurnInput,
): Promise<unknown> {
  const runtime = input.toolRuntime;
  if (!runtime) {
    throw new Error("AI 工具运行时尚未配置。");
  }
  const args = parseToolArguments(toolCall.function.arguments);
  let result: unknown;
  if (toolCall.function.name === "roll_dice") {
    assertGmTool(runtime, toolCall.function.name);
    const sides = clampInteger(args.sides, 2, 100, 20);
    const count = clampInteger(args.count, 1, 20, 1);
    result = rollDice(count, sides);
  } else if (toolCall.function.name === "get_character_card") {
    result = resolveCharacterTarget(
      String(args.target ?? "self"),
      input,
      runtime,
    );
  } else if (toolCall.function.name === "update_character_card") {
    assertGmTool(runtime, toolCall.function.name);
    const target = String(args.target ?? "");
    const patch =
      typeof args.patch === "object" && args.patch ? args.patch : {};
    result = await updateCharacterTarget(
      target,
      patch as Partial<CharacterCard>,
      input,
      runtime,
    );
  } else if (toolCall.function.name === "create_npc") {
    assertGmTool(runtime, toolCall.function.name);
    result = await createNpcFromTool(args, input, runtime);
  } else if (toolCall.function.name === "search_records") {
    assertGmTool(runtime, toolCall.function.name);
    result = await searchRecords(args, runtime);
  } else {
    throw new Error(`未知 AI 工具：${toolCall.function.name}`);
  }
  runtime.onToolResult?.({ toolName: toolCall.function.name, result });
  return result;
}

export async function executeCharacterCreationTool(
  toolCall: ChatCompletionToolCall,
  session: CharacterCreationSession,
  context: CharacterCreationRunContext,
): Promise<unknown> {
  const args = parseToolArguments(toolCall.function.arguments);
  let result: unknown;
  if (toolCall.function.name === "roll_dice") {
    const sides = clampInteger(args.sides, 2, 100, 20);
    const count = clampInteger(args.count, 1, 20, 1);
    result = rollDice(count, sides);
  } else if (toolCall.function.name === "get_creation_character_card") {
    result = context.draft;
  } else if (toolCall.function.name === "update_creation_character_card") {
    const patch =
      typeof args.patch === "object" && args.patch ? args.patch : {};
    context.draft = normalizeGeneratedCharacter(
      { ...context.draft, ...(patch as Partial<CharacterCard>) },
      session.rulesetId,
      session.characterType,
    );
    result = context.draft;
  } else if (toolCall.function.name === "reset_creation_character_card") {
    context.draft = createBlankCharacterCreationDraft(
      session.rulesetId,
      session.characterType,
      {
        concept:
          typeof args.concept === "string" && args.concept.trim()
            ? args.concept.trim()
            : "",
      },
    );
    result = context.draft;
  } else {
    throw new Error(`未知制卡工具：${toolCall.function.name}`);
  }
  context.toolResults.push({
    toolName: toolCall.function.name,
    result,
    createdAt: nowIso(),
  });
  return result;
}

function assertGmTool(runtime: AiToolRuntime, toolName: string): void {
  if (runtime.mode !== "gm") {
    throw new Error(`当前 AI 无权调用 ${toolName}。`);
  }
}

function resolveCharacterTarget(
  target: string,
  input: AiTurnInput,
  runtime: AiToolRuntime,
): CharacterCard | NpcCharacter | undefined {
  const normalized = target.trim().toLowerCase();
  if (runtime.mode === "npc") {
    if (
      normalized &&
      normalized !== "self" &&
      normalized !== input.npc?.id.toLowerCase()
    ) {
      throw new Error("NPC 只能检查自己的角色卡。");
    }
    return input.npc;
  }
  if (normalized === "player" || normalized === "玩家") {
    return runtime.getPlayerCharacter();
  }
  return runtime.getNpc(target);
}

async function updateCharacterTarget(
  target: string,
  patch: Partial<CharacterCard>,
  input: AiTurnInput,
  runtime: AiToolRuntime,
): Promise<CharacterCard | NpcCharacter> {
  const current = resolveCharacterTarget(target, input, runtime);
  if (!current) {
    throw new Error(`找不到角色卡：${target}`);
  }
  const normalized = normalizeGeneratedCharacter(
    { ...current, ...patch },
    current.rulesetId,
    current.characterType,
  );
  if ("kind" in current && current.kind === "npc") {
    const updated: NpcCharacter = {
      ...current,
      ...normalized,
      campaignId: current.campaignId,
      kind: "npc",
      isActive: current.isActive,
      createdBy: current.createdBy,
      updatedAt: nowIso(),
    };
    await runtime.saveNpc(updated);
    return updated;
  }
  await runtime.savePlayerCharacter(normalized);
  return normalized;
}

async function createNpcFromTool(
  args: Record<string, unknown>,
  input: AiTurnInput,
  runtime: AiToolRuntime,
): Promise<NpcCharacter> {
  const cardInput =
    typeof args.card === "object" && args.card
      ? args.card
      : typeof args.seed === "object" && args.seed
        ? args.seed
        : {};
  const seed = cardInput as Partial<CharacterCard>;
  const base = createEmptyCharacter(
    input.detail.campaign.rulesetId,
    seed.concept || "战役中的新 NPC",
    input.detail.character?.characterType,
  );
  const card = normalizeGeneratedCharacter(
    {
      ...base,
      ...seed,
      id: createId("npc"),
      name: seed.name || "未命名 NPC",
      concept: seed.concept || base.concept,
      background: seed.background || base.background,
    },
    input.detail.campaign.rulesetId,
    input.detail.character?.characterType,
  );
  const npc: NpcCharacter = {
    ...card,
    campaignId: input.detail.campaign.id,
    kind: "npc",
    isActive: true,
    createdBy: "GM",
    avatarUrl:
      card.avatarUrl ??
      DEFAULT_NPC_AVATARS[
        input.detail.npcs.length % DEFAULT_NPC_AVATARS.length
      ],
    updatedAt: nowIso(),
  };
  await runtime.createNpc(npc);
  return npc;
}

async function searchRecords(
  args: Record<string, unknown>,
  runtime: AiToolRuntime,
): Promise<{
  query: string;
  results: Array<{ author: string; content: string; createdAt: string }>;
}> {
  const query = String(args.query ?? "").trim();
  if (!query) {
    throw new Error("search_records 需要提供 query 参数。");
  }
  if (!runtime.searchMessages) {
    throw new Error("当前环境不支持搜索记录。");
  }
  const limit = clampInteger(args.limit, 1, 20, 5);
  const messages = await runtime.searchMessages(query, limit);
  return {
    query,
    results: messages.map((message) => ({
      author: message.authorLabel ?? message.author,
      content: message.content.slice(0, 500),
      createdAt: message.createdAt,
    })),
  };
}
