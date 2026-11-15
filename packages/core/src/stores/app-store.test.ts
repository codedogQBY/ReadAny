import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";

describe("app-store tab initial location", () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [{ id: "home", type: "home", title: "Home" }],
      activeTabId: "home",
      sidebarOpen: false,
      sidebarTab: "chat",
      showSettings: false,
      settingsTab: "general",
    });
  });

  it("updates and clears reader initialCfi on an existing tab", () => {
    const { addTab } = useAppStore.getState();

    addTab({
      id: "reader-book-1",
      type: "reader",
      title: "Book 1",
      bookId: "book-1",
      initialCfi: "epubcfi(/6/2)",
    });
    addTab({
      id: "reader-book-1",
      type: "reader",
      title: "Book 1",
      bookId: "book-1",
      initialCfi: "page:3",
    });

    expect(useAppStore.getState().tabs.find((tab) => tab.id === "reader-book-1")?.initialCfi).toBe(
      "page:3",
    );

    addTab({
      id: "reader-book-1",
      type: "reader",
      title: "Book 1",
      bookId: "book-1",
      initialCfi: undefined,
    });

    expect(
      useAppStore.getState().tabs.find((tab) => tab.id === "reader-book-1")?.initialCfi,
    ).toBeUndefined();
  });

  it("opens an EPUB draft workspace tab with draft identity", () => {
    const { addTab } = useAppStore.getState();

    addTab({
      id: "epub-draft-draft-1",
      type: "epubDraft",
      title: "Draft",
      bookId: "book-1",
      draftId: "draft-1",
    });

    const tab = useAppStore.getState().tabs.find((item) => item.id === "epub-draft-draft-1");
    expect(tab).toMatchObject({
      type: "epubDraft",
      bookId: "book-1",
      draftId: "draft-1",
    });
    expect(useAppStore.getState().activeTabId).toBe("epub-draft-draft-1");
  });

  it("closes the book assistant with its reader while preserving unrelated tabs", () => {
    const { addTab, removeTab } = useAppStore.getState();
    addTab({ id: "reader-1", type: "reader", title: "Book", bookId: "book-1" });
    addTab({ id: "chat", type: "chat", title: "General chat" });
    addTab({ id: "reader-2", type: "reader", title: "Other book", bookId: "book-2" });
    addTab({ id: "book-chat-1", type: "chat", title: "Book AI", bookId: "book-1" });
    removeTab("reader-1");
    expect(useAppStore.getState().tabs.map((tab) => tab.id)).toEqual(["home", "chat", "reader-2"]);
    expect(useAppStore.getState().activeTabId).toBe("reader-2");
  });

  it("returns to the reader when closing its active assistant tab", () => {
    const { addTab, removeTab } = useAppStore.getState();
    addTab({ id: "reader-1", type: "reader", title: "Book", bookId: "book-1" });
    addTab({ id: "reader-2", type: "reader", title: "Other book", bookId: "book-2" });
    addTab({ id: "book-chat-1", type: "chat", title: "Book AI", bookId: "book-1" });
    removeTab("book-chat-1");
    expect(useAppStore.getState().activeTabId).toBe("reader-1");
    expect(useAppStore.getState().tabs.some((tab) => tab.id === "reader-1")).toBe(true);
  });

  it("does not change the active page when closing another book and its assistant", () => {
    const { addTab, removeTab } = useAppStore.getState();
    addTab({ id: "reader-1", type: "reader", title: "Book", bookId: "book-1" });
    addTab({ id: "book-chat-1", type: "chat", title: "Book AI", bookId: "book-1" });
    addTab({ id: "chat", type: "chat", title: "General chat" });
    removeTab("reader-1");
    expect(useAppStore.getState().activeTabId).toBe("chat");
  });

  it("preserves a home sub-view when closing a background reader", () => {
    useAppStore
      .getState()
      .addTab({ id: "reader-1", type: "reader", title: "Book", bookId: "book-1" });
    useAppStore.getState().setActiveTab("stats");
    useAppStore.getState().removeTab("reader-1");
    expect(useAppStore.getState().activeTabId).toBe("stats");
  });
});
