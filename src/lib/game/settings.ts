import { defaultAiSettings, normalizeAiSettings } from "@/lib/ai";
import type { AiSettings } from "@/types";

export function mergeSettings(
  current: AiSettings | undefined,
  patch: Partial<AiSettings>,
): AiSettings {
  const normalized = normalizeAiSettings(current ?? defaultAiSettings);
  return normalizeAiSettings({
    ...normalized,
    ...patch,
    providers: patch.providers ?? normalized.providers,
    agents: patch.agents ?? normalized.agents,
  });
}

