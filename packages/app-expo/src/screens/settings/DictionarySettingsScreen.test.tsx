import type { DictionaryStoreState } from "@/stores/dictionary-store";
import type { DictionaryManifest } from "@readany/core/dictionary";
import i18n, { i18nReady } from "@readany/core/i18n";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { DictionarySettingsScreen } from "./DictionarySettingsScreen";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
(globalThis as typeof globalThis & { React: typeof React }).React = React;

const { alert, openURL } = vi.hoisted(() => ({
  alert: vi.fn(),
  openURL: vi.fn(async () => true),
}));

vi.mock("react-native", async () => {
  const ReactModule = await import("react");
  const host = (name: string) =>
    function HostComponent(props: Record<string, unknown>) {
      return ReactModule.createElement(name, props, props.children as React.ReactNode);
    };
  return {
    ActivityIndicator: host("ActivityIndicator"),
    Alert: { alert },
    Linking: { openURL },
    ScrollView: host("ScrollView"),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: host("Text"),
    TouchableOpacity: host("TouchableOpacity"),
    View: host("View"),
  };
});

vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/stores", () => ({
  useDictionaryStore: () => {
    throw new Error("DictionarySettingsScreen tests inject their dictionary store");
  },
}));
vi.mock("@/components/ui/Icon", () => ({ ChevronLeftIcon: () => null }));
vi.mock("@/components/ui/KeyboardAwareScrollView", () => ({
  KeyboardAwareScrollView: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/hooks/use-responsive-layout", () => ({
  useResponsiveLayout: () => ({ centeredContentWidth: 720 }),
}));
vi.mock("@/styles/theme", () => ({
  fontSize: { base: 16, lg: 18, sm: 14, xs: 12 },
  fontWeight: { medium: "500", semibold: "600" },
  radius: { lg: 8, xl: 12 },
  spacing: { lg: 16, xl: 20, xxl: 24 },
  useColors: () => ({
    background: "background",
    border: "border",
    card: "card",
    destructive: "destructive",
    foreground: "foreground",
    mutedForeground: "mutedForeground",
    primary: "primary",
    primaryForeground: "primaryForeground",
  }),
}));
vi.mock("./SettingsHeader", () => ({
  SettingsHeader: ({ title, subtitle }: { title: string; subtitle: string }) =>
    React.createElement("Text", {}, title, subtitle),
}));

const descriptors: DictionaryManifest["packs"] = {
  en: {
    language: "en",
    version: "2026.09",
    schemaVersion: 1,
    sourceEdition: "enwiktionary",
    sourceDumpDate: "2026-09-01",
    sizeBytes: 1_572_864,
    sha256: "a".repeat(64),
    url: "https://example.test/en.sqlite",
    sourceArchiveUrl: "https://dumps.example.test/en.xml.bz2",
    attributionUrl: "https://en.wiktionary.org",
    license: "CC BY-SA 4.0",
  },
  zh: {
    language: "zh",
    version: "2026.09",
    schemaVersion: 1,
    sourceEdition: "zhwiktionary",
    sourceDumpDate: "2026-09-01",
    sizeBytes: 2_621_440,
    sha256: "b".repeat(64),
    url: "https://example.test/zh.sqlite",
    sourceArchiveUrl: "https://dumps.example.test/zh.xml.bz2",
    attributionUrl: "https://zh.wiktionary.org",
    license: "CC BY-SA 4.0",
  },
};

function makeStore(
  overrides: Partial<DictionaryStoreState["packs"]> = {},
  actionOverrides: Partial<
    Pick<DictionaryStoreState, "initialize" | "refreshManifest" | "install" | "remove" | "retry">
  > = {},
) {
  const initialize = actionOverrides.initialize ?? vi.fn(async () => {});
  const refreshManifest = actionOverrides.refreshManifest ?? vi.fn(async () => {});
  const install = actionOverrides.install ?? vi.fn(async () => {});
  const remove = actionOverrides.remove ?? vi.fn(async () => {});
  const retry = actionOverrides.retry ?? vi.fn(async () => {});
  const lookup = vi.fn(async () => []);
  return {
    actions: { initialize, install, refreshManifest, remove, retry },
    store: create<DictionaryStoreState>(() => ({
      manifest: { manifestVersion: 1, packs: descriptors },
      packs: {
        en: { state: "not-installed" },
        zh: { state: "not-installed" },
        ...overrides,
      },
      initialize,
      refreshManifest,
      install,
      remove,
      retry,
      lookup,
    })),
  };
}

function textContent(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root
    .findAll((node) => String(node.type) === "Text")
    .flatMap((node) => node.children)
    .join("");
}

function press(renderer: TestRenderer.ReactTestRenderer, label: string): void {
  const button = renderer.root.findByProps({ accessibilityLabel: label });
  button.props.onPress();
}

describe("DictionarySettingsScreen", () => {
  beforeEach(async () => {
    await i18nReady;
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });
  it.each([
    ["en", "Dictionaries", "English", "Download English dictionary"],
    ["zh-TW", "字典", "英語", "英語字典下載"],
    ["fr", "Dictionaries", "English", "Download English dictionary"],
  ])(
    "renders real resources with English fallback in %s",
    async (language, title, name, action) => {
      await act(async () => {
        await i18n.changeLanguage(language);
      });
      const { store } = makeStore();
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(<DictionarySettingsScreen dictionaryStore={store} />);
      });
      expect(textContent(renderer)).toContain(title);
      expect(textContent(renderer)).toContain(name);
      expect(renderer.root.findByProps({ accessibilityLabel: action })).toBeTruthy();
      expect(JSON.stringify(renderer.toJSON())).not.toMatch(/(?:reader\.)?dictionary\./);
      await act(async () => renderer.unmount());
    },
  );

  it("renders both language rows after exactly one initial remote-first refresh", async () => {
    const calls: string[] = [];
    let resolveInitialization!: () => void;
    const initialize = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          calls.push("initialize");
          resolveInitialization = resolve;
        }),
    );
    const refreshManifest = vi.fn(async () => {
      calls.push("refreshManifest");
    });
    const { store: orderedStore, actions: orderedActions } = makeStore(
      {},
      { initialize, refreshManifest },
    );
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<DictionarySettingsScreen dictionaryStore={orderedStore} />);
    });

    expect(calls).toEqual(["initialize"]);
    await act(async () => {
      resolveInitialization();
      await Promise.resolve();
    });

    expect(textContent(renderer)).toContain("English");
    expect(textContent(renderer)).toContain("Chinese");
    expect(textContent(renderer)).toContain("Not downloaded");
    expect(textContent(renderer)).toContain("1.5 MB");
    expect(textContent(renderer)).toContain("2.5 MB");
    expect(orderedActions.initialize).toHaveBeenCalledTimes(1);
    expect(orderedActions.refreshManifest).not.toHaveBeenCalled();
    expect(calls).toEqual(["initialize"]);
  });

  it("shows unavailable without a download action when the manifest is absent", async () => {
    const { store, actions } = makeStore();
    store.setState({ manifest: null });
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<DictionarySettingsScreen dictionaryStore={store} />);
    });

    expect(textContent(renderer)).toContain("Unavailable");
    expect(
      renderer.root.findAll(
        (node) => node.props.accessibilityLabel === "Download English dictionary",
      ),
    ).toHaveLength(0);
    expect(actions.install).not.toHaveBeenCalled();
  });

  it("keeps download and update actions scoped to the selected language", async () => {
    const { store, actions } = makeStore({
      zh: {
        state: "update-available",
        installedVersion: "2026.08",
        availableVersion: "2026.09",
        sizeBytes: 2_621_440,
      },
    });
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<DictionarySettingsScreen dictionaryStore={store} />);
    });
    await act(async () => {
      press(renderer, "Download English dictionary");
      press(renderer, "Update Chinese dictionary");
    });

    expect(actions.install).toHaveBeenNthCalledWith(1, "en");
    expect(actions.install).toHaveBeenNthCalledWith(2, "zh");
    expect(textContent(renderer)).toContain("Update available");
    expect(textContent(renderer)).toContain("2026.08");
    expect(textContent(renderer)).toContain("2026.09");
  });

  it("renders progress, installed metadata, retry, and a removal confirmation for their own rows", async () => {
    const { store, actions } = makeStore({
      en: { state: "downloading", progress: 0.37 },
      zh: { state: "installed", version: "2026.09", sizeBytes: 2_621_440 },
    });
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<DictionarySettingsScreen dictionaryStore={store} />);
    });
    expect(textContent(renderer)).toContain("37%");
    expect(textContent(renderer)).toContain("Installed");
    expect(textContent(renderer)).toContain("2026.09");

    await act(async () => press(renderer, "Remove Chinese dictionary"));
    const confirm = alert.mock.calls
      .at(-1)?.[2]
      ?.find((button: { style?: string }) => button.style === "destructive");
    await act(async () => confirm?.onPress());
    expect(actions.remove).toHaveBeenCalledWith("zh");
  });

  it("shows a localized per-pack error, logs its detail, retries only that language, and opens attribution", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store, actions } = makeStore({
      en: { state: "error", message: "network unavailable", hasActivePack: false },
    });
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<DictionarySettingsScreen dictionaryStore={store} />);
    });
    expect(textContent(renderer)).toContain("English dictionary couldn't be prepared. Try again.");
    expect(textContent(renderer)).not.toContain("network unavailable");
    expect(warn).toHaveBeenCalledWith("[DictionarySettings] dictionary pack error", {
      error: "network unavailable",
      language: "en",
    });
    await act(async () => {
      press(renderer, "Retry English dictionary");
      press(renderer, "English dictionary attribution");
    });

    expect(actions.install).toHaveBeenCalledWith("en");
    expect(actions.retry).not.toHaveBeenCalled();
    expect(openURL).toHaveBeenCalledWith(descriptors.en.attributionUrl);
    warn.mockRestore();
  });

  it("offers both repair and removal when the active pack is corrupt", async () => {
    const { store, actions } = makeStore({
      en: { state: "error", message: "invalid schema", hasActivePack: true } as never,
    });
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<DictionarySettingsScreen dictionaryStore={store} />);
    });
    await act(async () => {
      press(renderer, "Repair English dictionary");
      press(renderer, "Remove English dictionary");
    });

    expect(actions.install).toHaveBeenCalledWith("en");
    expect(alert).toHaveBeenCalled();
  });
});
