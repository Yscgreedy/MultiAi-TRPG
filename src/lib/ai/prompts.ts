import type { AiAgentConfig, CharacterCard, GameMessage } from "@/types";
import { getRuleset } from "@/lib/rulesets";
import gmPrompt from "@/prompts/gm.md?raw";
import rulesJudgePrompt from "@/prompts/rules-judge.md?raw";
import archivistPrompt from "@/prompts/archivist.md?raw";
import companionPrompt from "@/prompts/companion.md?raw";
import npcPrompt from "@/prompts/npc.md?raw";
import type { AiTurnInput, ChatMessage } from "./types";

export function recentMessages(messages: GameMessage[], max?: number): string[] {
  const sliced = max && max > 0 ? messages.slice(-max) : messages;
  return sliced.map(
    (message) => `${message.authorLabel ?? message.author}: ${message.content}`,
  );
}

export function buildAgentMessages(
  agent: AiAgentConfig,
  input: AiTurnInput,
): ChatMessage[] {
  const { campaign, character } = input.detail;
  const ruleset = getRuleset(campaign.rulesetId);
  const messageLimit =
    input.settings.gmFullContext && agent.role === "GM" ? 0 : 8;
  const recent = recentMessages(input.detail.messages, messageLimit);
  const npcs = input.detail.npcs ?? [];
  const npcLines = npcs.length
    ? npcs.map((npc) => `${npc.name}：${npc.concept}`).join("\n")
    : "暂无";
  const sharedContext = [
    `玩家行动：${input.playerAction}`,
    `规则：${ruleset.diceExpression}`,
    `角色：${character?.name ?? "未绑定角色"} - ${character?.concept ?? "未知概念"}`,
    `战役 NPC：${npcLines}`,
    input.npc
      ? `你当前扮演的 NPC 角色卡：${formatCharacterForPrompt(input.npc)}`
      : "",
    `战役摘要：${campaign.summary || "暂无摘要"}`,
    `世界状态：${campaign.worldState || "暂无世界状态"}`,
    agent.role === "GM" && input.hiddenRulesAdvice
      ? `规则裁判建议（仅 GM 可见，不要逐字公开）：${input.hiddenRulesAdvice}`
      : "",
    `近期记录：${recent.join("\n") || "暂无"}`,
  ]
    .filter(Boolean)
    .join("\n");
  const rolePrompt = buildRolePrompt(agent, input, sharedContext);
  const privateChatPrompt = input.privateChat
    ? [
        `玩家正在尝试发起私聊：@${input.privateChat.raw}。`,
        `被交流对象：${input.privateChat.agent.label}（${input.privateChat.agent.role}）。`,
        agent.role === "GM"
          ? [
              "你只判断这轮私聊是否在当前场景中成立，包括距离、时机、目标态度、风险和可能代价。",
              "不要替被交流对象说话、报价、解释能力或输出台词。",
              "如果对象可以回应，只写清场景约束，并用 @对象名 点名让该 NPC 自己回应。",
            ].join("\n")
          : agent.role === input.privateChat.agent.role
            ? "你是被私聊对象。你需要和 GM 的场景约束共同决定是否回应，以及回应的边界。"
            : "你不是本轮私聊参与者，保持沉默。",
        "如果私聊不成立，只说明原因和当前阻碍，不要追问玩家后续行动。",
      ].join("\n")
    : "";

  return [
    {
      role: "system",
      content: [
        `你是“${agent.label}”（${agent.role}）。`,
        roleTemplate(agent, input),
        agent.systemPrompt,
        "你参与的是一个一个真人玩家 + 多 AI 协作的跑团游戏。",
        "严格保持自己的身份边界，不要代替其他 AI 的职责。",
        "只有 GM 可以推进场景、添加环境细节、安排 NPC 行动或给出剧情后果。",
        agent.role === "GM"
          ? "GM 不能替玩家或 NPC 输出直接引语；需要 NPC 发言时，只用 @NPC名称 触发它自己的回复。"
          : "",
        agent.role === "GM"
          ? "规则裁判建议是 GM 私有参考；只把必要判定自然转化为场景反馈，不要公开规裁全文。"
          : "",
        "保持中文输出，避免替玩家决定行动。",
        "如果你的身份本轮没有需要参与的内容，直接返回空内容；不要写“无”“不参与”或括号说明。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [privateChatPrompt, rolePrompt].filter(Boolean).join("\n\n"),
    },
  ];
}

function roleTemplate(agent: AiAgentConfig, input: AiTurnInput): string {
  if (input.npc) {
    return npcPrompt;
  }
  if (agent.role === "GM") {
    return gmPrompt;
  }
  if (agent.role === "Companion") {
    return companionPrompt;
  }
  if (agent.role === "RulesJudge") {
    return rulesJudgePrompt;
  }
  return archivistPrompt;
}

export function formatCharacterForPrompt(character: CharacterCard): string {
  return [
    `${character.name} - ${character.concept}`,
    `背景：${character.background}`,
    `属性：${JSON.stringify(character.attributes)}`,
    `技能：${JSON.stringify(character.skills)}`,
    `物品：${character.inventory.join("、") || "无"}`,
    `羁绊：${character.bonds.join("、") || "无"}`,
    `状态：${character.conditions.join("、") || "状态良好"}`,
    `备注：${character.notes || "无"}`,
  ].join("\n");
}

function buildRolePrompt(
  agent: AiAgentConfig,
  input: AiTurnInput,
  sharedContext: string,
): string {
  const ruleset = getRuleset(input.detail.campaign.rulesetId);

  if (agent.role === "GM") {
    return [
      "你的职责：作为唯一主持人推进场景，回应玩家行动，给出后果和风险。",
      "不要替任何 NPC 说台词、解释其能力或作出第一人称回应；如果需要 NPC 回答，使用 @NPC名称 点名。",
      input.hiddenRulesAdvice
        ? `规则裁判建议（仅 GM 可见，不要逐字公开）：${input.hiddenRulesAdvice}`
        : "",
      ruleset.buildActionPrompt({
        playerAction: input.playerAction,
        summary: input.detail.campaign.summary,
        worldState: input.detail.campaign.worldState,
        character: input.detail.character,
        recentMessages: recentMessages(input.detail.messages),
      }),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (agent.role === "Companion") {
    if (input.npc) {
      return [
        "你的职责：只扮演当前指定的战役 NPC。",
        "不要代替 GM 推进全局场景；只回应自己知道和会做的事。",
        sharedContext,
      ].join("\n\n");
    }
    return [
      "你的职责：只扮演一名同行角色。你可以表达提醒、疑问、情绪反应或短建议。",
      "禁止描写环境细节、揭示新线索、裁定判定、推进剧情或替 GM 给出后果。",
      "如果当前场景没有明确需要队友开口，返回空内容。",
      sharedContext,
    ].join("\n\n");
  }

  if (agent.role === "RulesJudge") {
    return [
      "你的职责：只做规则裁判。只说明是否需要判定、建议使用的属性/技能、骰子表达式、成功区间和失败代价。",
      "禁止叙事描写、禁止添加新线索、禁止扮演 NPC、禁止推进场景。",
      "如果当前行动不需要规则解释或判定，返回空内容。",
      input.rulesContext ? `规则书检索片段：\n${input.rulesContext}` : "",
      sharedContext,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    "你的职责：只做世界记录员。提取本轮已经确认的事实、状态变化、未解决线索或需要写入摘要的事项。",
    "禁止叙事描写、禁止添加新事实、禁止给玩家行动建议、禁止推进场景。",
    "如果本轮没有新的稳定事实需要记录，返回空内容。",
    sharedContext,
  ].join("\n\n");
}

