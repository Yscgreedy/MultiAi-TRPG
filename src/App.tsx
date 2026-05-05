import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArchiveIcon,
  BotIcon,
  Dice5Icon,
  LockIcon,
  PlusIcon,
  PlayIcon,
  RefreshCwIcon,
  SaveIcon,
  SettingsIcon,
  SparklesIcon,
  SwordsIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  defaultAiSettings,
  fetchProviderModels,
  formatModelValue,
  generateProxyActionOptions,
  generateCharacterWithAi,
  parseModelValue,
} from "@/lib/ai";
import { mergeSettings, playTurnStreaming } from "@/lib/game";
import {
  cloneCharacterForCampaign,
  createEmptyCharacter,
  createRandomCharacter,
  getRuleset,
  rulesets,
  toLibraryEntry,
} from "@/lib/rulesets";
import { createRepository, type GameRepository } from "@/lib/storage";
import { createId, nowIso } from "@/lib/id";
import type {
  AiAgentConfig,
  AiProviderConfig,
  AiSettings,
  Campaign,
  CampaignDetail,
  CharacterCard,
  CharacterLibraryEntry,
} from "@/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";

const defaultCampaignForm = {
  title: "雾港失踪案",
  premise: "潮湿港城里，一封没有署名的求救信把主角引向旧灯塔。",
  rulesetId: "light-rules-v1",
  characterConcept: "擅长观察的民俗调查员",
  characterMode: "random" as CharacterMode,
  existingCharacterId: "",
};

type CharacterMode = "random" | "existing" | "manual";

const defaultSeed = {
  concept: "擅长观察的民俗调查员",
  tone: "悬疑、低魔、有人情味",
  profession: "调查员",
};

type ThemeMode = "system" | "light" | "dark";
type AccentColor = "teal" | "indigo" | "rose" | "amber";

interface AppPreferences {
  themeMode: ThemeMode;
  accentColor: AccentColor;
  compactMode: boolean;
  displayName: string;
  avatarText: string;
  avatarUrl: string;
}

const preferencesKey = "multi-ai-trpg-preferences";
const defaultPreferences: AppPreferences = {
  themeMode: "system",
  accentColor: "teal",
  compactMode: false,
  displayName: "玩家",
  avatarText: "旅",
  avatarUrl: "",
};

const accentOptions: Array<{ value: AccentColor; label: string }> = [
  { value: "teal", label: "青绿" },
  { value: "indigo", label: "靛蓝" },
  { value: "rose", label: "玫红" },
  { value: "amber", label: "琥珀" },
];

const diceExpressions = ["1d4", "1d6", "2d6", "1d8", "1d10", "1d12", "1d20", "1d100"];

interface DiceRollResult {
  expression: string;
  rolls: number[];
  total: number;
}

function App() {
  const repositoryRef = useRef<GameRepository | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [libraryCharacters, setLibraryCharacters] = useState<CharacterLibraryEntry[]>([]);
  const [libraryRulesetId, setLibraryRulesetId] = useState("light-rules-v1");
  const [editingCharacter, setEditingCharacter] = useState<CharacterLibraryEntry>(() =>
    toLibraryEntry(createEmptyCharacter("light-rules-v1"), "manual"),
  );
  const [detail, setDetail] = useState<CampaignDetail>();
  const [settings, setSettings] = useState<AiSettings>();
  const [activePage, setActivePage] = useState<"game" | "characters" | "settings">("game");
  const [fetchingProviderId, setFetchingProviderId] = useState<string>();
  const [preferences, setPreferences] = useState<AppPreferences>(() =>
    loadPreferences(),
  );
  const [campaignForm, setCampaignForm] = useState(defaultCampaignForm);
  const [seed, setSeed] = useState(defaultSeed);
  const [proxyMode, setProxyMode] = useState(false);
  const [proxyOptions, setProxyOptions] = useState<string[]>([]);
  const [generatingProxyOptions, setGeneratingProxyOptions] = useState(false);
  const [playerAction, setPlayerAction] = useState(
    "我检查求救信上的水渍和折痕，寻找寄信人的线索。",
  );

  const activeRuleset = useMemo(
    () => getRuleset(detail?.campaign.rulesetId ?? campaignForm.rulesetId),
    [campaignForm.rulesetId, detail?.campaign.rulesetId],
  );
  const visibleLibraryCharacters = useMemo(
    () =>
      libraryCharacters.filter(
        (character) => character.rulesetId === libraryRulesetId,
      ),
    [libraryCharacters, libraryRulesetId],
  );

  useEffect(() => {
    applyPreferences(preferences);
    localStorage.setItem(preferencesKey, JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    async function boot() {
      try {
        const repository = createRepository();
        repositoryRef.current = repository;
        await repository.init();
        const [storedSettings, storedCampaigns] = await Promise.all([
          repository.getSettings(),
          repository.listCampaigns(),
        ]);
        setSettings(storedSettings);
        setCampaigns(storedCampaigns);
        setLibraryCharacters(await repository.listLibraryCharacters());
        if (storedCampaigns[0]) {
          setDetail(await repository.getCampaignDetail(storedCampaigns[0].id));
        }
      } catch (error) {
        console.error("初始化失败", error);
        toast.error(getErrorMessage(error, "初始化失败"));
        setSettings(defaultAiSettings);
      } finally {
        setLoading(false);
      }
    }

    void boot();
  }, []);

  async function reloadCampaigns(nextCampaignId?: string | null) {
    const repository = requireRepository();
    const nextCampaigns = await repository.listCampaigns();
    setCampaigns(nextCampaigns);
    const targetId =
      nextCampaignId === undefined
        ? detail?.campaign.id ?? nextCampaigns[0]?.id
        : nextCampaignId ?? nextCampaigns[0]?.id;
    setDetail(targetId ? await repository.getCampaignDetail(targetId) : undefined);
  }

  async function reloadLibrary() {
    setLibraryCharacters(await requireRepository().listLibraryCharacters());
  }

  function requireRepository(): GameRepository {
    if (!repositoryRef.current) {
      throw new Error("存储尚未初始化。");
    }
    return repositoryRef.current;
  }

  async function handleCreateCampaign() {
    setBusy(true);
    try {
      const selectedLibraryCharacter = libraryCharacters.find(
        (character) => character.id === campaignForm.existingCharacterId,
      );
      if (campaignForm.characterMode === "existing" && !selectedLibraryCharacter) {
        throw new Error("请选择一个已有角色卡，或改用随机新角色/手动生成。");
      }
      if (selectedLibraryCharacter?.lockedByCampaignId) {
        throw new Error("该角色卡已经加入其他战役，删除对应断点后才能再次使用。");
      }
      const character =
        campaignForm.characterMode === "existing" && selectedLibraryCharacter
          ? cloneCharacterForCampaign(selectedLibraryCharacter)
          : campaignForm.characterMode === "manual"
            ? createEmptyCharacter(campaignForm.rulesetId, campaignForm.characterConcept)
            : createRandomCharacter(campaignForm.rulesetId);
      const nextDetail = await requireRepository().createCampaign({
        title: campaignForm.title || "未命名战役",
        premise: campaignForm.premise || "一场尚未揭晓的单人冒险。",
        rulesetId: campaignForm.rulesetId,
        character,
        sourceCharacterId: selectedLibraryCharacter?.id,
      });
      setDetail(nextDetail);
      await reloadCampaigns(nextDetail.campaign.id);
      toast.success("战役已创建，可以从这里断点续玩。");
    } catch (error) {
      console.error("创建战役失败", error);
      toast.error(getErrorMessage(error, "创建战役失败"));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveLibraryCharacter(character: CharacterLibraryEntry) {
    setBusy(true);
    try {
      const normalized: CharacterLibraryEntry = {
        ...character,
        source: character.source || "manual",
        updatedAt: nowIso(),
      };
      await requireRepository().saveLibraryCharacter(normalized);
      setEditingCharacter(normalized);
      await reloadLibrary();
      toast.success("角色卡已保存到角色库。");
    } catch (error) {
      console.error("保存角色卡失败", error);
      toast.error(getErrorMessage(error, "保存角色卡失败"));
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateLibraryCharacter() {
    if (!settings) {
      return;
    }

    setBusy(true);
    try {
      const generated = await generateCharacterWithAi(settings, libraryRulesetId, seed);
      const entry = toLibraryEntry(generated, "ai");
      await requireRepository().saveLibraryCharacter(entry);
      setEditingCharacter(entry);
      await reloadLibrary();
      toast.success("AI 角色卡已生成并加入角色库。");
    } catch (error) {
      console.error("AI 生成角色卡失败", error);
      toast.error(getErrorMessage(error, "AI 生成角色卡失败"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteLibraryCharacter(characterId: string) {
    setBusy(true);
    try {
      await requireRepository().deleteLibraryCharacter(characterId);
      await reloadLibrary();
      if (editingCharacter.id === characterId) {
        setEditingCharacter(toLibraryEntry(createEmptyCharacter(libraryRulesetId), "manual"));
      }
      toast.success("角色卡已删除。");
    } catch (error) {
      console.error("删除角色卡失败", error);
      toast.error(getErrorMessage(error, "删除角色卡失败"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteCampaign(campaignId: string) {
    const campaign = campaigns.find((item) => item.id === campaignId);
    const confirmed = window.confirm(
      `确定删除「${campaign?.title ?? "该战役"}」吗？对应的断点、消息和战役角色会被删除；如果使用了角色库卡片，该卡片会被释放。`,
    );
    if (!confirmed) {
      return;
    }

    setBusy(true);
    try {
      await requireRepository().deleteCampaign(campaignId);
      await reloadLibrary();
      await reloadCampaigns(detail?.campaign.id === campaignId ? null : detail?.campaign.id);
      toast.success("断点已删除，关联角色卡已释放。");
    } catch (error) {
      console.error("删除断点失败", error);
      toast.error(getErrorMessage(error, "删除断点失败"));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSettings() {
    if (!settings) {
      return;
    }

    setBusy(true);
    try {
      await requireRepository().saveSettings(settings);
      toast.success("AI 设置已保存到本地。");
    } catch (error) {
      console.error("保存设置失败", error);
      toast.error(getErrorMessage(error, "保存设置失败"));
    } finally {
      setBusy(false);
    }
  }

  async function handleFetchProviderModels(providerId: string) {
    if (!settings) {
      return;
    }

    const provider = settings.providers.find((item) => item.id === providerId);
    if (!provider) {
      toast.error("Provider 不存在。");
      return;
    }

    setFetchingProviderId(providerId);
    try {
      const models = await fetchProviderModels(provider);
      const providers = settings.providers.map((item) =>
        item.id === providerId
          ? {
              ...item,
              models,
              defaultModel: item.defaultModel && models.includes(item.defaultModel)
                ? item.defaultModel
                : models[0],
            }
          : item,
      );
      const nextSettings = mergeSettings(settings, { providers });
      setSettings(nextSettings);
      await requireRepository().saveSettings(nextSettings);
      toast.success(`已获取 ${provider.name} 的 ${models.length} 个模型。`);
    } catch (error) {
      console.error("获取模型失败", error);
      toast.error(getErrorMessage(error, "获取模型失败"));
    } finally {
      setFetchingProviderId(undefined);
    }
  }

  async function handlePlayTurn() {
    if (!settings || !detail) {
      return;
    }

    setBusy(true);
    try {
      const nextDetail = await playTurnStreaming(
        requireRepository(),
        detail,
        playerAction,
        settings,
        {
          onMessageAppend: (message) => {
            setDetail((current) =>
              current && current.campaign.id === detail.campaign.id
                ? { ...current, messages: [...current.messages, message] }
                : current,
            );
          },
          onMessageDelta: (messageId, token) => {
            setDetail((current) =>
              current && current.campaign.id === detail.campaign.id
                ? {
                    ...current,
                    messages: current.messages.map((message) =>
                      message.id === messageId
                        ? { ...message, content: `${message.content}${token}` }
                        : message,
                    ),
                  }
                : current,
            );
          },
        },
      );
      setDetail(nextDetail);
      await reloadCampaigns(nextDetail.campaign.id);
      setPlayerAction("");
      setProxyOptions([]);
      toast.success("回合已写入存档。");
    } catch (error) {
      console.error("回合推进失败", error);
      toast.error(getErrorMessage(error, "回合推进失败"));
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateProxyOptions() {
    if (!settings || !detail) {
      return;
    }

    setGeneratingProxyOptions(true);
    try {
      const options = await generateProxyActionOptions(settings, detail);
      setProxyOptions(options);
      toast.success("代理选项已生成。");
    } catch (error) {
      console.error("代理选项生成失败", error);
      toast.error(getErrorMessage(error, "代理选项生成失败"));
    } finally {
      setGeneratingProxyOptions(false);
    }
  }

  if (loading) {
    return <LoadingShell />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg border bg-card">
              <SwordsIcon />
            </div>
            <div>
              <h1 className="text-lg font-semibold">多 AI 跑团控制台</h1>
              <p className="text-sm text-muted-foreground">
                {preferences.displayName} · 本地 SQLite 存档 · 可插拔规则书
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AvatarPreview preferences={preferences} size="sm" />
            <Badge variant="secondary">{activeRuleset.name}</Badge>
            <Button
              variant={activePage === "game" ? "secondary" : "ghost"}
              onClick={() => setActivePage("game")}
            >
              游戏
            </Button>
            <Button
              variant={activePage === "characters" ? "secondary" : "ghost"}
              onClick={() => setActivePage("characters")}
            >
              角色卡
            </Button>
            <Button
              variant={activePage === "settings" ? "secondary" : "outline"}
              onClick={() => setActivePage("settings")}
            >
              <SettingsIcon data-icon="inline-start" />
              设置
            </Button>
            <SettingsSheet
              settings={settings}
              busy={busy}
              fetchingProviderId={fetchingProviderId}
              onChange={setSettings}
              onSave={handleSaveSettings}
              onFetchProviderModels={handleFetchProviderModels}
            />
          </div>
        </div>
      </header>

      {activePage === "settings" ? (
        <main className="min-h-0 flex-1 overflow-auto px-6 py-4">
          <div className="mx-auto max-w-4xl">
          <SettingsPage
            preferences={preferences}
            onChange={setPreferences}
          />
          </div>
        </main>
      ) : activePage === "characters" ? (
        <main className="min-h-0 flex-1 overflow-hidden px-6 py-4">
          <div className="mx-auto h-full max-w-7xl">
          <CharacterLibraryPage
            busy={busy}
            rulesetId={libraryRulesetId}
            characters={visibleLibraryCharacters}
            editingCharacter={editingCharacter}
            seed={seed}
            onRulesetChange={async (rulesetId) => {
              setLibraryRulesetId(rulesetId);
              setEditingCharacter(toLibraryEntry(createEmptyCharacter(rulesetId), "manual"));
              await reloadLibrary();
            }}
            onEdit={setEditingCharacter}
            onEditingChange={setEditingCharacter}
            onSeedChange={setSeed}
            onNew={() =>
              setEditingCharacter(
                toLibraryEntry(createEmptyCharacter(libraryRulesetId), "manual"),
              )
            }
            onSave={handleSaveLibraryCharacter}
            onGenerate={handleGenerateLibraryCharacter}
            onDelete={handleDeleteLibraryCharacter}
          />
          </div>
        </main>
      ) : (
      <main className="mx-auto grid min-h-0 w-full max-w-7xl flex-1 gap-4 overflow-hidden px-6 py-4 lg:grid-cols-[320px_1fr]">
        <aside className="min-h-0 overflow-hidden">
          <ScrollArea className="h-full pr-3">
          <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>新建战役</CardTitle>
              <CardDescription>创建后会立即生成本地断点。</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="campaign-title">战役名</FieldLabel>
                  <Input
                    id="campaign-title"
                    value={campaignForm.title}
                    onChange={(event) =>
                      setCampaignForm({ ...campaignForm, title: event.target.value })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="ruleset">规则书</FieldLabel>
                  <Select
                    value={campaignForm.rulesetId}
                    onValueChange={(rulesetId) =>
                      setCampaignForm({ ...campaignForm, rulesetId })
                    }
                  >
                    <SelectTrigger id="ruleset">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {rulesets.map((ruleset) => (
                          <SelectItem key={ruleset.id} value={ruleset.id}>
                            {ruleset.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>{activeRuleset.description}</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="campaign-premise">开局设定</FieldLabel>
                  <Textarea
                    id="campaign-premise"
                    value={campaignForm.premise}
                    onChange={(event) =>
                      setCampaignForm({
                        ...campaignForm,
                        premise: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="character-concept">初始角色概念</FieldLabel>
                  <Input
                    id="character-concept"
                    value={campaignForm.characterConcept}
                    onChange={(event) =>
                      setCampaignForm({
                        ...campaignForm,
                        characterConcept: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="character-mode">角色来源</FieldLabel>
                  <Select
                    value={campaignForm.characterMode}
                    onValueChange={(characterMode) =>
                      setCampaignForm({
                        ...campaignForm,
                        characterMode: characterMode as CharacterMode,
                      })
                    }
                  >
                    <SelectTrigger id="character-mode" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="random">随机新角色</SelectItem>
                        <SelectItem value="existing">已有角色</SelectItem>
                        <SelectItem value="manual">手动生成</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                {campaignForm.characterMode === "existing" && (
                  <Field>
                    <FieldLabel htmlFor="existing-character">选择角色卡</FieldLabel>
                    <Select
                      value={campaignForm.existingCharacterId || undefined}
                      onValueChange={(existingCharacterId) =>
                        setCampaignForm({ ...campaignForm, existingCharacterId })
                      }
                    >
                      <SelectTrigger id="existing-character" className="w-full">
                        <SelectValue placeholder="选择角色库中的角色" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>{getRuleset(campaignForm.rulesetId).name}</SelectLabel>
                          {libraryCharacters
                            .filter((character) => character.rulesetId === campaignForm.rulesetId)
                            .map((character) => (
                              <SelectItem
                                key={character.id}
                                value={character.id}
                                disabled={Boolean(character.lockedByCampaignId)}
                              >
                                {character.name} · {character.concept}
                                {character.lockedByCampaignTitle
                                  ? ` · 已在「${character.lockedByCampaignTitle}」中`
                                  : ""}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      可在顶部“角色卡”页面维护自己的角色库。
                    </FieldDescription>
                  </Field>
                )}
                <Button onClick={handleCreateCampaign} disabled={busy}>
                  <PlayIcon data-icon="inline-start" />
                  创建并开始
                </Button>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>断点续玩</CardTitle>
              <CardDescription>按最近更新时间排序。</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                <div className="flex flex-col gap-2 pr-3">
                  {campaigns.map((campaign) => (
                    <div key={campaign.id} className="flex items-stretch gap-1">
                      <Button
                        variant={detail?.campaign.id === campaign.id ? "secondary" : "ghost"}
                        className="h-auto min-w-0 flex-1 justify-start px-3 py-2 text-left"
                        onClick={async () =>
                          setDetail(await requireRepository().getCampaignDetail(campaign.id))
                        }
                      >
                        <ArchiveIcon data-icon="inline-start" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{campaign.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {new Date(campaign.updatedAt).toLocaleString()}
                          </span>
                        </span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteCampaign(campaign.id);
                        }}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  ))}
                  {!campaigns.length && (
                    <Alert>
                      <SparklesIcon />
                      <AlertTitle>暂无存档</AlertTitle>
                      <AlertDescription>先创建一个战役开始本地记录。</AlertDescription>
                    </Alert>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
          </div>
          </ScrollArea>
        </aside>

        <section className="min-h-0 min-w-0 overflow-hidden">
          {detail ? (
            <GameConsole
              detail={detail}
              busy={busy}
              communicableAgents={[
                ...(settings?.agents.filter(
                  (agent) => agent.enabled && agent.role !== "Companion",
                ) ?? []),
                ...detail.npcs.map((npc) => ({
                  role: "Companion" as const,
                  label: npc.name,
                  providerId: settings?.defaultProviderId,
                  enabled: true,
                  systemPrompt: "",
                })),
              ]}
              playerAction={playerAction}
              proxyMode={proxyMode}
              proxyOptions={proxyOptions}
              generatingProxyOptions={generatingProxyOptions}
              onActionChange={setPlayerAction}
              onProxyModeChange={setProxyMode}
              onGenerateProxyOptions={handleGenerateProxyOptions}
              onAcceptProxyOption={setPlayerAction}
              onPlayTurn={handlePlayTurn}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>等待战役</CardTitle>
                <CardDescription>左侧创建战役后，这里会显示游戏进程。</CardDescription>
              </CardHeader>
            </Card>
          )}
        </section>
      </main>
      )}
      <Toaster />
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="mx-auto flex min-h-screen max-w-7xl gap-4 px-6 py-6">
      <Skeleton className="h-[700px] w-80" />
      <Skeleton className="h-[700px] flex-1" />
    </div>
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}

function loadPreferences(): AppPreferences {
  const raw = localStorage.getItem(preferencesKey);
  if (!raw) {
    return defaultPreferences;
  }

  try {
    return {
      ...defaultPreferences,
      ...(JSON.parse(raw) as Partial<AppPreferences>),
    };
  } catch {
    return defaultPreferences;
  }
}

function applyPreferences(preferences: AppPreferences): void {
  const root = document.documentElement;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const useDark =
    preferences.themeMode === "dark" ||
    (preferences.themeMode === "system" && prefersDark);

  root.classList.toggle("dark", useDark);
  root.classList.toggle("compact", preferences.compactMode);
  root.dataset.accent = preferences.accentColor;
}

function CharacterLibraryPage({
  busy,
  rulesetId,
  characters,
  editingCharacter,
  seed,
  onRulesetChange,
  onEdit,
  onEditingChange,
  onSeedChange,
  onNew,
  onSave,
  onGenerate,
  onDelete,
}: {
  busy: boolean;
  rulesetId: string;
  characters: CharacterLibraryEntry[];
  editingCharacter: CharacterLibraryEntry;
  seed: typeof defaultSeed;
  onRulesetChange: (rulesetId: string) => void;
  onEdit: (character: CharacterLibraryEntry) => void;
  onEditingChange: (character: CharacterLibraryEntry) => void;
  onSeedChange: (seed: typeof defaultSeed) => void;
  onNew: () => void;
  onSave: (character: CharacterLibraryEntry) => void;
  onGenerate: () => void;
  onDelete: (characterId: string) => void;
}) {
  const [attributeUnlockedCharacterId, setAttributeUnlockedCharacterId] = useState<string>();
  const isCampaignLocked = Boolean(editingCharacter.lockedByCampaignId);
  const requiresAttributeUnlock =
    editingCharacter.source === "ai" || editingCharacter.source === "random";
  const attributesUnlocked =
    !requiresAttributeUnlock || attributeUnlockedCharacterId === editingCharacter.id;

  function requestAttributeUnlock(): boolean {
    if (isCampaignLocked) {
      toast.warning("角色卡正在战役中使用，删除对应断点后才能编辑。");
      return false;
    }
    if (attributesUnlocked) {
      return true;
    }
    const confirmed = window.confirm(
      "数值属性会影响判定平衡。确定要解锁并编辑这张已生成角色卡的数值吗？",
    );
    if (confirmed) {
      setAttributeUnlockedCharacterId(editingCharacter.id);
    }
    return confirmed;
  }

  function updateCharacter(patch: Partial<CharacterLibraryEntry>) {
    if (isCampaignLocked) {
      toast.warning("角色卡正在战役中使用，删除对应断点后才能编辑。");
      return;
    }
    onEditingChange({ ...editingCharacter, ...patch });
  }

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[340px_1fr]">
      <Card className="min-h-0">
        <CardHeader>
          <CardTitle>角色卡管理</CardTitle>
          <CardDescription>按规则书维护可复用角色卡。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="library-ruleset">规则书分类</FieldLabel>
            <Select value={rulesetId} onValueChange={onRulesetChange}>
              <SelectTrigger id="library-ruleset" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {rulesets.map((ruleset) => (
                    <SelectItem key={ruleset.id} value={ruleset.id}>
                      {ruleset.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onNew} disabled={busy}>
              <PlusIcon data-icon="inline-start" />
              新建
            </Button>
            <Button onClick={onGenerate} disabled={busy}>
              <SparklesIcon data-icon="inline-start" />
              AI 生成
            </Button>
          </div>
          <ScrollArea className="h-[520px]">
            <div className="flex flex-col gap-2 pr-3">
              {characters.map((character) => (
                <Button
                  key={character.id}
                  variant={editingCharacter.id === character.id ? "secondary" : "ghost"}
                  className="h-auto justify-start px-3 py-2 text-left"
                  onClick={() => onEdit(character)}
                >
                  <UserIcon data-icon="inline-start" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 truncate">
                      <span className="truncate">{character.name}</span>
                      {character.lockedByCampaignId && <LockIcon />}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {character.concept} · {character.source}
                      {character.lockedByCampaignTitle
                        ? ` · ${character.lockedByCampaignTitle}`
                        : ""}
                    </span>
                  </span>
                </Button>
              ))}
              {!characters.length && (
                <Alert>
                  <UserIcon />
                  <AlertTitle>暂无角色</AlertTitle>
                  <AlertDescription>新建或使用 AI 生成第一张角色卡。</AlertDescription>
                </Alert>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="min-h-0 overflow-hidden">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>编辑角色卡</CardTitle>
              <CardDescription>{getRuleset(editingCharacter.rulesetId).name}</CardDescription>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {isCampaignLocked && (
                <Badge variant="outline">
                  <LockIcon />
                  战役锁定
                </Badge>
              )}
              {requiresAttributeUnlock && !attributesUnlocked && !isCampaignLocked && (
                <Badge variant="outline">数值锁定</Badge>
              )}
              <Badge variant="secondary">{editingCharacter.source}</Badge>
            </div>
          </div>
          {isCampaignLocked && (
            <CardDescription>
              正在「{editingCharacter.lockedByCampaignTitle}」中使用，删除对应断点后才能编辑或删除。
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="min-h-0">
          <ScrollArea className="h-[calc(100vh-260px)] pr-3">
          <Tabs defaultValue="edit">
            <TabsList>
              <TabsTrigger value="edit">编辑</TabsTrigger>
              <TabsTrigger value="generate">生成参数</TabsTrigger>
            </TabsList>
            <TabsContent value="edit">
              <FieldGroup>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="library-name">姓名</FieldLabel>
                    <Input
                      id="library-name"
                      value={editingCharacter.name}
                      readOnly={isCampaignLocked}
                      onChange={(event) =>
                        updateCharacter({ name: event.target.value })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="library-concept">概念</FieldLabel>
                    <Input
                      id="library-concept"
                      value={editingCharacter.concept}
                      readOnly={isCampaignLocked}
                      onChange={(event) =>
                        updateCharacter({ concept: event.target.value })
                      }
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="library-background">背景</FieldLabel>
                  <Textarea
                    id="library-background"
                    value={editingCharacter.background}
                    readOnly={isCampaignLocked}
                    onChange={(event) =>
                      updateCharacter({
                        background: event.target.value,
                      })
                    }
                  />
                </Field>
                <div className="grid gap-4 md:grid-cols-4">
                  {Object.entries(editingCharacter.attributes).map(([key, value]) => (
                    <Field key={key}>
                      <FieldLabel htmlFor={`attr-${key}`}>{key}</FieldLabel>
                      <Input
                        id={`attr-${key}`}
                        type="number"
                        min={1}
                        max={5}
                        value={value}
                        readOnly={isCampaignLocked || !attributesUnlocked}
                        onMouseDown={() => {
                          if (!attributesUnlocked || isCampaignLocked) {
                            requestAttributeUnlock();
                          }
                        }}
                        onFocus={() => {
                          if (!attributesUnlocked || isCampaignLocked) {
                            requestAttributeUnlock();
                          }
                        }}
                        onChange={(event) => {
                          if (!requestAttributeUnlock()) {
                            return;
                          }
                          updateCharacter({
                            attributes: {
                              ...editingCharacter.attributes,
                              [key]: Number(event.target.value),
                            },
                          });
                        }}
                      />
                    </Field>
                  ))}
                </div>
                <Field>
                  <FieldLabel htmlFor="library-notes">备注</FieldLabel>
                  <Textarea
                    id="library-notes"
                    value={editingCharacter.notes}
                    readOnly={isCampaignLocked}
                    onChange={(event) =>
                      updateCharacter({ notes: event.target.value })
                    }
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    onClick={() => onSave(editingCharacter)}
                    disabled={busy || isCampaignLocked}
                  >
                    <SaveIcon data-icon="inline-start" />
                    保存角色卡
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => onDelete(editingCharacter.id)}
                    disabled={busy || isCampaignLocked}
                  >
                    <Trash2Icon data-icon="inline-start" />
                    删除
                  </Button>
                </div>
              </FieldGroup>
            </TabsContent>
            <TabsContent value="generate">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="library-seed-concept">角色概念</FieldLabel>
                  <Input
                    id="library-seed-concept"
                    value={seed.concept}
                    onChange={(event) => onSeedChange({ ...seed, concept: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="library-seed-tone">调性</FieldLabel>
                  <Input
                    id="library-seed-tone"
                    value={seed.tone}
                    onChange={(event) => onSeedChange({ ...seed, tone: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="library-seed-profession">职业倾向</FieldLabel>
                  <Input
                    id="library-seed-profession"
                    value={seed.profession}
                    onChange={(event) =>
                      onSeedChange({ ...seed, profession: event.target.value })
                    }
                  />
                </Field>
                <Button onClick={onGenerate} disabled={busy}>
                  <SparklesIcon data-icon="inline-start" />
                  生成并保存到角色库
                </Button>
              </FieldGroup>
            </TabsContent>
          </Tabs>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsPage({
  preferences,
  onChange,
}: {
  preferences: AppPreferences;
  onChange: (preferences: AppPreferences) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>应用设置</CardTitle>
        <CardDescription>
          调整界面主题、显示密度和玩家资料。AI provider 与模型在右上角“AI 设置”中配置。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AppPreferencesForm preferences={preferences} onChange={onChange} />
      </CardContent>
    </Card>
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

function AvatarPreview({
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

function SettingsSheet({
  settings,
  busy,
  fetchingProviderId,
  onChange,
  onSave,
  onFetchProviderModels,
}: {
  settings?: AiSettings;
  busy: boolean;
  fetchingProviderId?: string;
  onChange: (settings: AiSettings) => void;
  onSave: () => void;
  onFetchProviderModels: (providerId: string) => void;
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
            fetchingProviderId={fetchingProviderId}
            onChange={onChange}
            onSave={onSave}
            onFetchProviderModels={onFetchProviderModels}
          />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function SettingsForm({
  settings,
  busy,
  fetchingProviderId,
  onChange,
  onSave,
  onFetchProviderModels,
}: {
  settings: AiSettings;
  busy: boolean;
  fetchingProviderId?: string;
  onChange: (settings: AiSettings) => void;
  onSave: () => void;
  onFetchProviderModels: (providerId: string) => void;
}) {
  return (
    <FieldGroup>
      <FieldSet>
        <div className="flex items-center justify-between gap-3">
          <div>
            <FieldLabel>Provider</FieldLabel>
            <FieldDescription>
              每个 Provider 都是一个 OpenAI-compatible API 端点，可独立保存模型列表。
            </FieldDescription>
          </div>
          <Button
            variant="outline"
            onClick={() => onChange(addProvider(settings))}
            disabled={busy}
          >
            <PlusIcon data-icon="inline-start" />
            添加 Provider
          </Button>
        </div>
        <div className="flex flex-col gap-4">
          {settings.providers.map((provider, index) => (
            <ProviderEditor
              key={provider.id}
              provider={provider}
              index={index}
              settings={settings}
              busy={busy}
              isFetching={fetchingProviderId === provider.id}
              onChange={onChange}
              onFetchProviderModels={onFetchProviderModels}
            />
          ))}
        </div>
      </FieldSet>
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
      <FieldSet>
        <FieldLabel>AI 角色模型</FieldLabel>
        <FieldDescription>
          每个角色可以选择来自不同 Provider 的模型；关闭开关后，该角色不会参与回合。
        </FieldDescription>
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
      </FieldSet>
      <Button onClick={onSave} disabled={busy}>
        <SaveIcon data-icon="inline-start" />
        保存设置
      </Button>
    </FieldGroup>
  );
}

function ProviderEditor({
  provider,
  index,
  settings,
  busy,
  isFetching,
  onChange,
  onFetchProviderModels,
}: {
  provider: AiProviderConfig;
  index: number;
  settings: AiSettings;
  busy: boolean;
  isFetching: boolean;
  onChange: (settings: AiSettings) => void;
  onFetchProviderModels: (providerId: string) => void;
}) {
  const canRemove = settings.providers.length > 1;

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <Badge variant="secondary">Provider {index + 1}</Badge>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => onFetchProviderModels(provider.id)}
            disabled={busy || isFetching}
          >
            <RefreshCwIcon data-icon="inline-start" />
            {isFetching ? "获取中" : "获取模型"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onChange(removeProvider(settings, provider.id))}
            disabled={busy || !canRemove}
          >
            <Trash2Icon />
            <span className="sr-only">删除 Provider</span>
          </Button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
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
      <Field>
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
    </div>
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

function GameConsole({
  detail,
  busy,
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
        <div>
          <h2 className="text-2xl font-semibold">{detail.campaign.title}</h2>
          <p className="text-sm text-muted-foreground">{detail.campaign.premise}</p>
        </div>
        <TabsList>
          <TabsTrigger value="play">游戏</TabsTrigger>
          <TabsTrigger value="character">角色卡</TabsTrigger>
          <TabsTrigger value="npcs">NPC</TabsTrigger>
          <TabsTrigger value="archive">记录</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="play" className="min-h-0 flex-1">
        <div className="h-full min-h-0">
          <Card className="min-h-0 min-w-0 overflow-hidden">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>游戏进程</CardTitle>
                  <CardDescription>每一轮玩家行动和 AI 回应都会写入本地存档。</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{detail.session.title}</Badge>
                  <Badge variant="outline">{detail.messages.length} 条记录</Badge>
                  <Badge variant="outline">{detail.npcs.length} 名 NPC</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
              <ScrollArea className="min-h-0 flex-1 rounded-lg border">
                <div className="flex flex-col gap-3 p-4">
                  {detail.messages.map((message) => (
                    <div key={message.id} className="rounded-lg border bg-card p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <MessageAuthorBadge message={message} detail={detail} />
                        <span className="text-xs text-muted-foreground">
                          {new Date(message.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="whitespace-pre-wrap text-sm leading-6">
                        <MarkdownMessage content={message.content} />
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <FieldGroup className="shrink-0">
                <Field orientation="horizontal">
                  <Switch checked={proxyMode} onCheckedChange={onProxyModeChange} />
                  <div className="min-w-0 flex-1">
                    <FieldLabel>代理模式</FieldLabel>
                    <FieldDescription>
                      让独立 AI 先给出可选行动；你可以点选后修改，也可以完全手写。
                    </FieldDescription>
                  </div>
                  <Button
                    variant="outline"
                    onClick={onGenerateProxyOptions}
                    disabled={!proxyMode || busy || generatingProxyOptions}
                  >
                    <SparklesIcon data-icon="inline-start" />
                    {generatingProxyOptions ? "生成中" : "生成选项"}
                  </Button>
                </Field>
                {proxyMode && proxyOptions.length > 0 && (
                  <Field>
                    <FieldLabel>代理建议</FieldLabel>
                    <div className="grid gap-2 md:grid-cols-2">
                      {proxyOptions.map((option) => (
                        <Button
                          key={option}
                          variant={playerAction === option ? "secondary" : "outline"}
                          className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
                          onClick={() => onAcceptProxyOption(option)}
                        >
                          {option}
                        </Button>
                      ))}
                    </div>
                  </Field>
                )}
                <Field orientation="horizontal">
                  <div className="min-w-0 flex-1">
                    <FieldLabel>手动骰子</FieldLabel>
                    <FieldDescription>
                      GM 工具掷骰会自动入事件记录；这里仅供玩家临时手动抛骰。
                    </FieldDescription>
                  </div>
                  <div className="flex min-w-[260px] gap-2">
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
                    <Badge variant="secondary">
                      {diceResult.total} · {diceResult.rolls.join(" + ")}
                    </Badge>
                  )}
                </Field>
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

function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <span className="mb-2 block last:mb-0">{children}</span>,
        ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 list-decimal pl-5">{children}</ol>,
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground">
            {children}
          </blockquote>
        ),
        code: ({ children }) => (
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
        ),
        pre: ({ children }) => (
          <pre className="my-2 overflow-auto rounded bg-muted p-3 text-xs">
            {children}
          </pre>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

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

function CharacterCardPanel({
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

export default App;
