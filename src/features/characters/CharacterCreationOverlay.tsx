import { BotIcon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import type { CharacterCreationSession } from "@/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownMessage } from "@/features/game/GameConsole";

export function CharacterCreationOverlay({
  title,
  subtitle,
  busy,
  session,
  input,
  onInputChange,
  onStart,
  onSend,
  onFinalize,
  onReset,
  onClose,
}: {
  title: string;
  subtitle: string;
  busy: boolean;
  session: CharacterCreationSession | null;
  input: string;
  onInputChange: (value: string) => void;
  onStart: () => void;
  onSend: () => void;
  onFinalize: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const draft = session?.draft;
  return (
    <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm">
      <div className="flex h-full min-h-0 flex-col">
        <header className="border-b bg-background/95 px-6 py-4">
          <div className="mx-auto flex max-w-7xl items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold">{title}</h2>
              <p className="text-sm text-muted-foreground">
                {subtitle} · 通过对话确定设定，数值由 GM 按模板和规则自动处理。
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={onStart} disabled={busy}>
                <RefreshCwIcon data-icon="inline-start" />
                {session ? "重开" : "开始"}
              </Button>
              {session && (
                <Button variant="ghost" onClick={onReset} disabled={busy}>
                  清空
                </Button>
              )}
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                返回
              </Button>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden px-6 py-4">
          <div className="mx-auto grid h-full max-w-7xl gap-4 lg:grid-cols-[minmax(0,1.2fr)_380px]">
            {!session ? (
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>尚未开始制卡</CardTitle>
                  <CardDescription>
                    点击“开始”后，GM 会读取当前规则书、RAG 片段和角色卡模板。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button onClick={onStart} disabled={busy}>
                    <SparklesIcon data-icon="inline-start" />
                    开始 GM 制卡
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                <Card className="min-h-0 overflow-hidden">
                  <CardHeader>
                    <CardTitle>制卡对话</CardTitle>
                    <CardDescription>
                      直接描述角色想法，GM 会在需要时投骰并维护草稿。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex h-[calc(100vh-190px)] min-h-0 flex-col gap-3">
                    <ScrollArea className="min-h-0 flex-1 pr-3">
                      <div className="flex flex-col gap-3">
                        {session.messages.map((message) => (
                          <div
                            key={message.id}
                            className={
                              message.author === "player"
                                ? "ml-auto max-w-[82%] rounded-md bg-primary px-4 py-3 text-primary-foreground"
                                : "mr-auto max-w-[88%] rounded-md border bg-card px-4 py-3"
                            }
                          >
                            <div className="mb-1 text-[11px] opacity-70">
                              {message.author === "player" ? "玩家" : "制卡 GM"}
                            </div>
                            <div className="text-sm leading-6">
                              {message.content ? (
                                <MarkdownMessage content={message.content} />
                              ) : (
                                <span className="text-muted-foreground">生成中...</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                    <div className="grid gap-2 border-t pt-3">
                      <Textarea
                        value={input}
                        placeholder="告诉 GM 你的角色想法、职业、弱点、关系或想随机的部分。"
                        className="min-h-24"
                        onChange={(event) => onInputChange(event.target.value)}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={onSend} disabled={busy || !input.trim()}>
                          <BotIcon data-icon="inline-start" />
                          发送给 GM
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={onFinalize}
                          disabled={
                            busy ||
                            !session.messages.some((message) => message.author === "player")
                          }
                        >
                          <SparklesIcon data-icon="inline-start" />
                          生成最终角色卡
                        </Button>
                        {session.status === "completed" && (
                          <Badge variant="secondary">已完成</Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="min-h-0 overflow-hidden">
                  <CardHeader>
                    <CardTitle>草稿预览</CardTitle>
                    <CardDescription>工具调用：{session.toolResults.length} 次</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {draft ? (
                      <ScrollArea className="h-[calc(100vh-210px)] pr-3">
                        <div className="grid gap-4 text-sm">
                          <div>
                            <div className="mb-1 text-xs text-muted-foreground">姓名</div>
                            <div className="font-medium">{draft.name}</div>
                          </div>
                          <div>
                            <div className="mb-1 text-xs text-muted-foreground">概念</div>
                            <div>{draft.concept}</div>
                          </div>
                          <div>
                            <div className="mb-1 text-xs text-muted-foreground">属性</div>
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(draft.attributes).map(([key, value]) => (
                                <Badge key={key} variant="secondary">
                                  {key} {value}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 text-xs text-muted-foreground">技能</div>
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(draft.skills).map(([key, value]) => (
                                <Badge key={key} variant="outline">
                                  {key} {value}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          {draft.background && (
                            <div>
                              <div className="mb-1 text-xs text-muted-foreground">背景</div>
                              <MarkdownMessage content={draft.background} />
                            </div>
                          )}
                          {draft.notes && (
                            <div>
                              <div className="mb-1 text-xs text-muted-foreground">备注</div>
                              <MarkdownMessage content={draft.notes} />
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                    ) : (
                      <Alert>
                        <BotIcon />
                        <AlertTitle>暂无草稿</AlertTitle>
                        <AlertDescription>开始制卡后会显示当前角色草稿。</AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

