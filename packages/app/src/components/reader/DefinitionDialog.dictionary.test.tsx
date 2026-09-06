import { DefinitionController } from "@readany/core/dictionary/definition-controller";
import { DICTIONARY_BUNDLED_MANIFEST } from "@readany/core/dictionary/dictionary-config";
import i18n, { i18nReady } from "@readany/core/i18n";
import type React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DefinitionDialog } from "./DefinitionDialog";
import { SelectionPopover } from "./SelectionPopover";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));
const mounted: TestRenderer.ReactTestRenderer[] = [];
beforeAll(async () => {
  await i18nReady;
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await act(async () => {
    for (const view of mounted.splice(0)) view.unmount();
  });
});
async function render(element: React.ReactElement) {
  let view!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(element);
  });
  mounted.push(view);
  return view;
}
function dependencies() {
  return {
    lookup: vi.fn().mockResolvedValue([]),
    install: vi.fn().mockResolvedValue(undefined),
    getDescriptor: () => DICTIONARY_BUNDLED_MANIFEST.packs.en,
  };
}

describe("desktop definition dialog", () => {
  it("shows an offline result and closes before opening dictionary management", async () => {
    const deps = dependencies();
    deps.lookup.mockResolvedValue([
      {
        id: 1,
        language: "en",
        headword: "hello",
        partOfSpeech: "noun",
        senses: [{ order: 1, definition: "a greeting" }],
      },
    ]);
    const events: string[] = [];
    const view = await render(
      <DefinitionDialog
        text="hello"
        controller={new DefinitionController(deps)}
        onClose={() => events.push("close")}
        onManageDictionaries={() => events.push("manage")}
      />,
    );
    expect(JSON.stringify(view.toJSON())).toContain("a greeting");
    await act(async () => {
      view.root
        .findAllByType("button")
        .find((button) => button.children.includes("Manage Dictionaries"))
        ?.props.onClick();
    });
    expect(events).toEqual(["close", "manage"]);
  });
  it("offers a download for a missing pack and retries the original selection", async () => {
    const deps = dependencies();
    deps.lookup
      .mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "pack-not-installed" }))
      .mockResolvedValueOnce([]);
    const view = await render(
      <DefinitionDialog
        text="hello"
        controller={new DefinitionController(deps)}
        onClose={vi.fn()}
        onManageDictionaries={vi.fn()}
      />,
    );
    expect(deps.install).not.toHaveBeenCalled();
    await act(async () => {
      view.root
        .findAllByType("button")
        .find((button) => button.children.includes("Download"))
        ?.props.onClick();
    });
    expect(deps.install).toHaveBeenCalledOnce();
    expect(deps.lookup).toHaveBeenLastCalledWith("hello");
    expect(JSON.stringify(view.toJSON())).toContain("No definition found");
  });
  it("offers retry on lookup failure", async () => {
    const deps = dependencies();
    deps.lookup.mockRejectedValueOnce(new Error("failed"));
    const view = await render(
      <DefinitionDialog
        text="hello"
        controller={new DefinitionController(deps)}
        onClose={vi.fn()}
        onManageDictionaries={vi.fn()}
      />,
    );
    expect(view.root.findByProps({ role: "alert" }).children.join("")).toContain("lookup failed");
    await act(async () => {
      view.root
        .findAllByType("button")
        .find((button) => button.children.includes("Retry"))
        ?.props.onClick();
    });
    expect(deps.lookup).toHaveBeenCalledTimes(2);
  });
  it("discards pending results when unmounted", async () => {
    const deps = dependencies();
    let resolve!: (rows: unknown[]) => void;
    deps.lookup.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const controller = new DefinitionController(deps);
    const view = await render(
      <DefinitionDialog
        text="hello"
        controller={controller}
        onClose={vi.fn()}
        onManageDictionaries={vi.fn()}
      />,
    );
    await act(async () => view.unmount());
    await act(async () => resolve([]));
    expect(controller.state).toEqual({ kind: "idle" });
  });
  it("only offers Define for supported selections, including in PDFs", async () => {
    const callback = vi.fn();
    const props = {
      position: { x: 0, y: 0 },
      onHighlight: callback,
      onRemoveHighlight: callback,
      onNote: callback,
      onCopy: callback,
      onTranslate: callback,
      onAskAI: callback,
      onSpeak: callback,
      onClose: callback,
      onDefine: callback,
    };
    const view = await render(<SelectionPopover {...props} selectedText="hello" isPdf />);
    expect(view.root.findByProps({ "aria-label": "Define" })).toBeDefined();
    await act(async () =>
      view.update(<SelectionPopover {...props} selectedText={"a".repeat(121)} />),
    );
    expect(view.root.findAllByProps({ "aria-label": "Define" })).toHaveLength(0);
  });
});
