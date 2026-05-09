import type { ChatCompletionToolCall } from "./types";
import type { AiProviderConfig } from "@/types";
import { resolveModel } from "./settings";

export async function postChatCompletion(
  endpoint: string,
  apiKey: string,
  body: unknown,
): Promise<Response> {
  return fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

export async function postJsonModeChatCompletion<
  T extends { response_format?: { type: "json_object" } },
>(
  endpoint: string,
  apiKey: string,
  body: T,
  errorPrefix: string,
): Promise<Response> {
  const response = await postChatCompletion(endpoint, apiKey, body);
  if (response.ok) {
    return response;
  }

  const errorText = await response.text();
  if (!body.response_format || !shouldRetryWithoutJsonMode(errorText)) {
    throw new Error(`${errorPrefix}：${response.status} ${errorText}`);
  }

  const compatibleBody = { ...body };
  delete compatibleBody.response_format;
  const retry = await postChatCompletion(endpoint, apiKey, compatibleBody);
  if (!retry.ok) {
    throw new Error(`${errorPrefix}：${retry.status} ${await retry.text()}`);
  }
  return retry;
}

export async function readChatCompletionResponse(
  response: Response,
): Promise<{
  content: string;
  reasoningContent: string;
  toolCalls: ChatCompletionToolCall[];
}> {
  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        reasoning_content?: string | null;
        tool_calls?: ChatCompletionToolCall[];
      };
    }>;
  };
  const message = data.choices?.[0]?.message;
  return {
    content: message?.content?.trim() ?? "",
    reasoningContent: message?.reasoning_content?.trim() ?? "",
    toolCalls: message?.tool_calls ?? [],
  };
}

function shouldRetryWithoutJsonMode(errorText: string): boolean {
  const normalized = errorText.toLowerCase();
  return (
    normalized.includes("response_format") ||
    normalized.includes("json_object") ||
    normalized.includes("unexpected")
  );
}

export function shouldReportToolSupportError(errorText: string): boolean {
  const normalized = errorText.toLowerCase();
  return (
    normalized.includes("tool") ||
    normalized.includes("function") ||
    normalized.includes("unsupported") ||
    normalized.includes("unrecognized") ||
    normalized.includes("unknown parameter")
  );
}

export async function* readChatCompletionStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const token = parseStreamLine(line);
      if (token) {
        yield token;
      }
    }
  }

  const tail = decoder.decode();
  if (tail) {
    buffer += tail;
  }
  const token = parseStreamLine(buffer);
  if (token) {
    yield token;
  }
}

function parseStreamLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return "";
  }
  const data = trimmed.slice("data:".length).trim();
  if (!data || data === "[DONE]") {
    return "";
  }

  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{
        delta?: { content?: string };
        message?: { content?: string };
      }>;
    };
    return (
      parsed.choices?.[0]?.delta?.content ??
      parsed.choices?.[0]?.message?.content ??
      ""
    );
  } catch {
    throw new Error(`AI 流式响应不是有效 JSON：${data.slice(0, 120)}`);
  }
}

export async function fetchProviderModels(
  provider: AiProviderConfig,
): Promise<string[]> {
  if (!provider.apiKey.trim()) {
    throw new Error(`Provider「${provider.name}」缺少 API Key。`);
  }

  const response = await fetch(
    `${provider.baseUrl.replace(/\/$/, "")}/models`,
    {
      headers: {
        authorization: `Bearer ${provider.apiKey}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `获取 ${provider.name} 模型失败：${response.status} ${await response.text()}`,
    );
  }

  const data = (await response.json()) as { data?: Array<{ id?: string }> };
  const models = (data.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => Boolean(id))
    .sort((a, b) => a.localeCompare(b));

  if (!models.length) {
    throw new Error(`Provider「${provider.name}」没有返回模型列表。`);
  }

  return models;
}

export interface ProviderConnectionTestResult {
  providerName: string;
  model: string;
  latencyMs: number;
  content: string;
}

export async function testProviderConnection(
  provider: AiProviderConfig,
): Promise<ProviderConnectionTestResult> {
  if (!provider.apiKey.trim()) {
    throw new Error(`Provider「${provider.name}」缺少 API Key。`);
  }

  const model = resolveModel(provider);
  const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const startedAt = Date.now();
  const response = await postChatCompletion(endpoint, provider.apiKey, {
    model,
    messages: [
      {
        role: "system",
        content: "你是 Provider 连通性测试。只回复 OK。",
      },
      {
        role: "user",
        content: "请只回复 OK，用于确认当前 API Key、Base URL 和模型可用。",
      },
    ],
    temperature: 0,
  });

  if (!response.ok) {
    throw new Error(
      `测试 ${provider.name} 失败：${response.status} ${await response.text()}`,
    );
  }

  const result = await readChatCompletionResponse(response);
  if (!result.content) {
    throw new Error(`Provider「${provider.name}」响应为空。`);
  }

  return {
    providerName: provider.name,
    model,
    latencyMs: Date.now() - startedAt,
    content: result.content,
  };
}

export function parseJsonObject(content: string): unknown {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(withoutFence.slice(start, end + 1));
      } catch {
        throw new Error(
          `AI 返回的角色卡不是有效 JSON：${trimmed.slice(0, 120)}`,
        );
      }
    }
    throw new Error(`AI 返回的角色卡不是有效 JSON：${trimmed.slice(0, 120)}`);
  }
}
