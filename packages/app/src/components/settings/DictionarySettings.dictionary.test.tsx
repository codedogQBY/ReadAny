import { useDictionaryStore } from "@/stores/dictionary-store";
import { DICTIONARY_BUNDLED_MANIFEST } from "@readany/core/dictionary/dictionary-config";
import i18n, { i18nReady } from "@readany/core/i18n";
import type React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { DictionarySettings } from "./DictionarySettings";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));
const install = vi.fn();
const remove = vi.fn();
let view: TestRenderer.ReactTestRenderer;
beforeAll(async () => {
  await i18nReady;
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  vi.resetAllMocks();
  useDictionaryStore.setState({
    manifest: DICTIONARY_BUNDLED_MANIFEST,
    packs: { en: { state: "not-installed" }, zh: { state: "not-installed" } },
    initialize: async () => {},
    install,
    remove,
  });
});
afterEach(async () => {
  await act(async () => view?.unmount());
});
it("downloads the selected language and displays source attribution", async () => {
  await act(async () => {
    view = TestRenderer.create(<DictionarySettings />);
  });
  expect(JSON.stringify(view.toJSON())).toContain("WordNet 3.1 License");
  await act(async () =>
    view.root
      .findAllByType("button")
      .find((button) => button.props["aria-label"] === "Download English dictionary")
      ?.props.onClick(),
  );
  expect(install).toHaveBeenCalledWith("en");
});
it("requires confirmation before removing a dictionary", async () => {
  useDictionaryStore.setState({
    packs: {
      en: { state: "installed", version: "1.0.0", sizeBytes: 42 },
      zh: { state: "not-installed" },
    },
  });
  await act(async () => {
    view = TestRenderer.create(<DictionarySettings />);
  });
  await act(async () =>
    view.root
      .findAllByType("button")
      .find((button) => button.props["aria-label"] === "Remove English dictionary")
      ?.props.onClick(),
  );
  expect(remove).not.toHaveBeenCalled();
  expect(JSON.stringify(view.toJSON())).toContain("Remove English dictionary?");
  await act(async () =>
    view.root
      .findAllByType("button")
      .find((button) => !button.props["aria-label"] && button.children.includes("Remove"))
      ?.props.onClick(),
  );
  expect(remove).toHaveBeenCalledWith("en");
});
it("displays failed installations without an unhandled rejection", async () => {
  install.mockRejectedValue(new Error("disk full"));
  await act(async () => {
    view = TestRenderer.create(<DictionarySettings />);
  });
  await act(async () =>
    view.root
      .findAllByType("button")
      .find((button) => button.props["aria-label"] === "Download English dictionary")
      ?.props.onClick(),
  );
  expect(view.root.findByProps({ role: "alert" }).children).toContain("Error");
});
