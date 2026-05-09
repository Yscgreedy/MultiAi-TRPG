# AGENTS.md — Multi AI TRPG

一个本地 Tauri 桌面跑团应用，通过多个专用 AI 代理（主持人、规则裁判、世界记录员、NPC）协作进行单人跑团叙事。

## 常用命令

```bash
pnpm install          # 安装依赖
pnpm dev              # 纯前端预览 (Vite, 端口 1420, localStorage 存储)
pnpm tauri dev        # 完整桌面应用 (需 Rust + Tauri, SQLite 存储)
pnpm typecheck        # TypeScript 类型检查
pnpm lint             # ESLint 检查
pnpm test             # Vitest 测试 (所有 *.test.ts)
pnpm build            # 生产构建
```

> **重要**: `pnpm dev` 无需 Rust/Tauri，用 `localStorage` 作 fallback 存储。`pnpm tauri dev` 才走 SQLite 持久化。详见 [README.md](./README.md)。

## 技术栈

- **前端**: React 19 + TypeScript + Vite 7 + shadcn/ui + Tailwind CSS 4
- **桌面**: Tauri 2 (Rust)
- **存储**: SQLite (`@tauri-apps/plugin-sql`) + 浏览器 localStorage fallback
- **AI**: OpenAI-compatible API + Pinecone RAG
- **校验**: Zod 4

## 架构

```
玩家输入 → App.tsx → game.ts → ai.ts (多代理编排)
                            → rag.ts (规则书检索)
                            → storage.ts (持久化)
                            → 流式回调 → App.tsx UI 更新
```

## 核心模块

| 文件 | 职责 |
|------|------|
| `src/lib/game.ts` | 战役创建、回合推进 (`playTurn` / `playTurnStreaming`)、快照摘要 |
| `src/lib/ai.ts` | AI 代理编排、prompt 组装、流式/同步调用、embedding 生成 |
| `src/lib/rag.ts` | 规则书分块、向量检索、rerank、RAG 上下文构建 |
| `src/lib/storage.ts` | `GameRepository` 接口 + Tauri/SQLite 和浏览器 localStorage 双实现 |
| `src/lib/rulesets.ts` | 规则系统适配器 (`RulesetAdapter`)、角色卡模板和校验 |
| `src/lib/rulebook-files.ts` | PDF/TXT/Markdown 文件解析 |
| `src/lib/pinecone.ts` | Pinecone 云端 RAG 集成 |
| `src/prompts/*.md` | AI 代理的系统提示语，由 `ai.ts` 通过 `?raw` 导入 |
| `src/types.ts` | 所有 TypeScript 类型定义 |
| `src-tauri/src/lib.rs` | SQLite migrations、Tauri 插件注册 |

## 关键模式

- **Repository 模式**: `GameRepository` 接口定义所有数据操作，`TauriRepository` (SQLite) 和 `BrowserRepository` (localStorage) 两个实现。通过 `createRepository()` 自动选择。
- **流式与非流式双路径**: `playTurn()` 同步等待完整回合；`playTurnStreaming()` 通过 `onMessageAppend` / `onMessageDelta` 回调支持 UI 实时 token 流。
- **多代理编排**: GM → RulesJudge（私密，结果对玩家隐藏）→ Archivist，顺序调用。Companion 为旧版兼容，NPC 由 GM 通过 @NPC 触发。
- **规则系统可扩展**: `RulesetAdapter` 接口抽象规则差异，当前仅内置 `light-rules-v1`，可扩展新规则。
- **AI 设置分层合并**: `mergeSettings(base, overrides)` 支持部分覆盖 provider/agent/rag 配置。
- **ID 生成**: 使用 `createId()` (`src/lib/id.ts`) 生成唯一 ID，`nowIso()` 生成 ISO 时间戳。

## 注意事项

- **不要直接修改 `src/components/ui/`**: 这些是 shadcn/ui 生成的组件，通过 `npx shadcn-ui@latest add` 添加/更新。
- **Prompt 文件用 `?raw` 导入**: `src/prompts/*.md` 以原始字符串导入，修改 prompt 后需检查 `ai.ts` 中的 `content` 拼接逻辑。
- **Rust 端改动**: `src-tauri/src/lib.rs` 中的 SQLite migrations 是追加式的，不要修改已有 migration。
- **localStorage 与 SQLite 差异**: `BrowserRepository` 功能子集可能缺少某些搜索/批量操作，测试时注意。
- **Pinecone 配置**: 详见 [docs/pinecone-rag.md](./docs/pinecone-rag.md)。

## 测试

- 测试文件与源文件同目录: `src/lib/*.test.ts`
- 运行: `pnpm test` (Vitest)
- 测试覆盖 `ai.test.ts`, `game.test.ts`, `storage.test.ts`, `rag.test.ts`, `rulesets.test.ts`
