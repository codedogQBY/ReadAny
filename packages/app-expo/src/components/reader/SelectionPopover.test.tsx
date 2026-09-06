import i18n, { i18nReady } from "@readany/core/i18n";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SelectionPopover } from "./SelectionPopover";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
(globalThis as typeof globalThis & { React: typeof React }).React = React;

vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));

vi.mock("@/components/ui/Icon", () => ({
  BookOpenIcon: () => null,
  CopyIcon: () => null,
  HighlighterIcon: () => null,
  LanguagesIcon: () => null,
  NotebookPenIcon: () => null,
  SparklesIcon: () => null,
  Trash2Icon: () => null,
  Volume2Icon: () => null,
  XIcon: () => null,
}));

vi.mock("@/components/ui/RichTextEditor", () => ({ RichTextEditor: () => null }));

vi.mock("@/styles/theme", () => ({
  fontSize: { base: 16, lg: 18, sm: 14 },
  fontWeight: { medium: "500", semibold: "600" },
  radius: { lg: 8, xl: 12, xxl: 16 },
  spacing: { sm: 8, md: 12, lg: 16 },
  useColors: () => ({
    border: "border",
    card: "card",
    destructive: "destructive",
    foreground: "foreground",
    muted: "muted",
    mutedForeground: "mutedForeground",
    primary: "primary",
    primaryForeground: "primaryForeground",
  }),
  withOpacity: () => "transparent",
}));

vi.mock("@readany/core/types", () => ({
  HIGHLIGHT_COLORS: ["yellow"],
  HIGHLIGHT_COLOR_HEX: { yellow: "#ffff00" },
}));

vi.mock("react-native", async () => {
  const ReactModule = await import("react");
  const host = (name: string) =>
    function HostComponent(props: Record<string, unknown>) {
      return ReactModule.createElement(name, props, props.children as React.ReactNode);
    };
  return {
    KeyboardAvoidingView: host("KeyboardAvoidingView"),
    Modal: host("Modal"),
    Platform: { OS: "android" },
    StyleSheet: { absoluteFill: {}, absoluteFillObject: {}, create: (styles: unknown) => styles },
    Text: host("Text"),
    TouchableOpacity: host("TouchableOpacity"),
    View: host("View"),
    useWindowDimensions: () => ({ height: 800, width: 400 }),
  };
});

const selection = {
  cfi: "epubcfi(/6/2)",
  text: "selected dictionary word",
  position: { x: 200, y: 100, selectionTop: 90, selectionBottom: 110 },
};

describe("SelectionPopover", () => {
  beforeEach(async () => {
    await i18nReady;
    await act(async () => {
      await i18n.changeLanguage("zh-TW");
    });
  });
  it("passes the selected text to Define and dismisses the selection", async () => {
    const onDefine = vi.fn();
    const onDismiss = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <SelectionPopover
          selection={selection}
          onHighlight={vi.fn()}
          onDismiss={onDismiss}
          onCopy={vi.fn()}
          onAIChat={vi.fn()}
          onDefine={onDefine}
        />,
      );
    });

    const define = renderer.root.findByProps({ accessibilityLabel: "查詞" });
    act(() => define.props.onPress());

    expect(onDefine).toHaveBeenCalledWith(selection.text);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not render Define when no definition handler is supplied", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <SelectionPopover
          selection={selection}
          onHighlight={vi.fn()}
          onDismiss={vi.fn()}
          onCopy={vi.fn()}
          onAIChat={vi.fn()}
        />,
      );
    });

    expect(renderer.root.findAllByProps({ accessibilityLabel: "查詞" })).toHaveLength(0);
  });
});
