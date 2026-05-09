# Pinecone RAG 配置教程

Pinecone 分支用于降低规则书 RAG 的配置成本。它只接管规则书的 embedding、向量检索和可选 rerank；GM、NPC、规则裁判等对话模型仍使用 AI 设置里的 OpenAI-compatible Chat Provider。

## Starter 适用范围

Starter 适合个人和小团队验证：

- 每本规则书只导入一次，多个战役复用同一个规则书知识库。
- 默认关闭 rerank，避免 Starter 的 rerank 请求额度过快耗尽。
- 用量主要来自首次导入的 embedding/write units，以及每轮检索的 read units。

如果要让大量用户共享同一套服务端密钥，应改成后端代理，不要把平台自己的 Pinecone API Key 打包进桌面端。

## 配置步骤

1. 打开 `https://www.pinecone.io/` 注册或登录。
2. 进入控制台的 API Keys 页面，复制用户自己的 API Key。
3. 在本应用打开 `AI 设置`。
4. 在 `规则书 RAG` 中选择 `Pinecone Easy RAG`。
5. 填写 `Pinecone API Key`。
6. 保持默认 `Index 名称`、`Namespace`、`Cloud`、`Region` 和 `Embedding 模型`，除非你明确知道要调整。
7. 保存设置后，在规则书界面填写规则书库名称，并选择一个或多个 PDF/TXT/Markdown 文件，也可以直接选择包含多个 PDF 的文件夹。

首次导入时应用会尝试自动创建 integrated embedding index。创建完成前 Pinecone 可能短暂返回未就绪错误，稍后重试导入即可。

扫描版 PDF 通常没有可抽取文本，需要先用 OCR 工具生成可复制文本的 PDF 后再导入。

## 默认值

- Index 名称：`multi-ai-trpg-rag`
- Namespace：`multi-ai-trpg`
- Cloud：`aws`
- Region：`us-east-1`
- Embedding 模型：`llama-text-embed-v2`
- Rerank：默认关闭
- Rerank 模型：`bge-reranker-v2-m3`

## 用量查看

Pinecone 的检索响应会返回单次请求 usage，但 Starter 的月度总用量更适合在控制台查看：

`https://app.pinecone.io/organizations/-/projects/-/usage`

如果看到 `429`，通常表示 Starter 的某项月度或速率限制已达到，需要等额度刷新、减少 rerank 使用，或升级 Pinecone 计划。
