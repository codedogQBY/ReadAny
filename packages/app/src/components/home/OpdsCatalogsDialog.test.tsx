// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./opds-component-test-setup";

const harness = vi.hoisted(() => {
  const catalog = {
    id: "custom",
    name: "Test Catalog",
    url: "https://catalog.test/opds",
    auth: "anonymous" as const,
    enabled: true,
    builtIn: false,
    hidden: false,
    passwordStorage: "none" as const,
  };
  const visibleBuiltIn = {
    ...catalog,
    id: "built-in-visible",
    name: "Built-in Catalog",
    builtIn: true,
  };
  const hiddenBuiltIn = {
    ...catalog,
    id: "built-in-hidden",
    name: "Hidden Catalog",
    builtIn: true,
    hidden: true,
  };
  const store = {
    listCatalogs: vi.fn(() => [catalog, visibleBuiltIn, hiddenBuiltIn]),
    getCredentials: vi.fn(async () => undefined),
    removeCatalog: vi.fn(async () => undefined),
    updateCatalog: vi.fn(async () => undefined),
    setCatalogEnabled: vi.fn(async () => undefined),
    hideBuiltIn: vi.fn(async () => undefined),
    restoreBuiltIn: vi.fn(async () => undefined),
  };
  const client = {
    open: vi.fn(async () => ({
      title: "Test Shelf",
      navigation: [],
      publications: [],
      groups: [],
      facets: [],
    })),
  };
  const ensureCatalogsLoaded = vi.fn(async () => undefined);
  const translate = (key: string, values?: Record<string, unknown>) =>
    values?.name ? `${key}:${values.name}` : key;
  const download = vi.fn();
  const cancelDownload = vi.fn();
  return {
    catalog,
    store,
    client,
    ensureCatalogsLoaded,
    translate,
    download,
    cancelDownload,
  };
});

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: harness.translate }),
}));

vi.mock("./opds-desktop-runtime", () => ({
  opdsDesktopRuntime: {
    ensureCatalogsLoaded: harness.ensureCatalogsLoaded,
    getCatalogStore: () => harness.store,
    getClient: () => harness.client,
  },
}));

vi.mock("./useOpdsDownload", () => ({
  useOpdsDownload: () => ({
    download: harness.download,
    cancel: harness.cancelDownload,
    progress: null,
    isDownloading: false,
  }),
}));

import { OpdsCatalogsDialog } from "./OpdsCatalogsDialog";

describe("OpdsCatalogsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
    document.body.removeAttribute("data-scroll-locked");
  });

  it("keeps the dialog named and moves focus into and back out of browser mode", async () => {
    render(<OpdsCatalogsDialog open onOpenChange={vi.fn()} />);
    await waitFor(() => expect(harness.ensureCatalogsLoaded).toHaveBeenCalledOnce());
    await waitFor(() => expect(harness.store.listCatalogs).toHaveBeenCalled());
    const browse = await screen.findByRole("button", {
      name: "library.opds.browseCatalog:Test Catalog",
    });
    expect(screen.getByRole("dialog", { name: "library.opds.catalogsTitle" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "library.opds.close" })).toBeTruthy();

    await userEvent.click(browse);

    const browserHeading = await screen.findByRole("heading", { name: "Test Shelf" });
    expect(screen.getByRole("dialog", { name: "Test Catalog" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(browserHeading));
    await userEvent.keyboard("{Escape}");

    const restored = await screen.findByRole("button", {
      name: "library.opds.browseCatalog:Test Catalog",
    });
    await waitFor(() => expect(document.activeElement).toBe(restored));
  });

  it("wires the localized nested delete dialog to custom catalog deletion", async () => {
    render(<OpdsCatalogsDialog open onOpenChange={vi.fn()} />);
    await waitFor(() => expect(harness.store.listCatalogs).toHaveBeenCalled());
    const trigger = await screen.findByRole("button", {
      name: "library.opds.deleteCatalog:Test Catalog",
    });
    await userEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "library.opds.deleteTitle" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "library.opds.close" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "library.opds.delete" }));

    await waitFor(() => expect(harness.store.removeCatalog).toHaveBeenCalledWith("custom"));
  });

  it("wires rendered update, enable, hide, and restore catalog actions", async () => {
    render(<OpdsCatalogsDialog open onOpenChange={vi.fn()} />);
    await waitFor(() => expect(harness.store.listCatalogs).toHaveBeenCalled());

    await userEvent.click(
      screen.getByRole("switch", { name: "library.opds.toggleCatalog:Test Catalog" }),
    );
    expect(harness.store.setCatalogEnabled).toHaveBeenCalledWith("custom", false);

    await userEvent.click(
      screen.getByRole("button", {
        name: "library.opds.hideCatalog:Built-in Catalog",
      }),
    );
    expect(harness.store.hideBuiltIn).toHaveBeenCalledWith("built-in-visible");

    await userEvent.click(
      screen.getByRole("button", {
        name: "library.opds.restoreCatalog:Hidden Catalog",
      }),
    );
    expect(harness.store.restoreBuiltIn).toHaveBeenCalledWith("built-in-hidden");

    await userEvent.click(
      screen.getByRole("button", { name: "library.opds.editCatalog:Test Catalog" }),
    );
    const name = await screen.findByLabelText("library.opds.form.name");
    await userEvent.clear(name);
    await userEvent.type(name, "Updated Catalog");
    await userEvent.click(screen.getByRole("button", { name: "library.opds.save" }));

    await waitFor(() =>
      expect(harness.store.updateCatalog).toHaveBeenCalledWith(
        "custom",
        expect.objectContaining({ name: "Updated Catalog", enabled: true }),
      ),
    );
  });

  it("returns focus to the originating control when the dialog closes", async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open catalogs
          </button>
          <OpdsCatalogsDialog open={open} onOpenChange={setOpen} />
        </>
      );
    }
    render(<Host />);
    const origin = screen.getByRole("button", { name: "Open catalogs" });
    await userEvent.click(origin);
    const dialog = await screen.findByRole("dialog", { name: "library.opds.catalogsTitle" });
    for (let index = 0; index < 8; index += 1) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await userEvent.click(screen.getByRole("button", { name: "library.opds.close" }));

    await waitFor(() => expect(document.activeElement).toBe(origin));
  });
});
