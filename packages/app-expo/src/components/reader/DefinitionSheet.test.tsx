import type { DictionaryEntry, DictionaryPackDescriptor } from "@readany/core/dictionary";
import i18n, { i18nReady } from "@readany/core/i18n";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DefinitionSheet } from "./DefinitionSheet";
import { DefinitionController, type DefinitionState } from "./definition-controller";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
(globalThis as typeof globalThis & { React: typeof React }).React = React;

vi.mock("react-native", async () => {
  const ReactModule = await import("react");
  const host = (name: string) =>
    function HostComponent(props: Record<string, unknown>) {
      return ReactModule.createElement(name, props, props.children as React.ReactNode);
    };
  return {
    ActivityIndicator: host("ActivityIndicator"),
    Modal: host("Modal"),
    Pressable: host("Pressable"),
    ScrollView: host("ScrollView"),
    StyleSheet: { create: (styles: unknown) => styles },
    Text: host("Text"),
    TouchableOpacity: host("TouchableOpacity"),
    View: host("View"),
  };
});

vi.mock("@/components/ui/Icon", () => ({
  XIcon: () => null,
}));

vi.mock("@/stores", () => ({
  useDictionaryStore: Object.assign(() => undefined, {
    getState: () => ({
      install: async () => {},
      manifest: null,
    }),
  }),
}));

vi.mock("@/styles/theme", () => ({
  fontSize: { base: 16, lg: 18, sm: 14, xs: 12 },
  fontWeight: { medium: "500", semibold: "600" },
  radius: { full: 999, lg: 8, xl: 12 },
  useColors: () => ({
    background: "background",
    border: "border",
    card: "card",
    destructive: "destructive",
    foreground: "foreground",
    muted: "muted",
    mutedForeground: "mutedForeground",
    primary: "primary",
    primaryForeground: "primaryForeground",
  }),
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 24 }),
}));

const descriptor: DictionaryPackDescriptor = {
  language: "en",
  version: "1.0.0",
  schemaVersion: 1,
  sourceEdition: "enwiktionary",
  sourceDumpDate: "2026-09-01",
  sizeBytes: 1_572_864,
  sha256: "a".repeat(64),
  url: "https://example.test/readany-dictionary-en.sqlite",
  sourceArchiveUrl: "https://example.test/en-source.xml.bz2",
  attributionUrl: "https://en.wiktionary.org",
  license: "CC BY-SA 4.0",
};

const englishEntry: DictionaryEntry = {
  id: 1,
  language: "en",
  headword: "desire",
  pronunciation: "/dɪˈzaɪəɹ/",
  partOfSpeech: "noun",
  senses: [
    { order: 0, definition: "A strong wish." },
    { order: 1, definition: "To want strongly." },
  ],
};

const chineseEntry: DictionaryEntry = {
  id: 2,
  language: "zh",
  headword: "閱讀",
  simplified: "阅读",
  traditional: "閱讀",
  pronunciation: "yuèdú",
  partOfSpeech: "动词",
  senses: [{ order: 0, definition: "看书或文章。" }],
};

function createController(state: DefinitionState, lookup = vi.fn(async () => [])) {
  const controller = new DefinitionController({
    lookup,
    install: vi.fn(async () => {}),
    getDescriptor: () => descriptor,
  });
  controller.state = state;
  vi.spyOn(controller, "open").mockResolvedValue();
  return { controller, lookup };
}

function isHostType(node: TestRenderer.ReactTestInstance, type: string): boolean {
  return node.type === type;
}

function textContent(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root
    .findAll((node) => isHostType(node, "Text"))
    .flatMap((node) => node.children)
    .join("");
}

function pressButton(renderer: TestRenderer.ReactTestRenderer, label: string): void {
  const button = renderer.root
    .findAll((node) => isHostType(node, "TouchableOpacity"))
    .find((node) => node.findAll((child) => child.children.includes(label)).length > 0);
  if (!button) throw new Error(`Button ${label} was not found`);
  button.props.onPress();
}

describe("DefinitionSheet", () => {
  beforeEach(async () => {
    await i18nReady;
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("consumes Traditional Chinese sheet, download-template, and accessibility translations", async () => {
    await act(async () => {
      await i18n.changeLanguage("zh-TW");
    });
    const chineseDescriptor: DictionaryPackDescriptor = {
      ...descriptor,
      language: "zh",
      sourceEdition: "zhwiktionary",
    };
    const { controller } = createController({
      kind: "missing-pack",
      language: "zh",
      descriptor: chineseDescriptor,
    });
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <DefinitionSheet
          visible
          text="閱讀"
          controller={controller}
          onClose={vi.fn()}
          onManageDictionaries={vi.fn()}
        />,
      );
    });

    expect(textContent(renderer)).toContain("釋義");
    expect(textContent(renderer)).toContain("下載中文字典（1.5 MB）即可離線查詢釋義。");
    expect(renderer.root.findAllByProps({ accessibilityLabel: "關閉釋義" }).length).toBeGreaterThan(
      0,
    );
    expect(renderer.root.findByProps({ accessibilityLabel: "下載中文字典" })).toBeTruthy();
  });

  it("renders English headword, IPA, part of speech, and numbered senses", async () => {
    const { controller } = createController({
      kind: "result",
      displayText: "desire",
      entries: [englishEntry],
    });
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <DefinitionSheet
          visible
          text="desire"
          controller={controller}
          onClose={vi.fn()}
          onManageDictionaries={vi.fn()}
        />,
      );
    });

    expect(textContent(renderer)).toContain("desire");
    expect(textContent(renderer)).toContain("/dɪˈzaɪəɹ/");
    expect(textContent(renderer)).toContain("noun");
    expect(textContent(renderer)).toContain("1. A strong wish.");
    expect(textContent(renderer)).toContain("2. To want strongly.");
  });

  it("renders Chinese simplified and traditional forms, pinyin, and Chinese senses", async () => {
    const { controller } = createController({
      kind: "result",
      displayText: "閱讀",
      entries: [chineseEntry],
    });
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <DefinitionSheet
          visible
          text="閱讀"
          controller={controller}
          onClose={vi.fn()}
          onManageDictionaries={vi.fn()}
        />,
      );
    });

    expect(textContent(renderer)).toContain("阅读");
    expect(textContent(renderer)).toContain("閱讀");
    expect(textContent(renderer)).toContain("yuèdú");
    expect(textContent(renderer)).toContain("动词");
    expect(textContent(renderer)).toContain("1. 看书或文章。");
  });

  it("renders the missing pack size and a Download action", async () => {
    const { controller } = createController({ kind: "missing-pack", language: "en", descriptor });
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <DefinitionSheet
          visible
          text="desire"
          controller={controller}
          onClose={vi.fn()}
          onManageDictionaries={vi.fn()}
        />,
      );
    });

    expect(textContent(renderer)).toContain("1.5 MB");
    expect(textContent(renderer)).toContain("Download");
  });

  it("disables Download and renders progress while the pack is downloading", async () => {
    const { controller } = createController({
      kind: "downloading",
      language: "en",
      progress: 0.37,
    });
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <DefinitionSheet
          visible
          text="desire"
          controller={controller}
          onClose={vi.fn()}
          onManageDictionaries={vi.fn()}
        />,
      );
    });

    const download = renderer.root
      .findAll((node) => isHostType(node, "TouchableOpacity"))
      .find((node) => node.findAll((child) => child.children.includes("Download")).length > 0);
    expect(download?.props.disabled).toBe(true);
    expect(textContent(renderer)).toContain("37%");
  });

  it("renders the exact no-match guidance", async () => {
    const { controller } = createController({ kind: "no-match", displayText: "unknown" });
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <DefinitionSheet
          visible
          text="unknown"
          controller={controller}
          onClose={vi.fn()}
          onManageDictionaries={vi.fn()}
        />,
      );
    });

    expect(textContent(renderer)).toContain("No definition found. Try selecting a single word.");
  });

  it("renders Retry and Manage Dictionaries for a recoverable error", async () => {
    const calls: string[] = [];
    const onClose = vi.fn(() => calls.push("close"));
    const onManageDictionaries = vi.fn(() => calls.push("manage"));
    const { controller } = createController({ kind: "error", message: "database unavailable" });
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <DefinitionSheet
          visible
          text="desire"
          controller={controller}
          onClose={onClose}
          onManageDictionaries={onManageDictionaries}
        />,
      );
    });
    await act(async () => {
      pressButton(renderer, "Retry");
      await Promise.resolve();
      pressButton(renderer, "Manage Dictionaries");
    });

    expect(textContent(renderer)).toContain("Dictionary lookup failed. Try again.");
    expect(calls).toEqual(["close", "manage"]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onManageDictionaries).toHaveBeenCalledTimes(1);
  });

  it("closes the modal without launching another lookup", async () => {
    const onClose = vi.fn();
    const { controller, lookup } = createController({ kind: "no-match", displayText: "desire" });
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <DefinitionSheet
          visible
          text="desire"
          controller={controller}
          onClose={onClose}
          onManageDictionaries={vi.fn()}
        />,
      );
    });
    const lookupCountBeforeClose = lookup.mock.calls.length;
    await act(async () => {
      renderer.root.findAll((node) => isHostType(node, "Modal"))[0]?.props.onRequestClose();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledTimes(lookupCountBeforeClose);
  });
});
