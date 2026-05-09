import type {
  AiAgentConfig,
  AiRole,
  AiSettings,
  CampaignDetail,
  CharacterCard,
  CharacterCreationToolResult,
  GameMessage,
  NpcCharacter,
} from "@/types";

export interface AiTurnInput {
  detail: CampaignDetail;
  playerAction: string;
  settings: AiSettings;
  privateChat?: PrivateChatTarget;
  npc?: NpcCharacter;
  toolRuntime?: AiToolRuntime;
  hiddenRulesAdvice?: string;
  rulesContext?: string;
}

export interface AiTurnOutput {
  role: AiRole;
  label: string;
  content: string;
}

export interface PrivateChatTarget {
  raw: string;
  agent: AiAgentConfig;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: ChatCompletionToolCall[];
}

export interface ChatCompletionToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AiToolRuntime {
  mode: "gm" | "npc";
  getPlayerCharacter(): CharacterCard | undefined;
  savePlayerCharacter(character: CharacterCard): Promise<void>;
  listNpcs(): NpcCharacter[];
  getNpc(target: string): NpcCharacter | undefined;
  saveNpc(npc: NpcCharacter): Promise<void>;
  createNpc(npc: NpcCharacter): Promise<void>;
  searchMessages?(query: string, limit?: number): Promise<GameMessage[]>;
  onToolResult?: (result: AiToolExecutionResult) => void;
}

export interface AiToolExecutionResult {
  toolName: string;
  result: unknown;
}

export interface CharacterCreationRunContext {
  draft: CharacterCard;
  toolResults: CharacterCreationToolResult[];
}
