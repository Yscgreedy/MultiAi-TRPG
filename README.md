# 多 AI 跑团控制台

一个本地 Tauri 桌面网站，用 shadcn/ui + React + TypeScript 构建界面，用 SQLite 保存战役、角色卡、事件和断点。首版规则为 `light-rules-v1`，但规则书通过 `RulesetAdapter` 保留扩展入口。

## 功能

- 单人玩家 + 多 AI 角色：主持人、队友 NPC、规则裁判、世界记录员。
- OpenAI-compatible API 配置：`baseUrl`、`apiKey`、默认模型、角色模型覆盖。
- 角色卡生成、JSON 导入、JSON 导出、版本留痕。
- 规则书导入与 RAG：按规则书库名称批量导入 PDF/TXT/Markdown 文件或文件夹，切片后写入本地向量库；rerank 模型为空时跳过 rerank。
- Pinecone Easy RAG：可在 AI 设置中切换到 Pinecone 托管 embedding、向量检索和可选 rerank；配置教程见 `docs/pinecone-rag.md`。
- 战役断点续玩：每轮行动、AI 回复、事件和摘要都持久化。
- Tauri 运行时使用 `@tauri-apps/plugin-sql` 连接 `sqlite:multi-ai-trpg.db`。

## 开发

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm tauri dev
```

`pnpm dev` 可用于前端预览，会使用浏览器本地 fallback。真实桌面存储路径由 Tauri SQL 插件管理，需要本机安装 Rust 和 Tauri 桌面依赖后运行 `pnpm tauri dev`。

## 主要结构

- `src/App.tsx`：应用根组件，负责顶层状态、路由式页面切换和业务 handler 串联。
- `src/features/*`：页面和 UI 组件分区；`game/` 为游戏控制台，`characters/` 为角色库和制卡页，`rulebooks/` 为规则书导入，`settings/` 为应用与 AI 设置，`common/` 为共享 UI/helper。
- `src/lib/game.ts` + `src/lib/game/*`：战役创建、同步/流式回合推进、AI 副作用、工具运行时、快照和设置合并；`game.ts` 保留公共入口。
- `src/lib/ai.ts` + `src/lib/ai/*`：OpenAI-compatible 设置、provider 连接、chat/stream 解析、prompt 组装、tools、制卡流程和 turn 编排；`ai.ts` 保留公共入口。
- `src/lib/storage.ts` + `src/lib/storage/*`：`GameRepository` 公共入口、Browser/localStorage fallback、Tauri SQLite 实现、row mapper 和共享存储 helper。
- `src/lib/rulesets.ts`：轻规则适配器、角色卡 schema、导入导出校验。
- `src/lib/rag.ts`：规则书切片、embedding 入库、相似度检索和可选 rerank。
- `src-tauri/src/lib.rs`：SQLite migrations 和 Tauri 插件注册。
