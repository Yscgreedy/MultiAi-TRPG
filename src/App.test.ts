import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyPreferences,
  createProviderAvailableStatus,
  createProviderCheckingStatus,
  createProviderUnavailableStatus,
  loadPreferences,
} from "@/lib/ui-state";

describe("app preferences", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads default preferences when storage is empty", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
    });

    expect(loadPreferences()).toMatchObject({
      themeMode: "system",
      accentColor: "teal",
      compactMode: false,
      displayName: "玩家",
    });
  });

  it("merges stored preferences with defaults", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({
          themeMode: "dark",
          compactMode: true,
          displayName: "守秘人",
        }),
    });

    expect(loadPreferences()).toMatchObject({
      themeMode: "dark",
      accentColor: "teal",
      compactMode: true,
      displayName: "守秘人",
      avatarText: "旅",
    });
  });

  it("applies compact mode, theme, and accent to the document root", () => {
    const classes = new Set<string>();
    const dataset: Record<string, string> = {};

    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal("document", {
      documentElement: {
        dataset,
        classList: {
          toggle: (name: string, force?: boolean) => {
            if (force) {
              classes.add(name);
            } else {
              classes.delete(name);
            }
          },
        },
      },
    });

    applyPreferences({
      themeMode: "dark",
      accentColor: "rose",
      compactMode: true,
      displayName: "玩家",
      avatarText: "旅",
      avatarUrl: "",
    });

    expect(classes.has("dark")).toBe(true);
    expect(classes.has("compact")).toBe(true);
    expect(dataset.accent).toBe("rose");
  });
});

describe("provider status helpers", () => {
  it("creates checking, available, and unavailable status values", () => {
    expect(createProviderCheckingStatus()).toMatchObject({
      state: "checking",
      message: "正在检查",
    });
    expect(createProviderAvailableStatus("gpt-test", 42, "ok")).toMatchObject({
      state: "available",
      model: "gpt-test",
      latencyMs: 42,
      message: "ok",
    });
    expect(createProviderUnavailableStatus("bad key")).toMatchObject({
      state: "unavailable",
      message: "bad key",
    });
  });
});
