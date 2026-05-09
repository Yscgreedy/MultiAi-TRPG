import { memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArchiveIcon, BotIcon, Dice5Icon, LockIcon, SparklesIcon, UserIcon } from "lucide-react";
import type { AiAgentConfig, CampaignDetail, CharacterCard, GameMessage } from "@/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { diceExpressions, maxVisiblePlayMessages, type DiceRollResult } from "@/features/common/app-ui";

export function GameConsole({
  detail,
  busy,
  streamingMessageIds,
  communicableAgents,
  playerAction,
  proxyMode,
  proxyOptions,
  generatingProxyOptions,
  onActionChange,
  onProxyModeChange,
  onGenerateProxyOptions,
  onAcceptProxyOption,
  onPlayTurn,
}: {
  detail: CampaignDetail;
  busy: boolean;
  streamingMessageIds: Set<string>;
  communicableAgents: AiAgentConfig[];
  playerAction: string;
  proxyMode: boolean;
  proxyOptions: string[];
  generatingProxyOptions: boolean;
  onActionChange: (value: string) => void;
  onProxyModeChange: (value: boolean) => void;
  onGenerateProxyOptions: () => void;
  onAcceptProxyOption: (value: string) => void;
  onPlayTurn: () => void;
}) {
  const [diceExpression, setDiceExpression] = useState("1d20");
  const [diceResult, setDiceResult] = useState<DiceRollResult>();
  const privateChatTarget = parsePrivateChatTarget(playerAction);
  const isPrivateChat = playerAction.trimStart().startsWith("@");
  const hasValidPrivateTarget =
    !isPrivateChat ||
    communicableAgents.some(
      (agent) => agent.label === privateChatTarget || agent.role === privateChatTarget,
    );
  const hiddenMessageCount = Math.max(0, detail.messages.length - maxVisiblePlayMessages);
  const visibleMessages =
    hiddenMessageCount > 0
      ? detail.messages.slice(-maxVisiblePlayMessages)
      : detail.messages;

  function rollDice() {
    setDiceResult(rollDiceExpression(diceExpression));
  }

  function selectPrivateTarget(target: string) {
    const body = playerAction.trimStart().replace(/^@[^\s，,：:]*\s*/, "");
    onActionChange(`@${target}${body ? ` ${body}` : " "}`);
  }

  return (
    <Tabs defaultValue="play" className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{detail.session.title}</Badge>
          <Badge variant="outline">{detail.messages.length} 条记录</Badge>
          <Badge variant="outline">{detail.npcs.length} 名 NPC</Badge>
        </div>
        <TabsList>
          <TabsTrigger value="play">游戏</TabsTrigger>
          <TabsTrigger value="character">角色卡</TabsTrigger>
          <TabsTrigger value="npcs">NPC</TabsTrigger>
          <TabsTrigger value="archive">记录</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="play" className="min-h-0 flex-1 overflow-auto xl:overflow-hidden">
        <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="flex h-full min-h-[520px] min-w-0 flex-col overflow-hidden xl:min-h-0">
            <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
              <ScrollArea className="min-h-[280px] flex-1 rounded-lg border">
                <div className="flex flex-col gap-3 p-4">
                  {hiddenMessageCount > 0 && (
                    <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-center text-xs text-muted-foreground">
                      已折叠较早的 {hiddenMessageCount} 条记录；完整内容可在“记录”页查看。
                    </div>
                  )}
                  {visibleMessages.map((message) => (
                    <MessageCard
                      key={message.id}
                      message={message}
                      detail={detail}
                      streaming={streamingMessageIds.has(message.id)}
                    />
                  ))}
                </div>
              </ScrollArea>
              <FieldGroup className="shrink-0 gap-3">
                <Field>
                  <FieldLabel htmlFor="player-action">玩家行动</FieldLabel>
                  <Textarea
                    id="player-action"
                    value={playerAction}
                    onChange={(event) => onActionChange(event.target.value)}
                    placeholder="描述你的行动。输入 @ 后从下方选择对象可尝试发起一轮私聊。"
                  />
                  {isPrivateChat && (
                    <FieldDescription>
                      选择一个可交流对象；手动输入的其它 @xxx 会被视为无效目标。
                    </FieldDescription>
                  )}
                </Field>
                {isPrivateChat && (
                  <Field>
                    <FieldLabel htmlFor="private-chat-target">私聊对象</FieldLabel>
                    <Select
                      value={hasValidPrivateTarget ? privateChatTarget : undefined}
                      onValueChange={selectPrivateTarget}
                    >
                      <SelectTrigger id="private-chat-target" className="w-full">
                        <SelectValue placeholder="选择可交流对象" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {communicableAgents.map((agent) => (
                            <SelectItem
                              key={`${agent.role}-${agent.label}`}
                              value={agent.role === "Companion" ? agent.label : agent.role}
                            >
                              {agent.role === "Companion"
                                ? agent.label
                                : `${agent.label} · ${agent.role}`}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                <Button
                  onClick={onPlayTurn}
                  disabled={busy || !playerAction.trim() || !hasValidPrivateTarget}
                >
                  <BotIcon data-icon="inline-start" />
                  推进一轮多 AI 回合
                </Button>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card className="min-h-0 overflow-hidden xl:h-full">
            <CardHeader>
              <CardTitle>侧边工具</CardTitle>
              <CardDescription>代理建议和临时判定不再占用聊天记录空间。</CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-col gap-4">
              <Field orientation="horizontal">
                <Switch checked={proxyMode} onCheckedChange={onProxyModeChange} />
                <div className="min-w-0 flex-1">
                  <FieldLabel>代理模式</FieldLabel>
                  <FieldDescription>让 AI 先给出可选行动。</FieldDescription>
                </div>
              </Field>
              <Button
                variant="outline"
                onClick={onGenerateProxyOptions}
                disabled={!proxyMode || busy || generatingProxyOptions}
              >
                <SparklesIcon data-icon="inline-start" />
                {generatingProxyOptions ? "生成中" : "生成选项"}
              </Button>
              {proxyMode && proxyOptions.length > 0 && (
                <Field className="min-h-0">
                  <FieldLabel>代理建议</FieldLabel>
                  <ScrollArea className="max-h-64 rounded-lg border">
                    <div className="flex flex-col gap-2 p-2">
                      {proxyOptions.map((option) => (
                        <Button
                          key={option}
                          variant={playerAction === option ? "secondary" : "ghost"}
                          className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
                          onClick={() => onAcceptProxyOption(option)}
                        >
                          {option}
                        </Button>
                      ))}
                    </div>
                  </ScrollArea>
                </Field>
              )}
              <Field>
                <FieldLabel>手动骰子</FieldLabel>
                <FieldDescription>
                  GM 工具掷骰会自动入事件记录；这里仅供玩家临时手动抛骰。
                </FieldDescription>
                <div className="flex gap-2">
                  <Select value={diceExpression} onValueChange={setDiceExpression}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {diceExpressions.map((expression) => (
                          <SelectItem key={expression} value={expression}>
                            {expression}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={rollDice}>
                    <Dice5Icon data-icon="inline-start" />
                    抛
                  </Button>
                </div>
                {diceResult && (
                  <Badge variant="secondary" className="w-fit">
                    {diceResult.total} · {diceResult.rolls.join(" + ")}
                  </Badge>
                )}
              </Field>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="character" className="min-h-0 flex-1">
        <ScrollArea className="h-full pr-3">
          <CharacterCardPanel character={detail.character} locked />
        </ScrollArea>
      </TabsContent>

      <TabsContent value="npcs" className="min-h-0 flex-1">
        <ScrollArea className="h-full pr-3">
          <div className="grid gap-4 lg:grid-cols-2">
            {detail.npcs.map((npc) => (
              <CharacterCardPanel key={npc.id} character={npc} locked />
            ))}
            {!detail.npcs.length && (
              <Alert>
                <UserIcon />
                <AlertTitle>暂无 NPC</AlertTitle>
                <AlertDescription>GM 使用工具创建 NPC 后，可在这里查看角色卡。</AlertDescription>
              </Alert>
            )}
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="archive" className="min-h-0 flex-1">
        <Card className="h-full min-h-0 overflow-hidden">
          <CardHeader>
            <CardTitle>事件记录</CardTitle>
            <CardDescription>用于恢复上下文和后续扩展世界年表。</CardDescription>
          </CardHeader>
          <CardContent className="min-h-0">
            <ScrollArea className="h-[calc(100vh-245px)]">
              <div className="flex flex-col gap-2 pr-3">
                {detail.events.map((event) => (
                  <div key={event.id} className="rounded-lg border p-3 text-sm">
                    <div className="mb-1 flex items-center justify-between">
                      <Badge variant="outline">{event.eventType}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(event.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <pre className="overflow-auto text-xs text-muted-foreground">
                      {JSON.stringify(event.payload, null, 2)}
                    </pre>
                  </div>
                ))}
                {!detail.events.length && (
                  <Alert>
                    <ArchiveIcon />
                    <AlertTitle>暂无事件</AlertTitle>
                    <AlertDescription>推进一轮游戏后会出现事件记录。</AlertDescription>
                  </Alert>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

const MessageCard = memo(
  function MessageCard({
    message,
    detail,
    streaming,
  }: {
    message: GameMessage;
    detail: CampaignDetail;
    streaming: boolean;
  }) {
    return (
      <div className="message-card rounded-lg border bg-card p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <MessageAuthorBadge message={message} detail={detail} />
          <span className="text-xs text-muted-foreground">
            {new Date(message.createdAt).toLocaleTimeString()}
          </span>
        </div>
        <div className="whitespace-pre-wrap text-sm leading-6">
          {streaming ? (
            <span>{message.content}</span>
          ) : (
            <MarkdownMessage content={message.content} />
          )}
        </div>
      </div>
    );
  },
  (previous, next) =>
    previous.message === next.message &&
    previous.detail.npcs === next.detail.npcs &&
    previous.streaming === next.streaming,
);

const markdownComponents = {
  p: ({ children }: { children?: ReactNode }) => (
    <span className="mb-2 block last:mb-0">{children}</span>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="my-2 list-disc pl-5">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="my-2 list-decimal pl-5">{children}</ol>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  code: ({ children }: { children?: ReactNode }) => (
    <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
  ),
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="my-2 overflow-auto rounded bg-muted p-3 text-xs">
      {children}
    </pre>
  ),
};

export const MarkdownMessage = memo(function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  );
});

function MessageAuthorBadge({
  message,
  detail,
}: {
  message: CampaignDetail["messages"][number];
  detail: CampaignDetail;
}) {
  const actor = message.actorId
    ? detail.npcs.find((npc) => npc.id === message.actorId)
    : undefined;
  return (
    <Badge variant={message.author === "player" ? "default" : "secondary"}>
      {actor && <CharacterAvatar character={actor} size="xs" />}
      {message.authorLabel ?? message.author}
    </Badge>
  );
}

function CharacterAvatar({
  character,
  size,
}: {
  character: CharacterCard;
  size: "xs" | "sm" | "lg";
}) {
  const className =
    size === "lg" ? "size-16" : size === "sm" ? "size-7" : "size-4";
  return (
    <span
      className={`${className} flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-xs font-semibold`}
    >
      {character.avatarUrl ? (
        <img
          src={character.avatarUrl}
          alt={character.name}
          className="size-full object-cover"
        />
      ) : (
        character.name.slice(0, 1) || <UserIcon />
      )}
    </span>
  );
}

export function CharacterCardPanel({
  character,
  locked = false,
}: {
  character?: CharacterCard;
  locked?: boolean;
}) {
  if (!character) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>角色卡</CardTitle>
          <CardDescription>当前战役还没有角色。</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <CharacterAvatar character={character} size="lg" />
            <div className="min-w-0">
              <CardTitle>{character.name}</CardTitle>
              <CardDescription>{character.concept}</CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {locked && (
              <Badge variant="outline">
                <LockIcon />
                战役锁定
              </Badge>
            )}
            <Badge variant="secondary">{character.rulesetId}</Badge>
          </div>
        </div>
        {locked && (
          <CardDescription>
            战役角色卡只读；要更换或调整角色，请在角色卡页面维护角色库后新建战役。
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm leading-6 text-muted-foreground">{character.background}</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Object.entries(character.attributes).map(([key, value]) => (
            <div key={key} className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{key}</div>
              <div className="text-2xl font-semibold">{value}</div>
            </div>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <InfoList title="技能" items={Object.entries(character.skills).map(([k, v]) => `${k} +${v}`)} />
          <InfoList title="物品" items={character.inventory} />
          <InfoList title="羁绊" items={character.bonds} />
          <InfoList title="状态" items={character.conditions.length ? character.conditions : ["状态良好"]} />
        </div>
        <p className="rounded-lg border p-3 text-sm text-muted-foreground">
          {character.notes || "暂无备注。"}
        </p>
      </CardContent>
    </Card>
  );
}

function InfoList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="text-sm font-medium">{title}</div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <Badge key={item} variant="outline">
            {item}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function parsePrivateChatTarget(action: string): string {
  return action.trimStart().match(/^@([^\s，,：:]*)/)?.[1] ?? "";
}

function rollDiceExpression(expression: string): DiceRollResult {
  const match = expression.match(/^(\d+)d(\d+)$/);
  if (!match) {
    return { expression, rolls: [], total: 0 };
  }

  const count = Number(match[1]);
  const sides = Number(match[2]);
  const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
  return {
    expression,
    rolls,
    total: rolls.reduce((sum, value) => sum + value, 0),
  };
}
