import { useState } from "react";
import { BotIcon, LockIcon, PlusIcon, SaveIcon, SparklesIcon, Trash2Icon, UnlockIcon, UserIcon } from "lucide-react";
import { toast } from "sonner";

import { getCharacterSheetTemplate } from "@/lib/rulesets";
import type { CharacterCreationSession, CharacterLibraryEntry, RulebookDocument } from "@/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { defaultSeed, getCampaignRulebookOptions, getCharacterTypeLabel, getRulebookCategoryLabel } from "@/features/common/app-ui";

export function CharacterLibraryPage({
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
