import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArchiveIcon,
  BookOpenIcon,
  BotIcon,
  ChevronDownIcon,
  DatabaseIcon,
  Dice5Icon,
  ExternalLinkIcon,
  LockIcon,
  PlusIcon,
  PlayIcon,
  RefreshCwIcon,
  SaveIcon,
  SettingsIcon,
  SparklesIcon,
  SwordsIcon,
  Trash2Icon,
  UnlockIcon,
  UploadIcon,
  UserIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  defaultAiSettings,
  fetchProviderModels,
  finalizeCharacterCreation,
  formatModelValue,
  generateProxyActionOptions,
  createCharacterCreationSession,
  parseModelValue,
  runCharacterCreationGmTurn,
  testProviderConnection,
} from "@/lib/ai";
import { mergeSettings, playTurnStreaming } from "@/lib/game";
import {
  characterSheetTemplates,
  cloneCharacterForCampaign,
  createEmptyCharacter,
  createRandomCharacter,
  getCharacterSheetTemplate,
  rulesets,
  toLibraryEntry,
} from "@/lib/rulesets";
import { createRepository, type GameRepository } from "@/lib/storage";
import { createBufferedMessageDeltaController } from "@/lib/streaming-ui";
import {
  buildRulesRagContext,
  importRulebookDocument,
  type PineconeUsageEvent,
} from "@/lib/rag";
import { PINECONE_USAGE_URL } from "@/lib/pinecone";
import {
  getDisplayFilePath,
  isSupportedRulebookFile,
  readRulebookFiles,
} from "@/lib/rulebook-files";
import { createId, nowIso } from "@/lib/id";
import {
  applyPreferences,
  createProviderAvailableStatus,
  createProviderCheckingStatus,
  createProviderUnavailableStatus,
  loadPreferences,
  preferencesKey,
  type AccentColor,
  type AppPreferences,
  type ProviderStatus,
  type ThemeMode,
} from "@/lib/ui-state";
import type {
  AiAgentConfig,
  AiProviderConfig,
  AiSettings,
  Campaign,
  CampaignDetail,
  CharacterCard,
  CharacterCreationSession,
  CharacterLibraryEntry,
  GameMessage,
  RulebookDocument,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  characterConcept: "",
  characterMode: "gm" as CharacterMode,
  existingCharacterId: "",
};

type CharacterMode = "gm" | "random" | "existing" | "manual";

const defaultRulebookCharacterType = "通用";
const rulebookCharacterTypeOptions = characterSheetTemplates.map(
  (template) => template.name,
);

const defaultSeed = {
  concept: "",
  tone: "",
  profession: "",
};

const accentOptions: Array<{ value: AccentColor; label: string }> = [
  { value: "teal", label: "青绿" },
  { value: "indigo", label: "靛蓝" },
  { value: "rose", label: "玫红" },
  { value: "amber", label: "琥珀" },
];

const diceExpressions = ["1d4", "1d6", "2d6", "1d8", "1d10", "1d12", "1d20", "1d100"];
const maxVisiblePlayMessages = 120;

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
  const [rulebookDocuments, setRulebookDocuments] = useState<RulebookDocument[]>([]);
  const [rulebookCategory, setRulebookCategory] = useState("轻规则 v1");
  const [rulebookCharacterType, setRulebookCharacterType] = useState(
    defaultRulebookCharacterType,
  );
  const [rulebookFiles, setRulebookFiles] = useState<File[]>([]);
  const [editingCharacter, setEditingCharacter] = useState<CharacterLibraryEntry>(() =>
    toLibraryEntry(createEmptyCharacter("light-rules-v1"), "manual"),
  );
  const [detail, setDetail] = useState<CampaignDetail>();
  const [settings, setSettings] = useState<AiSettings>();
  const [activePage, setActivePage] = useState<"game" | "characters" | "rules">("game");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fetchingProviderId, setFetchingProviderId] = useState<string>();
  const [testingProviderId, setTestingProviderId] = useState<string>();
  const [providerStatuses, setProviderStatuses] = useState<Record<string, ProviderStatus>>(
    {},
  );
  const [pineconeUsage, setPineconeUsage] = useState<PineconeUsageEvent>();
  const [preferences, setPreferences] = useState<AppPreferences>(() =>
    loadPreferences(),
  );
  const [campaignForm, setCampaignForm] = useState(defaultCampaignForm);
  const [seed, setSeed] = useState(defaultSeed);
  const [libraryCreationSession, setLibraryCreationSession] =
    useState<CharacterCreationSession | null>(null);
  const [libraryCreationInput, setLibraryCreationInput] = useState("");
  const [campaignCreationSession, setCampaignCreationSession] =
    useState<CharacterCreationSession | null>(null);
  const [campaignCreationInput, setCampaignCreationInput] = useState("");
  const [creationOverlay, setCreationOverlay] = useState<"library" | "campaign" | null>(
    null,
  );
  const [proxyMode, setProxyMode] = useState(false);
  const [proxyOptions, setProxyOptions] = useState<string[]>([]);
  const [generatingProxyOptions, setGeneratingProxyOptions] = useState(false);
  const [importingRulebook, setImportingRulebook] = useState(false);
  const [deleteCampaignId, setDeleteCampaignId] = useState<string | null>(null);
  const [playerAction, setPlayerAction] = useState(
    "我检查求救信上的水渍和折痕，寻找寄信人的线索。",
  );
  const [streamingMessageIds, setStreamingMessageIds] = useState<Set<string>>(
    () => new Set(),
  );

  const campaignRulebookOptions = useMemo(
    () => getCampaignRulebookOptions(rulebookDocuments),
    [rulebookDocuments],
  );
  const campaignRulesetDescription = getRulesetDescription(campaignForm.rulesetId);
  const campaignCharacterType = getRulebookCharacterTypeForRuleset(
    campaignForm.rulesetId,
    rulebookDocuments,
  );
  const libraryCharacterType = getRulebookCharacterTypeForRuleset(
    libraryRulesetId,
    rulebookDocuments,
  );
  const activeCampaignRulebook = detail
    ? rulebookDocuments.find(
        (document) => document.rulesetId === detail.campaign.rulesetId,
      )
    : undefined;
  const activeCampaignRulesetLabel = detail
    ? getRulebookCategoryLabel(detail.campaign.rulesetId)
    : "";
  const activeCampaignCharacterTypeLabel = activeCampaignRulebook
    ? getRulebookCharacterTypeLabel(activeCampaignRulebook)
    : "";
  const visibleLibraryCharacters = useMemo(
    () =>
      libraryCharacters.filter(
        (character) =>
          character.rulesetId === libraryRulesetId &&
          getCharacterTypeLabel(character) === libraryCharacterType,
      ),
    [libraryCharacters, libraryRulesetId, libraryCharacterType],
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
        const [
          storedSettings,
          storedCampaigns,
          storedLibraryCreationDraft,
          storedCampaignCreationDraft,
        ] = await Promise.all([
          repository.getSettings(),
          repository.listCampaigns(),
          repository.getCharacterCreationDraft("library"),
          repository.getCharacterCreationDraft("campaign"),
        ]);
        setSettings(storedSettings);
        setCampaigns(storedCampaigns);
        setLibraryCharacters(await repository.listLibraryCharacters());
        const storedRulebookDocuments = await repository.listRulebookDocuments();
        setRulebookDocuments(storedRulebookDocuments);
        if (
          storedLibraryCreationDraft &&
          storedLibraryCreationDraft.session?.status !== "completed"
        ) {
          setLibraryCreationSession(storedLibraryCreationDraft.session);
          setLibraryCreationInput(storedLibraryCreationDraft.input);
          setLibraryRulesetId(
            readStringState(
              storedLibraryCreationDraft.state.rulesetId,
              "light-rules-v1",
            ),
          );
          setSeed({
            ...defaultSeed,
            ...readObjectState<typeof defaultSeed>(
              storedLibraryCreationDraft.state.seed,
            ),
          });
        }
        if (
          storedCampaignCreationDraft &&
          storedCampaignCreationDraft.session?.status !== "completed"
        ) {
          setCampaignCreationSession(storedCampaignCreationDraft.session);
          setCampaignCreationInput(storedCampaignCreationDraft.input);
          setCampaignForm({
            ...defaultCampaignForm,
            ...readObjectState<typeof defaultCampaignForm>(
              storedCampaignCreationDraft.state.campaignForm,
            ),
          });
        }
        const restoredOverlay = storedLibraryCreationDraft?.overlayOpen
          ? "library"
          : storedCampaignCreationDraft?.overlayOpen
            ? "campaign"
            : null;
        if (restoredOverlay) {
          setCreationOverlay(restoredOverlay);
        }
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

  useEffect(() => {
    if (loading || !repositoryRef.current) {
      return;
    }
    const repository = repositoryRef.current;
    async function persist() {
      if (
        !libraryCreationSession ||
        libraryCreationSession.status === "completed"
      ) {
        if (!libraryCreationInput.trim()) {
          await repository.deleteCharacterCreationDraft("library");
          return;
        }
      }
      await repository.saveCharacterCreationDraft({
        scope: "library",
        session:
          libraryCreationSession?.status === "completed"
            ? null
            : libraryCreationSession,
        input: libraryCreationInput,
        state: {
          rulesetId: libraryRulesetId,
          characterType: libraryCharacterType,
          seed,
        },
        overlayOpen: creationOverlay === "library",
        updatedAt: nowIso(),
      });
    }
    void persist();
  }, [
    creationOverlay,
    libraryCharacterType,
    libraryCreationInput,
    libraryCreationSession,
    libraryRulesetId,
    loading,
    seed,
  ]);

  useEffect(() => {
    if (loading || !repositoryRef.current) {
      return;
    }
    const repository = repositoryRef.current;
    async function persist() {
      if (
        !campaignCreationSession ||
        campaignCreationSession.status === "completed"
      ) {
        if (!campaignCreationInput.trim()) {
          await repository.deleteCharacterCreationDraft("campaign");
          return;
        }
      }
      await repository.saveCharacterCreationDraft({
        scope: "campaign",
        session:
          campaignCreationSession?.status === "completed"
            ? null
            : campaignCreationSession,
        input: campaignCreationInput,
        state: {
          campaignForm,
          characterType: campaignCharacterType,
        },
        overlayOpen: creationOverlay === "campaign",
        updatedAt: nowIso(),
      });
    }
    void persist();
  }, [
    campaignCharacterType,
    campaignCreationInput,
    campaignCreationSession,
    campaignForm,
    creationOverlay,
    loading,
  ]);

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

  async function reloadRulebooks() {
    setRulebookDocuments(await requireRepository().listRulebookDocuments());
  }

  async function buildCharacterCreationContext(
    rulesetId: string,
    characterType: string,
    playerInput = "",
  ): Promise<string> {
    if (!settings) {
      return "";
    }
    try {
      return await buildRulesRagContext(
        requireRepository(),
        settings,
        rulesetId,
        [
          "角色创建",
          "制卡",
          "玩家角色卡",
          "属性",
          "技能",
          "点数分配",
          characterType,
          playerInput,
        ]
          .filter(Boolean)
          .join("\n"),
        { onPineconeUsage: setPineconeUsage },
      );
    } catch (error) {
      console.warn("制卡规则书 RAG 检索失败，继续使用模板制卡。", error);
      toast.warning(
        `${getErrorMessage(error, "制卡规则书 RAG 检索失败")} 已降级为仅使用角色卡模板制卡。`,
      );
      return "";
    }
  }

  function requireRepository(): GameRepository {
    if (!repositoryRef.current) {
      throw new Error("存储尚未初始化。");
    }
    return repositoryRef.current;
  }

  async function handleStartLibraryCreation() {
    setBusy(true);
    try {
      const rulesContext = await buildCharacterCreationContext(
        libraryRulesetId,
        libraryCharacterType,
        seed.concept,
      );
      setLibraryCreationSession(
        createCharacterCreationSession(
          libraryRulesetId,
          libraryCharacterType,
          seed,
          rulesContext,
        ),
      );
      setCreationOverlay("library");
      toast.success("制卡 GM 已准备好。");
    } catch (error) {
      console.error("启动制卡 GM 失败", error);
      toast.error(getErrorMessage(error, "启动制卡 GM 失败"));
    } finally {
      setBusy(false);
    }
  }

  async function handleSendLibraryCreationMessage() {
    if (!settings) {
      return;
    }
    const session =
      libraryCreationSession ??
      createCharacterCreationSession(libraryRulesetId, libraryCharacterType, seed);
    const input = libraryCreationInput;
    const streamingMessageId = createId("chargenmsg");
    const optimisticSession: CharacterCreationSession = {
      ...session,
      messages: [
        ...session.messages,
        {
          id: createId("chargenmsg"),
          author: "player",
          content: input,
          createdAt: nowIso(),
        },
        {
          id: streamingMessageId,
          author: "GM",
          content: "",
          createdAt: nowIso(),
        },
      ],
      status: "chatting",
      updatedAt: nowIso(),
    };
    setLibraryCreationInput("");
    setLibraryCreationSession(optimisticSession);
    setBusy(true);
    try {
      const rulesContext = await buildCharacterCreationContext(
        libraryRulesetId,
        libraryCharacterType,
        input,
      );
      const nextSession = await runCharacterCreationGmTurn(
        settings,
        session,
        input,
        rulesContext,
        (token) => {
          setLibraryCreationSession((current) =>
            current
              ? {
                  ...current,
                  messages: current.messages.map((message) =>
                    message.id === streamingMessageId
                      ? { ...message, content: `${message.content}${token}` }
                      : message,
                  ),
                }
              : current,
          );
        },
      );
      setLibraryCreationSession(nextSession);
    } catch (error) {
      setLibraryCreationInput(input);
      console.error("制卡 GM 回合失败", error);
      toast.error(getErrorMessage(error, "制卡 GM 回合失败"));
    } finally {
      setBusy(false);
    }
  }

  async function handleFinalizeLibraryCreation() {
    if (!settings || !libraryCreationSession) {
      return;
    }
    setBusy(true);
    try {
      const character = await finalizeCharacterCreation(settings, {
        ...libraryCreationSession,
        status: "generating",
      });
      const entry = toLibraryEntry(character, "ai");
      await requireRepository().saveLibraryCharacter(entry);
      await requireRepository().deleteCharacterCreationDraft("library");
      setEditingCharacter(entry);
      setLibraryCreationSession(null);
      setLibraryCreationInput("");
      setCreationOverlay(null);
      await reloadLibrary();
      toast.success("制卡 GM 已完成角色卡并加入角色库。");
    } catch (error) {
      console.error("完成制卡失败", error);
      toast.error(getErrorMessage(error, "完成制卡失败"));
    } finally {
      setBusy(false);
    }
  }

  async function handleStartCampaignCreation() {
    setBusy(true);
    try {
      const rulesContext = await buildCharacterCreationContext(
        campaignForm.rulesetId,
        campaignCharacterType,
        campaignForm.characterConcept,
      );
      setCampaignCreationSession(
        createCharacterCreationSession(
          campaignForm.rulesetId,
          campaignCharacterType,
          {
            concept: campaignForm.characterConcept,
            tone: campaignForm.premise,
            profession: "",
          },
          rulesContext,
        ),
      );
      setCreationOverlay("campaign");
      toast.success("战役制卡 GM 已准备好。");
    } catch (error) {
      console.error("启动战役制卡 GM 失败", error);
      toast.error(getErrorMessage(error, "启动战役制卡 GM 失败"));
    } finally {
      setBusy(false);
    }
  }

  async function handleSendCampaignCreationMessage() {
    if (!settings) {
      return;
    }
    const session =
      campaignCreationSession ??
      createCharacterCreationSession(campaignForm.rulesetId, campaignCharacterType, {
        concept: campaignForm.characterConcept,
        tone: campaignForm.premise,
        profession: "",
      });
    const input = campaignCreationInput;
    const streamingMessageId = createId("chargenmsg");
    const optimisticSession: CharacterCreationSession = {
      ...session,
      messages: [
        ...session.messages,
        {
          id: createId("chargenmsg"),
          author: "player",
          content: input,
          createdAt: nowIso(),
        },
        {
          id: streamingMessageId,
          author: "GM",
          content: "",
          createdAt: nowIso(),
        },
      ],
      status: "chatting",
      updatedAt: nowIso(),
    };
    setCampaignCreationInput("");
    setCampaignCreationSession(optimisticSession);
    setBusy(true);
    try {
      const rulesContext = await buildCharacterCreationContext(
        campaignForm.rulesetId,
        campaignCharacterType,
        input,
      );
      const nextSession = await runCharacterCreationGmTurn(
        settings,
        session,
        input,
        rulesContext,
        (token) => {
          setCampaignCreationSession((current) =>
            current
              ? {
                  ...current,
                  messages: current.messages.map((message) =>
                    message.id === streamingMessageId
                      ? { ...message, content: `${message.content}${token}` }
                      : message,
                  ),
                }
              : current,
          );
        },
      );
      setCampaignCreationSession(nextSession);
    } catch (error) {
      setCampaignCreationInput(input);
      console.error("战役制卡 GM 回合失败", error);
      toast.error(getErrorMessage(error, "战役制卡 GM 回合失败"));
    } finally {
      setBusy(false);
    }
  }

  async function handleFinalizeCampaignCreation() {
    if (!settings || !campaignCreationSession) {
      return;
    }
    setBusy(true);
    try {
      const character = await finalizeCharacterCreation(settings, {
        ...campaignCreationSession,
        status: "generating",
      });
      await requireRepository().deleteCharacterCreationDraft("campaign");
      setCampaignCreationSession({
        ...campaignCreationSession,
        draft: character,
        status: "completed",
        updatedAt: nowIso(),
      });
      setCreationOverlay(null);
      toast.success("玩家角色卡已完成，可以创建战役。");
    } catch (error) {
      console.error("完成战役制卡失败", error);
      toast.error(getErrorMessage(error, "完成战役制卡失败"));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateCampaign() {
    setBusy(true);
    try {
      const selectedLibraryCharacter = libraryCharacters.find(
        (character) => character.id === campaignForm.existingCharacterId,
      );
      if (campaignForm.characterMode === "existing" && !selectedLibraryCharacter) {
        throw new Error("请选择一个已有角色卡，或改用 GM 制卡/随机新角色/手动生成。");
      }
      if (
        campaignForm.characterMode === "gm" &&
        campaignCreationSession?.status !== "completed"
      ) {
        throw new Error("请先用制卡 GM 完成玩家角色卡。");
      }
      if (selectedLibraryCharacter?.lockedByCampaignId) {
        throw new Error("该角色卡已经加入其他战役，删除对应断点后才能再次使用。");
      }
      if (
        selectedLibraryCharacter &&
        (selectedLibraryCharacter.rulesetId !== campaignForm.rulesetId ||
          getCharacterTypeLabel(selectedLibraryCharacter) !== campaignCharacterType)
      ) {
        throw new Error("只能导入与当前战役规则书和角色卡类型一致的角色卡。");
      }
      const character =
        campaignForm.characterMode === "existing" && selectedLibraryCharacter
          ? cloneCharacterForCampaign(selectedLibraryCharacter)
          : campaignForm.characterMode === "gm" && campaignCreationSession
            ? cloneCharacterForCampaign(campaignCreationSession.draft)
          : campaignForm.characterMode === "manual"
            ? createEmptyCharacter(
                campaignForm.rulesetId,
                campaignForm.characterConcept,
                campaignCharacterType,
              )
            : createRandomCharacter(campaignForm.rulesetId, campaignCharacterType);
      const nextDetail = await requireRepository().createCampaign({
        title: campaignForm.title || "未命名战役",
        premise: campaignForm.premise || "一场尚未揭晓的单人冒险。",
        rulesetId: campaignForm.rulesetId,
        character,
        sourceCharacterId: selectedLibraryCharacter?.id,
      });
      setDetail(nextDetail);
      setCampaignCreationSession(null);
      setCampaignCreationInput("");
      await requireRepository().deleteCharacterCreationDraft("campaign");
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
        characterType: character.characterType || libraryCharacterType,
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

  async function handleImportRulebook() {
    if (!settings) {
      return;
    }

    setImportingRulebook(true);
    try {
      const category = rulebookCategory.trim();
      if (!category) {
        throw new Error("请先填写规则书库名称。");
      }
      const rulebook = await readRulebookFiles(rulebookFiles);
      const document = await importRulebookDocument(requireRepository(), {
        rulesetId: category,
        characterType: rulebookCharacterType,
        title: category,
        sourceName: rulebook.sourceName,
        content: rulebook.content,
        settings,
        onPineconeUsage: setPineconeUsage,
      });
      setRulebookFiles([]);
      await reloadRulebooks();
      toast.success(
        `已导入 ${rulebook.fileCount} 个文件，生成 ${document.chunkCount} 个检索片段。`,
      );
    } catch (error) {
      console.error("导入规则书失败", error);
      toast.error(getErrorMessage(error, "导入规则书失败"));
    } finally {
      setImportingRulebook(false);
    }
  }

  async function handleDeleteRulebook(documentId: string) {
    setBusy(true);
    try {
      await requireRepository().deleteRulebookDocument(documentId);
      await reloadRulebooks();
      toast.success("规则书已删除。");
    } catch (error) {
      console.error("删除规则书失败", error);
      toast.error(getErrorMessage(error, "删除规则书失败"));
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateRulebookCharacterType(
    documentId: string,
    characterType: string,
  ) {
    const nextCharacterType = characterType.trim() || defaultRulebookCharacterType;
    setRulebookDocuments((documents) =>
      documents.map((document) =>
        document.id === documentId
          ? { ...document, characterType: nextCharacterType }
          : document,
      ),
    );
    try {
      await requireRepository().updateRulebookDocumentMeta(documentId, {
        characterType: nextCharacterType,
      });
      await reloadRulebooks();
      toast.success("规则书标签已更新。");
    } catch (error) {
      console.error("更新规则书标签失败", error);
      toast.error(getErrorMessage(error, "更新规则书标签失败"));
      await reloadRulebooks();
    }
  }

  async function handleDeleteCampaign() {
    if (!deleteCampaignId) {
      return;
    }

    const campaignId = deleteCampaignId;
    setBusy(true);
    try {
      await requireRepository().deleteCampaign(campaignId);
      setDeleteCampaignId(null);
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

  async function handleTestProvider(providerId: string) {
    if (!settings) {
      return;
    }

    const provider = settings.providers.find((item) => item.id === providerId);
    if (!provider) {
      toast.error("Provider 不存在。");
      return;
    }

    setTestingProviderId(providerId);
    setProviderStatuses((statuses) => ({
      ...statuses,
      [providerId]: createProviderCheckingStatus(),
    }));
    try {
      const result = await testProviderConnection(provider);
      setProviderStatuses((statuses) => ({
        ...statuses,
        [providerId]: createProviderAvailableStatus(
          result.model,
          result.latencyMs,
          `响应「${result.content.slice(0, 24)}」`,
        ),
      }));
    } catch (error) {
      setProviderStatuses((statuses) => ({
        ...statuses,
        [providerId]: createProviderUnavailableStatus(
          getErrorMessage(error, "测试 Provider 失败"),
        ),
      }));
    } finally {
      setTestingProviderId(undefined);
    }
  }

  async function handlePlayTurn() {
    if (!settings || !detail) {
      return;
    }

    setBusy(true);
    setStreamingMessageIds(new Set());
    const applyMessageDelta = (messageId: string, delta: string) => {
      setDetail((current) =>
        current && current.campaign.id === detail.campaign.id
          ? {
              ...current,
              messages: current.messages.map((message) =>
                message.id === messageId
                  ? { ...message, content: `${message.content}${delta}` }
                  : message,
              ),
            }
          : current,
      );
    };
    const messageDeltaBuffer = createBufferedMessageDeltaController(applyMessageDelta);
    try {
      const nextDetail = await playTurnStreaming(
        requireRepository(),
        detail,
        playerAction,
        settings,
        {
          onMessageAppend: (message) => {
            if (message.author !== "player" && !message.content.trim()) {
              setStreamingMessageIds((current) => new Set(current).add(message.id));
            }
            setDetail((current) =>
              current && current.campaign.id === detail.campaign.id
                ? { ...current, messages: [...current.messages, message] }
                : current,
            );
          },
          onMessageDelta: (messageId, token) => {
            messageDeltaBuffer.push(messageId, token);
          },
          onPineconeUsage: setPineconeUsage,
        },
      );
      messageDeltaBuffer.flush();
      setDetail(nextDetail);
      setStreamingMessageIds(new Set());
      await reloadCampaigns(nextDetail.campaign.id);
      setPlayerAction("");
      setProxyOptions([]);
      toast.success("回合已写入存档。");
    } catch (error) {
      messageDeltaBuffer.flush();
      setStreamingMessageIds(new Set());
      console.error("回合推进失败", error);
      toast.error(getErrorMessage(error, "回合推进失败"));
    } finally {
      messageDeltaBuffer.cancel();
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

  const campaignSidebarContent = (
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
                onValueChange={(rulesetId) => {
                  setCampaignForm({ ...campaignForm, rulesetId });
                  setCampaignCreationSession(null);
                }}
              >
                <SelectTrigger id="ruleset">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {campaignRulebookOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>{campaignRulesetDescription}</FieldDescription>
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
                onValueChange={(characterMode) => {
                  setCampaignForm({
                    ...campaignForm,
                    characterMode: characterMode as CharacterMode,
                  });
                  setCampaignCreationSession(null);
                }}
              >
                <SelectTrigger id="character-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="gm">GM 制卡</SelectItem>
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
                      <SelectLabel>
                        {getRulebookCategoryLabel(campaignForm.rulesetId)} ·{" "}
                        {campaignCharacterType}
                      </SelectLabel>
                      {libraryCharacters
                        .filter(
                          (character) =>
                            character.rulesetId === campaignForm.rulesetId &&
                            getCharacterTypeLabel(character) === campaignCharacterType,
                        )
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
                <FieldDescription>可在顶部“角色卡”页面维护自己的角色库。</FieldDescription>
              </Field>
            )}
            {campaignForm.characterMode === "gm" && (
              <Field>
                <FieldLabel>玩家角色卡</FieldLabel>
                <div className="rounded-md border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {campaignCreationSession?.status === "completed"
                          ? campaignCreationSession.draft.name
                          : "尚未完成 GM 制卡"}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {campaignCreationSession?.status === "completed"
                          ? campaignCreationSession.draft.concept
                          : "点击打开独立制卡页，与 GM 交流后生成玩家角色卡。"}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        campaignCreationSession
                          ? setCreationOverlay("campaign")
                          : void handleStartCampaignCreation()
                      }
                      disabled={busy}
                    >
                      <SparklesIcon data-icon="inline-start" />
                      {campaignCreationSession ? "打开制卡页" : "开始制卡"}
                    </Button>
                  </div>
                </div>
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
                      setDeleteCampaignId(campaign.id);
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
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg border bg-card">
              <SwordsIcon />
            </div>
            {activePage === "game" && detail ? (
              <Sheet>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    className="min-w-0 rounded-md text-left outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <h1 className="truncate text-lg font-semibold">{detail.campaign.title}</h1>
                    <p className="truncate text-sm text-muted-foreground">
                      {detail.campaign.premise}
                    </p>
                  </button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[360px] sm:max-w-[360px]">
                  <SheetHeader>
                    <SheetTitle>战役与断点</SheetTitle>
                    <SheetDescription>新建战役或切换已有断点。</SheetDescription>
                  </SheetHeader>
                  <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
                    {campaignSidebarContent}
                  </ScrollArea>
                </SheetContent>
              </Sheet>
            ) : (
              <div>
                <h1 className="text-lg font-semibold">多 AI 跑团控制台</h1>
                <p className="text-sm text-muted-foreground">
                  {preferences.displayName} · 本地 SQLite 存档 · 可插拔规则书
                </p>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <AvatarPreview preferences={preferences} size="sm" />
            {activeCampaignRulesetLabel && (
              <Badge variant="secondary">{activeCampaignRulesetLabel}</Badge>
            )}
            {activeCampaignCharacterTypeLabel && (
              <Badge variant="outline">{activeCampaignCharacterTypeLabel}</Badge>
            )}
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
              variant={activePage === "rules" ? "secondary" : "ghost"}
              onClick={() => setActivePage("rules")}
            >
              <BookOpenIcon data-icon="inline-start" />
              规则书
            </Button>
            <Button
              variant={settingsOpen ? "secondary" : "outline"}
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon data-icon="inline-start" />
              设置
            </Button>
            <SettingsSheet
              settings={settings}
              busy={busy}
              pineconeUsage={pineconeUsage}
              fetchingProviderId={fetchingProviderId}
              testingProviderId={testingProviderId}
              providerStatuses={providerStatuses}
              onChange={setSettings}
              onSave={handleSaveSettings}
              onFetchProviderModels={handleFetchProviderModels}
              onTestProvider={handleTestProvider}
            />
          </div>
        </div>
      </header>

      {activePage === "characters" ? (
        <main className="min-h-0 flex-1 overflow-hidden px-6 py-4">
          <div className="mx-auto h-full max-w-7xl">
          <CharacterLibraryPage
            busy={busy}
            rulesetId={libraryRulesetId}
            rulebookDocuments={rulebookDocuments}
            characters={visibleLibraryCharacters}
            editingCharacter={editingCharacter}
            seed={seed}
            onRulesetChange={async (rulesetId) => {
              setLibraryRulesetId(rulesetId);
              setLibraryCreationSession(null);
              setEditingCharacter(
                toLibraryEntry(
                  createEmptyCharacter(
                    rulesetId,
                    undefined,
                    getRulebookCharacterTypeForRuleset(rulesetId, rulebookDocuments),
                  ),
                  "manual",
                ),
              );
              await reloadLibrary();
            }}
            onEdit={setEditingCharacter}
            onEditingChange={setEditingCharacter}
            onSeedChange={setSeed}
            onStartCreation={handleStartLibraryCreation}
            onOpenCreation={() =>
              libraryCreationSession
                ? setCreationOverlay("library")
                : void handleStartLibraryCreation()
            }
            creationStatus={libraryCreationSession?.status}
            onNew={() =>
              setEditingCharacter(
                toLibraryEntry(
                  createEmptyCharacter(libraryRulesetId, undefined, libraryCharacterType),
                  "manual",
                ),
              )
            }
            onSave={handleSaveLibraryCharacter}
            onDelete={handleDeleteLibraryCharacter}
          />
          </div>
        </main>
      ) : activePage === "rules" ? (
        <main className="min-h-0 flex-1 overflow-hidden px-6 py-4">
          <div className="mx-auto h-full max-w-7xl">
            <RulebookPage
              busy={busy || importingRulebook}
              settings={settings}
              pineconeUsage={pineconeUsage}
              category={rulebookCategory}
              categories={getRulebookCategories(rulebookDocuments)}
              characterType={rulebookCharacterType}
              documents={rulebookDocuments.filter(
                (document) =>
                  getRulebookCategoryAliases(rulebookCategory).includes(
                    document.rulesetId,
                  ),
              )}
              files={rulebookFiles}
              onCategoryChange={setRulebookCategory}
              onCharacterTypeChange={setRulebookCharacterType}
              onFilesChange={setRulebookFiles}
              onImport={handleImportRulebook}
              onUpdateCharacterType={handleUpdateRulebookCharacterType}
              onDelete={handleDeleteRulebook}
            />
          </div>
        </main>
      ) : (
      <main
        className={`mx-auto grid min-h-0 w-full max-w-7xl flex-1 gap-4 overflow-hidden px-6 py-4 ${
          detail ? "lg:grid-cols-1" : "lg:grid-cols-[320px_1fr]"
        }`}
      >
        {!detail && (
          <aside className="min-h-0 overflow-hidden">
            <ScrollArea className="h-full pr-3">{campaignSidebarContent}</ScrollArea>
          </aside>
        )}

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {detail ? (
            <GameConsole
              detail={detail}
              busy={busy}
              streamingMessageIds={streamingMessageIds}
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
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-h-[min(760px,calc(100vh-3rem))] max-w-4xl overflow-hidden bg-popover/85 p-0 shadow-2xl backdrop-blur-md sm:max-w-4xl">
          <ScrollArea className="max-h-[min(760px,calc(100vh-3rem))]">
            <SettingsPage preferences={preferences} onChange={setPreferences} />
          </ScrollArea>
        </DialogContent>
      </Dialog>
      <DeleteCampaignDialog
        campaign={campaigns.find((campaign) => campaign.id === deleteCampaignId)}
        open={Boolean(deleteCampaignId)}
        busy={busy}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDeleteCampaignId(null);
          }
        }}
        onConfirm={() => void handleDeleteCampaign()}
      />
      {creationOverlay === "library" && (
        <CharacterCreationOverlay
          title="角色库 GM 制卡"
          subtitle={`${getRulebookCategoryLabel(libraryRulesetId)} · ${libraryCharacterType}`}
          busy={busy}
          session={libraryCreationSession}
          input={libraryCreationInput}
          onInputChange={setLibraryCreationInput}
          onStart={handleStartLibraryCreation}
          onSend={handleSendLibraryCreationMessage}
          onFinalize={handleFinalizeLibraryCreation}
          onReset={() => {
            setLibraryCreationSession(null);
            setLibraryCreationInput("");
            void requireRepository().deleteCharacterCreationDraft("library");
          }}
          onClose={() => setCreationOverlay(null)}
        />
      )}
      {creationOverlay === "campaign" && (
        <CharacterCreationOverlay
          title="战役 GM 制卡"
          subtitle={`${getRulebookCategoryLabel(campaignForm.rulesetId)} · ${campaignCharacterType}`}
          busy={busy}
          session={campaignCreationSession}
          input={campaignCreationInput}
          onInputChange={setCampaignCreationInput}
          onStart={handleStartCampaignCreation}
          onSend={handleSendCampaignCreationMessage}
          onFinalize={handleFinalizeCampaignCreation}
          onReset={() => {
            setCampaignCreationSession(null);
            setCampaignCreationInput("");
            void requireRepository().deleteCharacterCreationDraft("campaign");
          }}
          onClose={() => setCreationOverlay(null)}
        />
      )}
      <Toaster />
    </div>
  );
}

function DeleteCampaignDialog({
  campaign,
  open,
  busy,
  onOpenChange,
  onConfirm,
}: {
  campaign?: Campaign;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除断点</DialogTitle>
          <DialogDescription>
            确定删除「{campaign?.title ?? "该战役"}」吗？对应的断点、消息和战役角色会被删除；如果使用了角色库卡片，该卡片会被释放。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function readStringState(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function readObjectState<T extends object>(value: unknown): Partial<T> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Partial<T>)
    : {};
}

function CharacterLibraryPage({
  busy,
  rulesetId,
  rulebookDocuments,
  characters,
  editingCharacter,
  seed,
  onRulesetChange,
  onEdit,
  onEditingChange,
  onSeedChange,
  onStartCreation,
  onOpenCreation,
  creationStatus,
  onNew,
  onSave,
  onDelete,
}: {
  busy: boolean;
  rulesetId: string;
  rulebookDocuments: RulebookDocument[];
  characters: CharacterLibraryEntry[];
  editingCharacter: CharacterLibraryEntry;
  seed: typeof defaultSeed;
  onRulesetChange: (rulesetId: string) => void;
  onEdit: (character: CharacterLibraryEntry) => void;
  onEditingChange: (character: CharacterLibraryEntry) => void;
  onSeedChange: (seed: typeof defaultSeed) => void;
  onStartCreation: () => void;
  onOpenCreation: () => void;
  creationStatus?: CharacterCreationSession["status"];
  onNew: () => void;
  onSave: (character: CharacterLibraryEntry) => void;
  onDelete: (characterId: string) => void;
}) {
  const [attributeUnlockedCharacterId, setAttributeUnlockedCharacterId] = useState<string>();
  const isCampaignLocked = Boolean(editingCharacter.lockedByCampaignId);
  const requiresAttributeUnlock =
    editingCharacter.source === "ai" || editingCharacter.source === "random";
  const attributesUnlocked =
    !requiresAttributeUnlock || attributeUnlockedCharacterId === editingCharacter.id;
  const characterTemplate = getCharacterSheetTemplate(editingCharacter.characterType);

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
                  {getCampaignRulebookOptions(rulebookDocuments).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              当前角色卡类型：{getCharacterTypeLabel(editingCharacter)}
            </FieldDescription>
          </Field>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onNew} disabled={busy}>
              <PlusIcon data-icon="inline-start" />
              新建
            </Button>
            <Button onClick={onStartCreation} disabled={busy}>
              <SparklesIcon data-icon="inline-start" />
              新开制卡页
            </Button>
            <Button
              variant="outline"
              onClick={onOpenCreation}
              disabled={busy && !creationStatus}
            >
              <BotIcon data-icon="inline-start" />
              {creationStatus ? "打开制卡页" : "GM 制卡"}
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
                      {character.concept}
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
                  <AlertDescription>新建或使用生成器创建第一张角色卡。</AlertDescription>
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
              <CardDescription>
                {getRulebookCategoryLabel(editingCharacter.rulesetId)} ·{" "}
                {getCharacterTypeLabel(editingCharacter)}
              </CardDescription>
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
              {requiresAttributeUnlock && !isCampaignLocked && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    attributesUnlocked
                      ? setAttributeUnlockedCharacterId(undefined)
                      : requestAttributeUnlock()
                  }
                >
                  {attributesUnlocked ? <LockIcon data-icon="inline-start" /> : <UnlockIcon data-icon="inline-start" />}
                  {attributesUnlocked ? "重新锁定数值" : "解锁数值"}
                </Button>
              )}
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
                        min={characterTemplate.attributeMin}
                        max={characterTemplate.attributeMax}
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
                  <FieldLabel>技能</FieldLabel>
                  <div className="grid gap-3 md:grid-cols-3">
                    {Object.entries(editingCharacter.skills).map(([key, value]) => (
                      <Field key={key}>
                        <FieldLabel htmlFor={`skill-${key}`}>{key}</FieldLabel>
                        <Input
                          id={`skill-${key}`}
                          type="number"
                          min={characterTemplate.skillMin}
                          max={characterTemplate.skillMax}
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
                              skills: {
                                ...editingCharacter.skills,
                                [key]: Number(event.target.value),
                              },
                            });
                          }}
                        />
                      </Field>
                    ))}
                  </div>
                  <FieldDescription>{characterTemplate.description}</FieldDescription>
                </Field>
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
                <div className="rounded-md border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">独立 GM 制卡页</div>
                      <div className="text-xs text-muted-foreground">
                        生成对话会在覆盖主界面的独立页面中进行。
                      </div>
                    </div>
                    <Button onClick={onOpenCreation} disabled={busy && !creationStatus}>
                      <SparklesIcon data-icon="inline-start" />
                      {creationStatus ? "继续制卡" : "打开制卡页"}
                    </Button>
                  </div>
                  {creationStatus === "completed" && (
                    <Badge variant="secondary" className="mt-3">
                      已完成
                    </Badge>
                  )}
                </div>
              </FieldGroup>
            </TabsContent>
          </Tabs>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function CharacterCreationOverlay({
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

function RulebookPage({
  busy,
  settings,
  pineconeUsage,
  category,
  categories,
  characterType,
  documents,
  files,
  onCategoryChange,
  onCharacterTypeChange,
  onFilesChange,
  onImport,
  onUpdateCharacterType,
  onDelete,
}: {
  busy: boolean;
  settings?: AiSettings;
  pineconeUsage?: PineconeUsageEvent;
  category: string;
  categories: string[];
  characterType: string;
  documents: RulebookDocument[];
  files: File[];
  onCategoryChange: (category: string) => void;
  onCharacterTypeChange: (characterType: string) => void;
  onFilesChange: (files: File[]) => void;
  onImport: () => void;
  onUpdateCharacterType: (documentId: string, characterType: string) => void;
  onDelete: (documentId: string) => void;
}) {
  function handleFiles(fileList: FileList | null) {
    const selected = Array.from(fileList ?? []).filter(isSupportedRulebookFile);
    onFilesChange(dedupeRulebookFiles([...files, ...selected]));
  }

  const ragReady = Boolean(
    settings?.rag.enabled &&
      (settings.rag.source === "pinecone"
        ? settings.rag.pineconeApiKey.trim() &&
          settings.rag.pineconeIndexName.trim()
        : settings.rag.embeddingModel.trim()),
  );
  const ragModeLabel =
    settings?.rag.source === "pinecone"
      ? "上传到 Pinecone RAG"
      : "生成向量并导入";
  const canImport = Boolean(category.trim() && files.length && ragReady);
  const folderInputProps = {
    webkitdirectory: "",
    directory: "",
  } as Record<string, string>;

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[360px_1fr]">
      <Card className="flex h-full min-h-0 flex-col overflow-hidden">
        <CardHeader>
          <CardTitle>规则书导入</CardTitle>
          <CardDescription>
            仅导入带文字层、可复制文字的 PDF / TXT / Markdown，扫描版 PDF 会直接拒收。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <Alert>
            <BookOpenIcon />
            <AlertTitle>请上传文字版规则书</AlertTitle>
            <AlertDescription>
              扫描版 PDF 没有可抽取文本，无法进入规则书 RAG。建议从{" "}
              <a
                className="underline underline-offset-4"
                href="https://www.drivethrurpg.com/"
                target="_blank"
                rel="noreferrer"
              >
                DriveThruRPG
              </a>
              、{" "}
              <a
                className="underline underline-offset-4"
                href="https://itch.io/physical-games"
                target="_blank"
                rel="noreferrer"
              >
                itch.io Tabletop
              </a>
              、{" "}
              <a
                className="underline underline-offset-4"
                href="https://www.dndbeyond.com/sources/dnd/free-rules"
                target="_blank"
                rel="noreferrer"
              >
                D&D Free Rules
              </a>
              、{" "}
              <a
                className="underline underline-offset-4"
                href="https://paizo.com/pathfinder/getstarted"
                target="_blank"
                rel="noreferrer"
              >
                Paizo Pathfinder
              </a>
              、{" "}
              <a
                className="underline underline-offset-4"
                href="https://www.chaosium.com/cthulhu-quickstart/"
                target="_blank"
                rel="noreferrer"
              >
                Chaosium Quickstart
              </a>
              、{" "}
              <a
                className="underline underline-offset-4"
                href="https://fate-srd.com/"
                target="_blank"
                rel="noreferrer"
              >
                Fate SRD
              </a>{" "}
              等官方商店、SRD、开放规则文档或授权电子书渠道获取文字层 PDF /
              TXT / Markdown。
            </AlertDescription>
          </Alert>
          <Field>
            <FieldLabel htmlFor="rulebook-category">规则书库名称</FieldLabel>
            <Input
              id="rulebook-category"
              list="rulebook-categories"
              value={category}
              onChange={(event) => onCategoryChange(event.target.value)}
              placeholder="例如：克苏鲁 7版核心规则书"
            />
            <datalist id="rulebook-categories">
              {categories.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <FieldDescription>
              这里就是规则书分类；同名导入会进入同一个知识库，战役可复用。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="rulebook-character-type">角色卡类型标签</FieldLabel>
            <Input
              id="rulebook-character-type"
              list="rulebook-character-types"
              value={characterType}
              onChange={(event) => onCharacterTypeChange(event.target.value)}
              placeholder="例如：DnD、CoC、PF2e"
            />
            <datalist id="rulebook-character-types">
              {rulebookCharacterTypeOptions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <FieldDescription>
              用于提示该规则书适配的角色卡类型；当前角色卡结构仍沿用应用内置模板。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="rulebook-files">选择规则书文件</FieldLabel>
            <Input
              id="rulebook-files"
              type="file"
              multiple
              accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
              onChange={(event) => handleFiles(event.target.files)}
            />
            <FieldDescription>
              可一次选择多个文件；PDF 必须带文字层，扫描版不会导入。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="rulebook-folder">选择规则书文件夹</FieldLabel>
            <Input
              id="rulebook-folder"
              type="file"
              multiple
              accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
              onChange={(event) => handleFiles(event.target.files)}
              {...folderInputProps}
            />
            <FieldDescription>
              支持包含多个文字层 PDF 的文件夹；扫描版 PDF 会在导入时被拒收。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>待导入文件</FieldLabel>
            <div className="flex max-h-44 flex-col gap-2 overflow-auto rounded-lg border p-2">
              {files.length ? (
                files.map((file) => (
                  <div
                    key={getDisplayFilePath(file)}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate">{getDisplayFilePath(file)}</span>
                    <Badge variant="outline">{formatBytes(file.size)}</Badge>
                  </div>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">
                  尚未选择文件。请选择文件或整个规则书文件夹。
                </span>
              )}
            </div>
            {files.length > 0 && (
              <Button variant="outline" onClick={() => onFilesChange([])} disabled={busy}>
                <Trash2Icon data-icon="inline-start" />
                清空文件
              </Button>
            )}
          </Field>
          <Button onClick={onImport} disabled={busy || !canImport}>
            <UploadIcon data-icon="inline-start" />
            {busy ? "导入中" : ragModeLabel}
          </Button>
          {!ragReady && (
            <Alert>
              <SettingsIcon />
              <AlertTitle>RAG 尚未就绪</AlertTitle>
              <AlertDescription>
                请在 AI 设置里启用 RAG，并完成当前 RAG 分支的必填配置。
              </AlertDescription>
            </Alert>
          )}
          {settings?.rag.source === "pinecone" && (
            <PineconeUsageAlert usageEvent={pineconeUsage} />
          )}
        </CardContent>
      </Card>

      <Card className="min-h-0 overflow-hidden">
        <CardHeader>
          <CardTitle>规则书知识库</CardTitle>
          <CardDescription>
            “{category || "未命名规则书库"}”已有 {documents.length} 次导入；Pinecone 分支默认不启用 rerank。
          </CardDescription>
        </CardHeader>
        <CardContent className="min-h-0">
          <ScrollArea className="h-[calc(100vh-260px)] pr-3">
            <div className="flex flex-col gap-3">
              {documents.map((document) => (
                <div key={document.id} className="rounded-lg border p-3">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{document.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {document.chunkCount} 个片段 · {new Date(document.updatedAt).toLocaleString()}
                      </div>
                      <EditableRulebookCharacterType
                        key={`${document.id}-${getRulebookCharacterTypeLabel(document)}`}
                        document={document}
                        busy={busy}
                        onSave={onUpdateCharacterType}
                      />
                      <div className="truncate text-xs text-muted-foreground">
                        来源：{document.sourceName}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(document.id)}
                      disabled={busy}
                    >
                      <Trash2Icon />
                      <span className="sr-only">删除规则书</span>
                    </Button>
                  </div>
                  <p className="line-clamp-4 text-xs leading-5 text-muted-foreground">
                    {document.content.slice(0, 220)}
                  </p>
                </div>
              ))}
              {!documents.length && (
                <Alert>
                  <BookOpenIcon />
                  <AlertTitle>暂无规则书</AlertTitle>
                  <AlertDescription>
                    导入后，回合会自动检索相关片段并加入 AI 上下文。
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function EditableRulebookCharacterType({
  document,
  busy,
  onSave,
}: {
  document: RulebookDocument;
  busy: boolean;
  onSave: (documentId: string, characterType: string) => void;
}) {
  const [value, setValue] = useState(getRulebookCharacterTypeLabel(document));

  function save() {
    const nextValue = value.trim() || defaultRulebookCharacterType;
    if (nextValue === getRulebookCharacterTypeLabel(document)) {
      setValue(nextValue);
      return;
    }
    onSave(document.id, nextValue);
  }

  return (
    <Field className="max-w-48 gap-1">
      <FieldLabel htmlFor={`rulebook-character-type-${document.id}`} className="sr-only">
        角色卡类型标签
      </FieldLabel>
      <Input
        id={`rulebook-character-type-${document.id}`}
        list="rulebook-character-types"
        value={value}
        disabled={busy}
        className="h-7 text-xs"
        onChange={(event) => setValue(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </Field>
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

function getRulebookCategories(documents: RulebookDocument[]): string[] {
  return Array.from(
    new Set([
      "轻规则 v1",
      ...rulesets.map((ruleset) => ruleset.name),
      ...documents.map((document) => getRulebookCategoryLabel(document.rulesetId)),
    ]),
  ).filter(Boolean);
}

function getCampaignRulebookOptions(
  documents: RulebookDocument[],
): Array<{ value: string; label: string }> {
  const importedIds = new Set(documents.map((document) => document.rulesetId));
  const options: Array<{ value: string; label: string }> = rulesets.map((ruleset) => {
    const hasImportedAlias = importedIds.has(ruleset.name);
    return {
      value: ruleset.id,
      label: hasImportedAlias ? `${ruleset.name}（内置规则）` : ruleset.name,
    };
  });
  const seen = new Set(options.map((option) => option.value));

  for (const document of documents) {
    if (seen.has(document.rulesetId)) {
      continue;
    }
    const label = getRulebookCategoryLabel(document.rulesetId);
    const characterType = getRulebookCharacterTypeLabel(document);
    const duplicatesBuiltinLabel = rulesets.some((ruleset) => ruleset.name === label);
    options.push({
      value: document.rulesetId,
      label: duplicatesBuiltinLabel
        ? `${label}（已导入规则书 · ${characterType}）`
        : `${label} · ${characterType}`,
    });
    seen.add(document.rulesetId);
  }

  return options;
}

function getRulebookCategoryLabel(category: string): string {
  return rulesets.find((ruleset) => ruleset.id === category)?.name ?? category;
}

function getRulebookCharacterTypeLabel(document?: RulebookDocument): string {
  return document?.characterType?.trim() || defaultRulebookCharacterType;
}

function getRulebookCharacterTypeForRuleset(
  rulesetId: string,
  documents: RulebookDocument[],
): string {
  const document = documents.find((item) => item.rulesetId === rulesetId);
  if (document) {
    return getRulebookCharacterTypeLabel(document);
  }
  return rulesets.some((ruleset) => ruleset.id === rulesetId)
    ? defaultRulebookCharacterType
    : defaultRulebookCharacterType;
}

function getCharacterTypeLabel(character?: Pick<CharacterCard, "characterType">): string {
  return character?.characterType?.trim() || defaultRulebookCharacterType;
}

function getRulesetDescription(rulesetId: string): string {
  const ruleset = rulesets.find((item) => item.id === rulesetId);
  return ruleset?.description ?? "使用已导入的规则书知识库；角色卡类型由规则书标签决定。";
}

function getRulebookCategoryAliases(category: string): string[] {
  const aliases = new Set([category]);
  const matchedRuleset = rulesets.find((ruleset) => ruleset.name === category);
  if (matchedRuleset) {
    aliases.add(matchedRuleset.id);
  }
  return Array.from(aliases);
}

function dedupeRulebookFiles(files: File[]): File[] {
  const seen = new Set<string>();
  const result: File[] = [];
  for (const file of files) {
    const key = `${getDisplayFilePath(file)}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(file);
  }
  return result;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

function PineconeUsageAlert({
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

function GameConsole({
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

const MarkdownMessage = memo(function MarkdownMessage({ content }: { content: string }) {
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
