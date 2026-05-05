# 多 AI 跑团控制台

一个本地 Tauri 桌面网站，用 shadcn/ui + React + TypeScript 构建界面，用 SQLite 保存战役、角色卡、事件和断点。首版规则为 `light-rules-v1`，但规则书通过 `RulesetAdapter` 保留扩展入口。

## 功能

- 单人玩家 + 多 AI 角色：主持人、队友 NPC、规则裁判、世界记录员。
- OpenAI-compatible API 配置：`baseUrl`、`apiKey`、默认模型、角色模型覆盖。
- 角色卡自动生成、JSON 导入、JSON 导出、版本留痕。
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

- `src/lib/rulesets.ts`：轻规则适配器、角色卡 schema、导入导出校验。
- `src/lib/ai.ts`：OpenAI-compatible 调用、多 AI prompt 组装、角色生成。
- `src/lib/storage.ts`：Repository 接口、SQLite 实现、浏览器预览 fallback。
- `src/lib/game.ts`：新建战役、推进回合、断点摘要。
- `src-tauri/src/lib.rs`：SQLite migrations 和 Tauri 插件注册。
