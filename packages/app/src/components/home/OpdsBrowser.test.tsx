// @vitest-environment jsdom

import type { OpdsPublication } from "@readany/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./opds-component-test-setup";

const harness = vi.hoisted(() => {
  let resolveDownload!: (value: unknown) => void;
  const download = vi.fn(
    () =>
      new Promise((resolve) => {
        resolveDownload = resolve;
      }),
  );
  const cancel = vi.fn();
  const translate = (key: string, values?: Record<string, unknown>) => {
    if (values?.title) return `${key}:${values.title}`;
    if (values?.format) return `${key}:${values.format}`;
    if (values?.percent !== undefined) return `${key}:${values.percent}`;
    return key;
  };
  return { download, cancel, translate, resolve: (value: unknown) => resolveDownload(value) };
});

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: harness.translate }),
}));

vi.mock("./useOpdsDownload", () => ({
  useOpdsDownload: () => ({
    download: harness.download,
    cancel: harness.cancel,
    progress: { loaded: 25, total: 100 },
    isDownloading: true,
  }),
}));

import { OpdsBrowser } from "./OpdsBrowser";

const epub = {
  rel: ["http://opds-spec.org/acquisition"],
  url: "https://catalog.test/book.epub",
  type: "application/epub+zip",
  format: "epub" as const,
};
const pdf = {
  rel: ["http://opds-spec.org/acquisition"],
  url: "https://catalog.test/book.pdf",
  type: "application/pdf",
  format: "pdf" as const,
};

function publication(index: number): OpdsPublication {
  return {
    id: `book-${index}`,
    title: `Book ${index}`,
    authors: ["Reader"],
    subjects: [],
    description: index === 0 ? '<p><a href="https://author.test">Author</a></p>' : undefined,
    images: [],
    acquisitions: index === 0 ? [epub, pdf] : [],
    readingOrder: [],
  };
}

describe("OpdsBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("windows a dense feed and wires nested format progress and cancellation UI", async () => {
    const store = { getCredentials: vi.fn(async () => undefined) };
    const client = {
      open: vi.fn(async () => ({
        title: "Dense Shelf",
        navigation: [],
        publications: Array.from({ length: 40 }, (_, index) => publication(index)),
        groups: [],
        facets: [],
      })),
    };
    const { container, unmount } = render(
      <OpdsBrowser
        catalog={{
          id: "catalog",
          name: "Catalog",
          url: "https://catalog.test/opds",
          auth: "anonymous",
          enabled: true,
          builtIn: false,
          hidden: false,
          passwordStorage: "none",
        }}
        store={store as never}
        client={client as never}
        onBack={vi.fn()}
        onEditCredentials={vi.fn()}
        registerBackHandler={vi.fn()}
      />,
    );

    await screen.findByRole("heading", { name: "Dense Shelf" });
    expect(container.querySelectorAll("article")).toHaveLength(18);
    await userEvent.click(
      screen.getByRole("button", { name: "library.opds.publicationDetails:Book 0" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "library.opds.chooseFormat" }));
    expect(screen.getByRole("dialog", { name: "library.opds.chooseFormat" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "library.opds.close" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "library.opds.downloadFormat:EPUB" }));

    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("25");
    await userEvent.click(screen.getByRole("button", { name: "library.opds.cancel" }));
    expect(harness.cancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status")).toBeNull();

    harness.resolve({ importResult: { imported: [], skippedDuplicates: [], failures: [] } });
    await waitFor(() => expect(harness.download).toHaveBeenCalledOnce());
    unmount();
  });

  it("cancels during deferred credentials before the download transport starts", async () => {
    let resolveCredentials!: () => void;
    const credentials = new Promise<void>((resolve) => {
      resolveCredentials = resolve;
    });
    const store = {
      getCredentials: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(() => credentials),
    };
    const singleFormat = { ...publication(0), acquisitions: [epub] };
    const client = {
      open: vi.fn(async () => ({
        title: "Single Shelf",
        navigation: [],
        publications: [singleFormat],
        groups: [],
        facets: [],
      })),
    };
    render(
      <OpdsBrowser
        catalog={{
          id: "catalog",
          name: "Catalog",
          url: "https://catalog.test/opds",
          auth: "anonymous",
          enabled: true,
          builtIn: false,
          hidden: false,
          passwordStorage: "none",
        }}
        store={store as never}
        client={client as never}
        onBack={vi.fn()}
        onEditCredentials={vi.fn()}
        registerBackHandler={vi.fn()}
      />,
    );
    await screen.findByRole("heading", { name: "Single Shelf" });
    await userEvent.click(
      screen.getByRole("button", { name: "library.opds.publicationDetails:Book 0" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "library.opds.downloadAndImport" }));
    await userEvent.click(screen.getByRole("button", { name: "library.opds.cancel" }));
    resolveCredentials();
    await Promise.resolve();

    expect(harness.download).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("dismisses a failed push and suppresses a later cancelled push", async () => {
    let resolveChild!: (value: unknown) => void;
    const child = new Promise((resolve) => {
      resolveChild = resolve;
    });
    const rootFeed = {
      title: "Root Shelf",
      navigation: [{ rel: ["subsection"], title: "Child", url: "https://catalog.test/child" }],
      publications: [],
      groups: [],
      facets: [],
    };
    let opens = 0;
    const client = {
      open: vi.fn(() => {
        opens += 1;
        if (opens === 1) return Promise.resolve(rootFeed);
        if (opens === 2) return Promise.reject(new Error("offline"));
        return child;
      }),
    };
    const onBack = vi.fn();
    render(
      <OpdsBrowser
        catalog={{
          id: "catalog",
          name: "Catalog",
          url: "https://catalog.test/opds",
          auth: "anonymous",
          enabled: true,
          builtIn: false,
          hidden: false,
          passwordStorage: "none",
        }}
        store={{ getCredentials: vi.fn(async () => undefined) } as never}
        client={client as never}
        onBack={onBack}
        onEditCredentials={vi.fn()}
        registerBackHandler={vi.fn()}
      />,
    );
    await screen.findByRole("heading", { name: "Root Shelf" });
    expect(client.open).toHaveBeenLastCalledWith(
      "https://catalog.test/opds",
      undefined,
      expect.any(AbortSignal),
      "https://catalog.test",
    );
    await userEvent.click(screen.getByRole("button", { name: "Child" }));
    await waitFor(() =>
      expect(client.open).toHaveBeenLastCalledWith(
        "https://catalog.test/child",
        undefined,
        expect.any(AbortSignal),
        "https://catalog.test",
      ),
    );
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: "library.opds.back" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("heading", { name: "Root Shelf" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Child" }));
    await userEvent.click(screen.getByRole("button", { name: "library.opds.back" }));
    resolveChild({ ...rootFeed, title: "Stale Child" });
    await Promise.resolve();

    expect(screen.getByRole("heading", { name: "Root Shelf" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Stale Child" })).toBeNull();
    expect(onBack).not.toHaveBeenCalled();
  });
});
