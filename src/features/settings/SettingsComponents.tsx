import { useState } from "react";
import { ChevronDownIcon, DatabaseIcon, ExternalLinkIcon, PlayIcon, PlusIcon, RefreshCwIcon, SaveIcon, SettingsIcon, Trash2Icon, UserIcon } from "lucide-react";
import type { AiProviderConfig, AiSettings } from "@/types";
import type { PineconeUsageEvent } from "@/lib/rag";
import { mergeSettings } from "@/lib/game";
import { createId } from "@/lib/id";
import { formatModelValue, parseModelValue } from "@/lib/ai";
import { PINECONE_USAGE_URL } from "@/lib/pinecone";
import type { AppPreferences, ProviderStatus, ThemeMode, AccentColor } from "@/lib/ui-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { accentOptions } from "@/features/common/app-ui";

export function SettingsPage({
  preferences,
  onChange,
}: {
  preferences: AppPreferences;
  onChange: (preferences: AppPreferences) => void;
}) {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-2 pr-10">
        <h2 className="text-xl font-semibold">应用设置</h2>
        <p className="text-sm text-muted-foreground">
          调整界面主题、显示密度和玩家资料。AI provider 与模型在右上角“AI 设置”中配置。
        </p>
      </div>
      <AppPreferencesForm preferences={preferences} onChange={onChange} />
    </div>
  );
}

function AppPreferencesForm({
  preferences,
  onChange,
}: {
  preferences: AppPreferences;
  onChange: (preferences: AppPreferences) => void;
}) {
  async function handleAvatarFile(file: File | undefined) {
    if (!file) {
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    onChange({ ...preferences, avatarUrl: dataUrl });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <div className="flex flex-col items-center gap-3 rounded-lg border p-4">
        <AvatarPreview preferences={preferences} size="lg" />
        <div className="text-center">
          <div className="font-medium">{preferences.displayName}</div>
          <div className="text-sm text-muted-foreground">本地玩家资料</div>
        </div>
      </div>
      <FieldGroup>
        <FieldSet>
          <FieldLabel>外观</FieldLabel>
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="theme-mode">主题模式</FieldLabel>
              <Select
                value={preferences.themeMode}
                onValueChange={(themeMode) =>
                  onChange({ ...preferences, themeMode: themeMode as ThemeMode })
                }
              >
                <SelectTrigger id="theme-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="system">跟随系统</SelectItem>
                    <SelectItem value="light">浅色</SelectItem>
                    <SelectItem value="dark">深色</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="accent-color">主题色</FieldLabel>
              <Select
                value={preferences.accentColor}
                onValueChange={(accentColor) =>
                  onChange({
                    ...preferences,
                    accentColor: accentColor as AccentColor,
                  })
                }
              >
                <SelectTrigger id="accent-color" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {accentOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field orientation="horizontal">
            <Switch
              checked={preferences.compactMode}
              onCheckedChange={(compactMode) =>
                onChange({ ...preferences, compactMode })
              }
            />
            <div>
              <FieldLabel>紧凑界面</FieldLabel>
              <FieldDescription>减少部分卡片内边距，适合小屏幕或窗口化使用。</FieldDescription>
            </div>
          </Field>
        </FieldSet>
        <FieldSet>
          <FieldLabel>玩家资料</FieldLabel>
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="display-name">昵称</FieldLabel>
              <Input
                id="display-name"
                value={preferences.displayName}
                onChange={(event) =>
                  onChange({ ...preferences, displayName: event.target.value })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="avatar-text">头像文字</FieldLabel>
              <Input
                id="avatar-text"
                value={preferences.avatarText}
                maxLength={2}
                onChange={(event) =>
                  onChange({ ...preferences, avatarText: event.target.value })
                }
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="avatar-url">头像 URL</FieldLabel>
            <Input
              id="avatar-url"
              value={preferences.avatarUrl}
              placeholder="可选，留空时显示头像文字"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) =>
                onChange({ ...preferences, avatarUrl: event.target.value })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="avatar-file">本地头像图片</FieldLabel>
            <Input
              id="avatar-file"
              type="file"
              accept="image/*"
              onChange={(event) => void handleAvatarFile(event.target.files?.[0])}
            />
            <FieldDescription>
              选择后会以本地数据形式保存到应用偏好中，不依赖原文件路径。
            </FieldDescription>
          </Field>
        </FieldSet>
      </FieldGroup>
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取头像图片失败"));
    reader.readAsDataURL(file);
  });
}

export function AvatarPreview({
  preferences,
  size,
}: {
  preferences: AppPreferences;
  size: "sm" | "lg";
}) {
  const className =
    size === "lg"
      ? "flex size-24 items-center justify-center overflow-hidden rounded-lg border bg-primary text-3xl font-semibold text-primary-foreground"
      : "flex size-8 items-center justify-center overflow-hidden rounded-lg border bg-primary text-sm font-semibold text-primary-foreground";

  if (preferences.avatarUrl.trim()) {
    return (
      <div className={className}>
        <img
          src={preferences.avatarUrl}
          alt={preferences.displayName}
          className="size-full object-cover"
        />
      </div>
    );
  }

  return (
    <div className={className}>
      {preferences.avatarText || <UserIcon />}
    </div>
  );
}

export function SettingsSheet({
  settings,
  busy,
  pineconeUsage,
  fetchingProviderId,
  testingProviderId,
  providerStatuses,
  onChange,
  onSave,
  onFetchProviderModels,
  onTestProvider,
}: {
  settings?: AiSettings;
  busy: boolean;
  pineconeUsage?: PineconeUsageEvent;
  fetchingProviderId?: string;
  testingProviderId?: string;
  providerStatuses: Record<string, ProviderStatus>;
  onChange: (settings: AiSettings) => void;
  onSave: () => void;
  onFetchProviderModels: (providerId: string) => void;
  onTestProvider: (providerId: string) => void;
}) {
  if (!settings) {
    return null;
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          <SettingsIcon data-icon="inline-start" />
          AI 设置
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[420px] sm:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>OpenAI-compatible API</SheetTitle>
          <SheetDescription>配置 base URL、密钥和各 AI 角色模型。</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1 px-4">
          <SettingsForm
            settings={settings}
            busy={busy}
            pineconeUsage={pineconeUsage}
            fetchingProviderId={fetchingProviderId}
            testingProviderId={testingProviderId}
            providerStatuses={providerStatuses}
            onChange={onChange}
            onSave={onSave}
            onFetchProviderModels={onFetchProviderModels}
            onTestProvider={onTestProvider}
          />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function SettingsForm({
  settings,
  busy,
  pineconeUsage,
  fetchingProviderId,
  testingProviderId,
  providerStatuses,
  onChange,
  onSave,
  onFetchProviderModels,
  onTestProvider,
}: {
  settings: AiSettings;
  busy: boolean;
  pineconeUsage?: PineconeUsageEvent;
  fetchingProviderId?: string;
  testingProviderId?: string;
  providerStatuses: Record<string, ProviderStatus>;
  onChange: (settings: AiSettings) => void;
  onSave: () => void;
  onFetchProviderModels: (providerId: string) => void;
  onTestProvider: (providerId: string) => void;
}) {
  return (
    <FieldGroup>
      <SettingsSection
        title="Provider"
        description="每个 Provider 都是一个 OpenAI-compatible API 端点，可独立保存模型列表。"
        defaultOpen
        action={
          <Button
            variant="outline"
            onClick={() => onChange(addProvider(settings))}
            disabled={busy}
          >
            <PlusIcon data-icon="inline-start" />
            添加
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {settings.providers.map((provider, index) => (
            <ProviderEditor
              key={provider.id}
              provider={provider}
              index={index}
              settings={settings}
              status={providerStatuses[provider.id]}
              busy={busy}
              isFetching={fetchingProviderId === provider.id}
              isTesting={testingProviderId === provider.id}
              onChange={onChange}
              onFetchProviderModels={onFetchProviderModels}
              onTestProvider={onTestProvider}
            />
          ))}
        </div>
      </SettingsSection>
      <Field>
        <FieldLabel htmlFor="default-provider">默认 Provider</FieldLabel>
        <Select
          value={settings.defaultProviderId}
          onValueChange={(defaultProviderId) =>
            onChange(mergeSettings(settings, { defaultProviderId }))
          }
        >
          <SelectTrigger id="default-provider" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {settings.providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          角色卡自动生成和未单独指定 Provider 的任务会使用这里的 Provider。
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="response-mode">战役响应模式</FieldLabel>
        <Select
          value={settings.responseMode ?? "complete"}
          onValueChange={(responseMode) =>
            onChange(
              mergeSettings(settings, {
                responseMode: responseMode === "fast" ? "fast" : "complete",
              }),
            )
          }
        >
          <SelectTrigger id="response-mode" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="complete">完整</SelectItem>
              <SelectItem value="fast">快速</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          完整模式保留隐藏规裁和记录员；快速模式优先降低首字延迟，跳过本轮后台规裁与记录员。
        </FieldDescription>
      </Field>
      <SettingsSection
        title="AI 角色模型"
        description="每个角色可以选择来自不同 Provider 的模型；关闭开关后，该角色不会参与回合。"
      >
        {settings.agents.map((agent, index) => (
          <Field key={agent.role} orientation="horizontal">
            <Switch
              checked={agent.enabled}
              onCheckedChange={(enabled) => {
                const agents = [...settings.agents];
                agents[index] = { ...agent, enabled };
                onChange(mergeSettings(settings, { agents }));
              }}
            />
            <div className="flex flex-1 flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{agent.label}</span>
                <Badge variant="outline">{agent.role}</Badge>
              </div>
              <Select
                value={formatModelValue(
                  agent.providerId || settings.defaultProviderId,
                  agent.model ||
                    findProvider(settings, agent.providerId)?.defaultModel ||
                    findProvider(settings, agent.providerId)?.models[0] ||
                    "",
                )}
                onValueChange={(value) => {
                  const selected = parseModelValue(value);
                  const agents = [...settings.agents];
                  agents[index] = {
                    ...agent,
                    providerId: selected.providerId,
                    model: selected.model,
                  };
                  onChange(mergeSettings(settings, { agents }));
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择 Provider 模型" />
                </SelectTrigger>
                <SelectContent>
                  {settings.providers.map((provider, providerIndex) => (
                    <SelectGroup key={provider.id}>
                      {providerIndex > 0 && <SelectSeparator />}
                      <SelectLabel>{provider.name}</SelectLabel>
                      {provider.models.length ? (
                        provider.models.map((model) => (
                          <SelectItem
                            key={`${provider.id}-${model}`}
                            value={formatModelValue(provider.id, model)}
                          >
                            {model}
                          </SelectItem>
                        ))
                      ) : (
                        provider.defaultModel && (
                          <SelectItem
                            value={formatModelValue(
                              provider.id,
                              provider.defaultModel,
                            )}
                          >
                            {provider.defaultModel}
                          </SelectItem>
                        )
                      )}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Field>
        ))}
      </SettingsSection>
      <SettingsSection
        title="规则书 RAG"
        description="选择本地 OpenAI-compatible 向量，或让 Pinecone 托管 embedding、检索和可选 rerank。"
        defaultOpen={settings.rag.enabled}
      >
        <Field orientation="horizontal">
          <Switch
            checked={settings.rag.enabled}
            onCheckedChange={(enabled) =>
              onChange(mergeSettings(settings, { rag: { ...settings.rag, enabled } }))
            }
          />
          <div className="min-w-0 flex-1">
            <FieldLabel>启用规则书检索</FieldLabel>
            <FieldDescription>启用后，玩家行动会检索同规则书知识库。</FieldDescription>
          </div>
        </Field>
        <Field>
          <FieldLabel htmlFor="rag-source">RAG 分支</FieldLabel>
          <Select
            value={settings.rag.source}
            onValueChange={(source) =>
              onChange(
                mergeSettings(settings, {
                  rag: {
                    ...settings.rag,
                    source: source === "pinecone" ? "pinecone" : "local",
                  },
                }),
              )
            }
          >
            <SelectTrigger id="rag-source" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="local">本地向量库</SelectItem>
                <SelectItem value="pinecone">Pinecone Easy RAG</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            Pinecone 分支只简化规则书 RAG；GM 和 NPC 对话仍使用上面的 Chat Provider。
          </FieldDescription>
        </Field>
        {settings.rag.source === "pinecone" ? (
          <PineconeRagSettings
            settings={settings}
            usageEvent={pineconeUsage}
            onChange={onChange}
          />
        ) : (
          <LocalRagSettings settings={settings} onChange={onChange} />
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="rag-top-k">检索片段数</FieldLabel>
            <Input
              id="rag-top-k"
              type="number"
              min={1}
              max={12}
              value={settings.rag.topK}
              onChange={(event) =>
                onChange(
                  mergeSettings(settings, {
                    rag: { ...settings.rag, topK: Number(event.target.value) },
                  }),
                )
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="rag-chunk-size">切片长度</FieldLabel>
            <Input
              id="rag-chunk-size"
              type="number"
              min={300}
              max={2400}
              value={settings.rag.chunkSize}
              onChange={(event) =>
                onChange(
                  mergeSettings(settings, {
                    rag: { ...settings.rag, chunkSize: Number(event.target.value) },
                  }),
                )
              }
            />
          </Field>
        </div>
      </SettingsSection>
      <Button onClick={onSave} disabled={busy}>
        <SaveIcon data-icon="inline-start" />
        保存设置
      </Button>
    </FieldGroup>
  );
}

function SettingsSection({
  title,
  description,
  defaultOpen = false,
  action,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <FieldSet className="rounded-lg border p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-w-0 flex-1 justify-start px-0 py-0 text-left hover:bg-transparent"
            >
              <ChevronDownIcon
                data-icon="inline-start"
                className={`transition-transform ${open ? "" : "-rotate-90"}`}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{title}</span>
                {description && (
                  <span className="mt-1 block whitespace-normal text-sm font-normal text-muted-foreground">
                    {description}
                  </span>
                )}
              </span>
            </Button>
          </CollapsibleTrigger>
          {action}
        </div>
        <CollapsibleContent className="data-closed:animate-out data-open:animate-in data-closed:fade-out-0 data-open:fade-in-0 data-closed:slide-out-to-top-1 data-open:slide-in-from-top-1">
          <div className="pt-1">{children}</div>
        </CollapsibleContent>
      </FieldSet>
    </Collapsible>
  );
}

function LocalRagSettings({
  settings,
  onChange,
}: {
  settings: AiSettings;
  onChange: (settings: AiSettings) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field>
        <FieldLabel htmlFor="rag-embedding-provider">Embedding Provider</FieldLabel>
        <Select
          value={settings.rag.embeddingProviderId || settings.defaultProviderId}
          onValueChange={(embeddingProviderId) =>
            onChange(
              mergeSettings(settings, {
                rag: { ...settings.rag, embeddingProviderId },
              }),
            )
          }
        >
          <SelectTrigger id="rag-embedding-provider" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {settings.providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="rag-embedding-model">Embedding 模型</FieldLabel>
        <Input
          id="rag-embedding-model"
          value={settings.rag.embeddingModel}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) =>
            onChange(
              mergeSettings(settings, {
                rag: { ...settings.rag, embeddingModel: event.target.value },
              }),
            )
          }
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="rag-rerank-provider">Rerank Provider</FieldLabel>
        <Select
          value={
            settings.rag.rerankProviderId ||
            settings.rag.embeddingProviderId ||
            settings.defaultProviderId
          }
          onValueChange={(rerankProviderId) =>
            onChange(
              mergeSettings(settings, {
                rag: { ...settings.rag, rerankProviderId },
              }),
            )
          }
        >
          <SelectTrigger id="rag-rerank-provider" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {settings.providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="rag-rerank-model">Rerank 模型</FieldLabel>
        <Input
          id="rag-rerank-model"
          value={settings.rag.rerankModel}
          placeholder="留空则不使用 rerank"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) =>
            onChange(
              mergeSettings(settings, {
                rag: { ...settings.rag, rerankModel: event.target.value },
              }),
            )
          }
        />
      </Field>
    </div>
  );
}

function PineconeRagSettings({
  settings,
  usageEvent,
  onChange,
}: {
  settings: AiSettings;
  usageEvent?: PineconeUsageEvent;
  onChange: (settings: AiSettings) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <DatabaseIcon />
        <AlertTitle>Pinecone Easy RAG 教程</AlertTitle>
        <AlertDescription>
          1. 在 pinecone.io 创建账号并进入 API Keys；2. 复制用户自己的 API
          Key；3. 在这里填写 API Key，保持默认 index 和模型；4.
          首次导入规则书时应用会自动创建 integrated embedding index；5.
          Starter 可以验证小规模规则书库，rerank 默认关闭以避免 500 次/月限制过早耗尽。
        </AlertDescription>
      </Alert>
      <div className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="pinecone-api-key">Pinecone API Key</FieldLabel>
          <Input
            id="pinecone-api-key"
            type="password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={settings.rag.pineconeApiKey}
            onChange={(event) =>
              onChange(
                mergeSettings(settings, {
                  rag: { ...settings.rag, pineconeApiKey: event.target.value },
                }),
              )
            }
          />
          <FieldDescription>
            使用用户自己的 Pinecone key；不要把你的平台密钥打包进桌面端。
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="pinecone-index-name">Index 名称</FieldLabel>
          <Input
            id="pinecone-index-name"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={settings.rag.pineconeIndexName}
            onChange={(event) =>
              onChange(
                mergeSettings(settings, {
                  rag: { ...settings.rag, pineconeIndexName: event.target.value },
                }),
              )
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="pinecone-namespace">Namespace</FieldLabel>
          <Input
            id="pinecone-namespace"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={settings.rag.pineconeNamespace}
            onChange={(event) =>
              onChange(
                mergeSettings(settings, {
                  rag: { ...settings.rag, pineconeNamespace: event.target.value },
                }),
              )
            }
          />
          <FieldDescription>
            建议每位用户一个 namespace；同一本规则书只需导入一次，战役引用同一知识库。
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="pinecone-embedding-model">Embedding 模型</FieldLabel>
          <Input
            id="pinecone-embedding-model"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={settings.rag.pineconeEmbeddingModel}
            onChange={(event) =>
              onChange(
                mergeSettings(settings, {
                  rag: {
                    ...settings.rag,
                    pineconeEmbeddingModel: event.target.value,
                  },
                }),
              )
            }
          />
          <FieldDescription>默认使用 Pinecone 托管的多语言 embedding。</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="pinecone-cloud">Cloud</FieldLabel>
          <Input
            id="pinecone-cloud"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={settings.rag.pineconeCloud}
            onChange={(event) =>
              onChange(
                mergeSettings(settings, {
                  rag: { ...settings.rag, pineconeCloud: event.target.value },
                }),
              )
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="pinecone-region">Region</FieldLabel>
          <Input
            id="pinecone-region"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={settings.rag.pineconeRegion}
            onChange={(event) =>
              onChange(
                mergeSettings(settings, {
                  rag: { ...settings.rag, pineconeRegion: event.target.value },
                }),
              )
            }
          />
        </Field>
      </div>
      <Field orientation="horizontal">
        <Switch
          checked={settings.rag.pineconeRerankEnabled}
          onCheckedChange={(pineconeRerankEnabled) =>
            onChange(
              mergeSettings(settings, {
                rag: { ...settings.rag, pineconeRerankEnabled },
              }),
            )
          }
        />
        <div className="min-w-0 flex-1">
          <FieldLabel>启用 Pinecone rerank</FieldLabel>
          <FieldDescription>
            默认关闭。Starter rerank 请求额度较小，建议只在检索质量不足时开启。
          </FieldDescription>
        </div>
      </Field>
      <Field orientation="horizontal">
        <Switch
          checked={settings.rag.pineconeGlobalFallbackEnabled}
          onCheckedChange={(pineconeGlobalFallbackEnabled) =>
            onChange(
              mergeSettings(settings, {
                rag: { ...settings.rag, pineconeGlobalFallbackEnabled },
              }),
            )
          }
        />
        <div className="min-w-0 flex-1">
          <FieldLabel>空结果时全局回退</FieldLabel>
          <FieldDescription>
            开启后，同规则库检索无结果会再查全局 namespace；关闭可减少一次 Pinecone 请求。
          </FieldDescription>
        </div>
      </Field>
      {settings.rag.pineconeRerankEnabled && (
        <Field>
          <FieldLabel htmlFor="pinecone-rerank-model">Rerank 模型</FieldLabel>
          <Input
            id="pinecone-rerank-model"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={settings.rag.pineconeRerankModel}
            onChange={(event) =>
              onChange(
                mergeSettings(settings, {
                  rag: {
                    ...settings.rag,
                    pineconeRerankModel: event.target.value,
                  },
                }),
              )
            }
          />
        </Field>
      )}
      <Alert>
        <ExternalLinkIcon />
        <AlertTitle>用量查询</AlertTitle>
        <AlertDescription>
          Pinecone 当前更适合通过控制台查看 Starter 月度用量；检索 API
          只返回本次请求 usage。打开{" "}
          <a
            className="underline underline-offset-4"
            href={PINECONE_USAGE_URL}
            target="_blank"
            rel="noreferrer"
          >
            Pinecone Usage
          </a>{" "}
          查看 read units、write units、embedding tokens 和 rerank requests。
        </AlertDescription>
      </Alert>
      <PineconeUsageAlert usageEvent={usageEvent} />
    </div>
  );
}

export function PineconeUsageAlert({
  usageEvent,
}: {
  usageEvent?: PineconeUsageEvent;
}) {
  const usageEntries = formatPineconeUsageEntries(usageEvent);
  return (
    <Alert>
      <DatabaseIcon />
      <AlertTitle>最近一次 Pinecone 运行反馈</AlertTitle>
      <AlertDescription>
        {usageEvent ? (
          <div className="flex flex-col gap-2">
            <div>
              {usageEvent.operation === "search" ? "检索" : "导入"}于{" "}
              {new Date(usageEvent.createdAt).toLocaleString()} 完成
              {typeof usageEvent.hitCount === "number"
                ? `，返回 ${usageEvent.hitCount} 个候选片段`
                : ""}
              {usageEvent.fallbackToGlobalSearch
                ? "；当前规则书库没有命中，已自动改用全局规则书库检索"
                : ""}
              。
            </div>
            {usageEntries.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {usageEntries.map(([key, value]) => (
                  <div key={key} className="rounded-md border bg-background px-3 py-2">
                    <div className="text-xs text-muted-foreground">{key}</div>
                    <div className="font-mono text-sm">{value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div>
                Pinecone 本次响应没有返回 usage 字段。导入通常不会稳定返回单次用量；回合检索成功后这里会显示
                read_units、rerank_units 等可用字段。
              </div>
            )}
          </div>
        ) : (
          "尚未捕获到本次会话的 Pinecone usage。完成一次规则书检索后，这里会显示 read_units、rerank_units、embed_total_tokens 等 Pinecone 返回的字段。"
        )}
      </AlertDescription>
    </Alert>
  );
}

function formatPineconeUsageEntries(
  usageEvent?: PineconeUsageEvent,
): Array<[string, string]> {
  if (!usageEvent?.usage) {
    return [];
  }
  return Object.entries(usageEvent.usage)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, value.toLocaleString()]);
}

function ProviderEditor({
  provider,
  index,
  settings,
  status,
  busy,
  isFetching,
  isTesting,
  onChange,
  onFetchProviderModels,
  onTestProvider,
}: {
  provider: AiProviderConfig;
  index: number;
  settings: AiSettings;
  status?: ProviderStatus;
  busy: boolean;
  isFetching: boolean;
  isTesting: boolean;
  onChange: (settings: AiSettings) => void;
  onFetchProviderModels: (providerId: string) => void;
  onTestProvider: (providerId: string) => void;
}) {
  const canRemove = settings.providers.length > 1;
  const [open, setOpen] = useState(index === 0);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex flex-col gap-3 rounded-lg border p-3">
        <div className="flex flex-col gap-3">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-w-0 flex-1 justify-start gap-2 px-0 py-0 text-left hover:bg-transparent"
            >
              <ChevronDownIcon
                data-icon="inline-start"
                className={`transition-transform ${open ? "" : "-rotate-90"}`}
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">Provider {index + 1}</Badge>
                  <span className="truncate text-sm font-medium">{provider.name}</span>
                </span>
                <ProviderStatusLine status={status} defaultModel={provider.defaultModel} />
              </span>
            </Button>
          </CollapsibleTrigger>
          <div className="flex flex-wrap items-center gap-2 pl-7">
            <Button
              variant="outline"
              onClick={() => onFetchProviderModels(provider.id)}
              disabled={busy || isFetching || isTesting}
            >
              <RefreshCwIcon data-icon="inline-start" />
              {isFetching ? "获取中" : "获取模型"}
            </Button>
            <Button
              variant="outline"
              onClick={() => onTestProvider(provider.id)}
              disabled={busy || isFetching || isTesting}
            >
              <PlayIcon data-icon="inline-start" />
              {isTesting ? "测试中" : "测试"}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onChange(removeProvider(settings, provider.id))}
              disabled={busy || isFetching || isTesting || !canRemove}
            >
              <Trash2Icon />
              <span className="sr-only">删除 Provider</span>
            </Button>
          </div>
        </div>
        <CollapsibleContent className="data-closed:animate-out data-open:animate-in data-closed:fade-out-0 data-open:fade-in-0 data-closed:slide-out-to-top-1 data-open:slide-in-from-top-1">
          <div className="grid gap-3 pt-1 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${provider.id}-name`}>名称</FieldLabel>
              <Input
                id={`${provider.id}-name`}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={provider.name}
                onChange={(event) =>
                  onChange(updateProvider(settings, provider.id, { name: event.target.value }))
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${provider.id}-default`}>默认模型</FieldLabel>
              <div className="flex gap-2">
                <Select
                  value={provider.defaultModel || undefined}
                  onValueChange={(defaultModel) =>
                    onChange(updateProvider(settings, provider.id, { defaultModel }))
                  }
                >
                  <SelectTrigger id={`${provider.id}-default`} className="min-w-0 flex-1">
                    <SelectValue placeholder="从模型列表选择" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>{provider.name}</SelectLabel>
                      {provider.models.map((model) => (
                        <SelectItem key={model} value={model}>
                          {model}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Input
                  className="min-w-0 flex-1"
                  value={provider.defaultModel ?? ""}
                  placeholder="或手动输入"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) =>
                    onChange(
                      updateProvider(settings, provider.id, {
                        defaultModel: event.target.value,
                      }),
                    )
                  }
                />
              </div>
              <FieldDescription>
                手动输入不会写入“已获取模型”；点击“获取模型”后可直接从列表选择。
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${provider.id}-base-url`}>Base URL</FieldLabel>
              <Input
                id={`${provider.id}-base-url`}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={provider.baseUrl}
                onChange={(event) =>
                  onChange(
                    updateProvider(settings, provider.id, { baseUrl: event.target.value }),
                  )
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${provider.id}-api-key`}>API Key</FieldLabel>
              <Input
                id={`${provider.id}-api-key`}
                type="password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={provider.apiKey}
                onChange={(event) =>
                  onChange(updateProvider(settings, provider.id, { apiKey: event.target.value }))
                }
              />
            </Field>
          </div>
          <Field className="pt-3">
            <FieldLabel>已获取模型</FieldLabel>
            <div className="flex max-h-24 flex-wrap gap-2 overflow-auto rounded-lg border p-2">
              {provider.models.length ? (
                provider.models.map((model) => (
                  <Badge key={model} variant="outline">
                    {model}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">
                  暂无模型，点击“获取模型”或先填写默认模型。
                </span>
              )}
            </div>
          </Field>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function ProviderStatusLine({
  status,
  defaultModel,
}: {
  status?: ProviderStatus;
  defaultModel?: string;
}) {
  const currentStatus = status ?? { state: "unknown" as const };
  const colorClass =
    currentStatus.state === "available"
      ? "bg-emerald-500"
      : currentStatus.state === "unavailable"
        ? "bg-destructive"
        : currentStatus.state === "checking"
          ? "bg-amber-500"
          : "bg-muted-foreground";
  const label =
    currentStatus.state === "available"
      ? `可用${currentStatus.latencyMs ? ` · ${currentStatus.latencyMs}ms` : ""}`
      : currentStatus.state === "unavailable"
        ? "不可用"
        : currentStatus.state === "checking"
          ? "检查中"
          : "未测试";
  const detail =
    currentStatus.message ??
    currentStatus.model ??
    (defaultModel ? `默认 ${defaultModel}` : "填写后可测试服务可用性");
  const checkedAt = currentStatus.checkedAt
    ? new Date(currentStatus.checkedAt).toLocaleTimeString()
    : "";

  return (
    <span className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${colorClass} ${
          currentStatus.state === "checking" ? "animate-pulse" : ""
        }`}
      />
      <span>{label}</span>
      <span className="min-w-0 truncate">{detail}</span>
      {checkedAt && <span>{checkedAt}</span>}
    </span>
  );
}

function addProvider(settings: AiSettings): AiSettings {
  const id = createId("provider");
  return mergeSettings(settings, {
    providers: [
      ...settings.providers,
      {
        id,
        name: `Provider ${settings.providers.length + 1}`,
        baseUrl: "http://localhost:11434/v1",
        apiKey: "",
        models: [],
        defaultModel: "",
      },
    ],
  });
}

function removeProvider(settings: AiSettings, providerId: string): AiSettings {
  const providers = settings.providers.filter((provider) => provider.id !== providerId);
  const fallbackProviderId = providers[0]?.id ?? settings.defaultProviderId;
  return mergeSettings(settings, {
    providers,
    defaultProviderId:
      settings.defaultProviderId === providerId
        ? fallbackProviderId
        : settings.defaultProviderId,
    agents: settings.agents.map((agent) =>
      agent.providerId === providerId
        ? {
            ...agent,
            providerId: fallbackProviderId,
            model: providers[0]?.defaultModel || providers[0]?.models[0],
          }
        : agent,
    ),
    rag: {
      ...settings.rag,
      embeddingProviderId:
        settings.rag.embeddingProviderId === providerId
          ? fallbackProviderId
          : settings.rag.embeddingProviderId,
      rerankProviderId:
        settings.rag.rerankProviderId === providerId
          ? fallbackProviderId
          : settings.rag.rerankProviderId,
    },
  });
}

function updateProvider(
  settings: AiSettings,
  providerId: string,
  patch: Partial<AiProviderConfig>,
): AiSettings {
  const providers = settings.providers.map((provider) =>
    provider.id === providerId ? { ...provider, ...patch } : provider,
  );
  return mergeSettings(settings, { providers });
}

function findProvider(settings: AiSettings, providerId?: string): AiProviderConfig | undefined {
  return (
    settings.providers.find((provider) => provider.id === providerId) ??
    settings.providers.find((provider) => provider.id === settings.defaultProviderId) ??
    settings.providers[0]
  );
}
