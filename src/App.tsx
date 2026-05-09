import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveIcon,
  BookOpenIcon,
  PlayIcon,
  SettingsIcon,
  SparklesIcon,
  SwordsIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import {
  defaultAiSettings,
  fetchProviderModels,
  finalizeCharacterCreation,
  generateProxyActionOptions,
  createCharacterCreationSession,
  runCharacterCreationGmTurn,
  testProviderConnection,
} from "@/lib/ai";
import { mergeSettings, playTurnStreaming } from "@/lib/game";
import {
  cloneCharacterForCampaign,
  createEmptyCharacter,
  createRandomCharacter,
  toLibraryEntry,
} from "@/lib/rulesets";
import { createRepository, type GameRepository } from "@/lib/storage";
import { createBufferedMessageDeltaController } from "@/lib/streaming-ui";
import {
  buildRulesRagContext,
  importRulebookDocument,
  type PineconeUsageEvent,
} from "@/lib/rag";
import { readRulebookFiles } from "@/lib/rulebook-files";
import { createId, nowIso } from "@/lib/id";
import {
  applyPreferences,
  createProviderAvailableStatus,
  createProviderCheckingStatus,
  createProviderUnavailableStatus,
  loadPreferences,
  preferencesKey,
  type AppPreferences,
  type ProviderStatus,
} from "@/lib/ui-state";
import type {
  AiSettings,
  Campaign,
  CampaignDetail,
  CharacterCreationSession,
  CharacterLibraryEntry,
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
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import {
  getCampaignRulebookOptions,
  getCharacterTypeLabel,
  getErrorMessage,
  getRulebookCategories,
  getRulebookCategoryAliases,
  getRulebookCategoryLabel,
  getRulebookCharacterTypeForRuleset,
  getRulebookCharacterTypeLabel,
  getRulesetDescription,
  defaultRulebookCharacterType,
  defaultSeed,
  readObjectState,
  readStringState,
} from "@/features/common/app-ui";
import { CharacterCreationOverlay } from "@/features/characters/CharacterCreationOverlay";
import { CharacterLibraryPage } from "@/features/characters/CharacterLibraryPage";
import { AvatarPreview, SettingsPage, SettingsSheet } from "@/features/settings/SettingsComponents";
import { RulebookPage } from "@/features/rulebooks/RulebookPage";
import { GameConsole } from "@/features/game/GameConsole";
import { DeleteCampaignDialog, LoadingShell } from "@/features/common/Shell";

const defaultCampaignForm = {
  title: "雾港失踪案",
  premise: "潮湿港城里，一封没有署名的求救信把主角引向旧灯塔。",
  rulesetId: "light-rules-v1",
  characterConcept: "",
  characterMode: "gm" as CharacterMode,
  existingCharacterId: "",
};

type CharacterMode = "gm" | "random" | "existing" | "manual";

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


export default App;
