import { useState } from "react";
import { BookOpenIcon, SettingsIcon, Trash2Icon, UploadIcon } from "lucide-react";
import type { AiSettings, RulebookDocument } from "@/types";
import type { PineconeUsageEvent } from "@/lib/rag";
import { getDisplayFilePath, isSupportedRulebookFile } from "@/lib/rulebook-files";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PineconeUsageAlert } from "@/features/settings/SettingsComponents";
import { defaultRulebookCharacterType, dedupeRulebookFiles, formatBytes, getRulebookCharacterTypeLabel, rulebookCharacterTypeOptions } from "@/features/common/app-ui";

export function RulebookPage({
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
