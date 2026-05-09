export type ThemeMode = "system" | "light" | "dark";
export type AccentColor = "teal" | "indigo" | "rose" | "amber";

export interface AppPreferences {
  themeMode: ThemeMode;
  accentColor: AccentColor;
  compactMode: boolean;
  displayName: string;
  avatarText: string;
  avatarUrl: string;
}

export type ProviderStatusState = "unknown" | "checking" | "available" | "unavailable";

export interface ProviderStatus {
  state: ProviderStatusState;
  model?: string;
  latencyMs?: number;
  checkedAt?: string;
  message?: string;
}

export const preferencesKey = "multi-ai-trpg-preferences";

export const defaultPreferences: AppPreferences = {
  themeMode: "system",
  accentColor: "teal",
  compactMode: false,
  displayName: "玩家",
  avatarText: "旅",
  avatarUrl: "",
};

export function loadPreferences(): AppPreferences {
  const raw = localStorage.getItem(preferencesKey);
  if (!raw) {
    return defaultPreferences;
  }

  try {
    return {
      ...defaultPreferences,
      ...(JSON.parse(raw) as Partial<AppPreferences>),
    };
  } catch {
    return defaultPreferences;
  }
}

export function applyPreferences(preferences: AppPreferences): void {
  const root = document.documentElement;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const useDark =
    preferences.themeMode === "dark" ||
    (preferences.themeMode === "system" && prefersDark);

  root.classList.toggle("dark", useDark);
  root.classList.toggle("compact", preferences.compactMode);
  root.dataset.accent = preferences.accentColor;
}

export function createProviderCheckingStatus(): ProviderStatus {
  return {
    state: "checking",
    checkedAt: new Date().toISOString(),
    message: "正在检查",
  };
}

export function createProviderAvailableStatus(
  model: string,
  latencyMs: number,
  message?: string,
): ProviderStatus {
  return {
    state: "available",
    model,
    latencyMs,
    checkedAt: new Date().toISOString(),
    message,
  };
}

export function createProviderUnavailableStatus(message: string): ProviderStatus {
  return {
    state: "unavailable",
    checkedAt: new Date().toISOString(),
    message,
  };
}
