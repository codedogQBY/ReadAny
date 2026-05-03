/**
 * HomePage — library page
 */
import { DesktopImportActions } from "@/components/home/DesktopImportActions";
import { GroupPickerPopover } from "@/components/home/GroupPickerPopover";
import { SyncButton } from "@/components/ui/SyncButton";
import { triggerVectorizeBook } from "@/lib/rag/vectorize-trigger";
import { useLibraryStore } from "@/stores/library-store";
import type { BookGroup, SortField } from "@readany/core/types";
import {
  ArrowDownAZ,
  ArrowLeft,
  ArrowUpAZ,
  CheckCheck,
  Database,
  FolderInput,
  FolderMinus,
  Hash,
  Layers,
  Loader2,
  MoreHorizontal,
  Plus,
  SortAsc,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookCard } from "./BookCard";
import { BookGrid } from "./BookGrid";
import { GroupCard } from "./GroupCard";
import { ImportDropZone } from "./ImportDropZone";

const SORT_OPTIONS: { field: SortField; labelKey: string }[] = [
  { field: "lastOpenedAt", labelKey: "library.sortRecent" },
  { field: "addedAt", labelKey: "library.sortAdded" },
  { field: "title", labelKey: "library.sortTitle" },
  { field: "author", labelKey: "library.sortAuthor" },
  { field: "progress", labelKey: "library.sortProgress" },
];

export function HomePage() {
  const { t } = useTranslation();
  const {
    books,
    groups,
    filter,
    activeTag,
    activeGroupId,
    isGroupView,
    isImporting,
    removeBook,
    addTagToBook,
    addTag,
    allTags,
    setFilter,
    setGroupView,
    setActiveGroupId,
    addGroup,
    renameGroup,
    removeGroup,
    moveBooksToGroup,
  } = useLibraryStore();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(new Set());
  const [showBatchTagMenu, setShowBatchTagMenu] = useState(false);
  const [batchNewTagInput, setBatchNewTagInput] = useState("");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showBatchGroupPicker, setShowBatchGroupPicker] = useState(false);
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const sortBtnRef = useRef<HTMLButtonElement>(null);
  const groupBtnRef = useRef<HTMLButtonElement>(null);

  const filtered = useMemo(() => {
    let result = books.filter((b) => {
      if (activeTag === "__uncategorized__") {
        if (b.tags.length > 0) return false;
      } else if (activeTag && !b.tags.includes(activeTag)) {
        return false;
      }
      if (activeGroupId && b.groupId !== activeGroupId) {
        return false;
      }
      if (filter.search) {
        const q = filter.search.toLowerCase();
        return b.meta.title.toLowerCase().includes(q) || b.meta.author?.toLowerCase().includes(q);
      }
      return true;
    });
    const { sortField, sortOrder } = filter;
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "title":
          cmp = a.meta.title.localeCompare(b.meta.title);
          break;
        case "author":
          cmp = (a.meta.author || "").localeCompare(b.meta.author || "");
          break;
        case "addedAt":
          cmp = (a.addedAt || 0) - (b.addedAt || 0);
          break;
        case "lastOpenedAt":
          cmp = (a.lastOpenedAt || 0) - (b.lastOpenedAt || 0);
          break;
        case "progress":
          cmp = a.progress - b.progress;
          break;
      }
      return sortOrder === "desc" ? -cmp : cmp;
    });
    return result;
  }, [books, filter, activeTag, activeGroupId]);

  const activeGroup = useMemo(
    () => groups.find((group) => group.id === activeGroupId) ?? null,
    [groups, activeGroupId],
  );

  const groupedEntries = useMemo(() => {
    const query = filter.search.toLowerCase().trim();
    return groups
      .map((group) => {
        const groupBooks = filtered.filter((book) => book.groupId === group.id);
        return { group, books: groupBooks };
      })
      .filter(
        ({ group, books }) =>
          books.length > 0 && (!query || group.name.toLowerCase().includes(query)),
      );
  }, [filtered, filter.search, groups]);

  const visibleBooks = useMemo(
    () => (isGroupView && !activeGroupId ? filtered.filter((book) => !book.groupId) : filtered),
    [activeGroupId, filtered, isGroupView],
  );
  const visibleItemCount =
    isGroupView && !activeGroupId
      ? groupedEntries.length + visibleBooks.length
      : visibleBooks.length;

  type MixedItem =
    | { type: "group"; group: BookGroup; books: import("@readany/core/types").Book[] }
    | { type: "book"; book: import("@readany/core/types").Book };

  const mixedItems = useMemo((): MixedItem[] => {
    if (!isGroupView || activeGroupId) return [];
    const items: MixedItem[] = [];
    for (const { group, books: groupBooks } of groupedEntries) {
      items.push({ type: "group", group, books: groupBooks });
    }
    for (const book of visibleBooks) {
      items.push({ type: "book", book });
    }
    return items;
  }, [isGroupView, activeGroupId, groupedEntries, visibleBooks]);

  const handleSortChange = useCallback(
    (field: SortField) => {
      if (filter.sortField === field) {
        setFilter({ sortOrder: filter.sortOrder === "asc" ? "desc" : "asc" });
      } else {
        setFilter({
          sortField: field,
          sortOrder: field === "title" || field === "author" ? "asc" : "desc",
        });
      }
      setShowSortMenu(false);
    },
    [filter, setFilter],
  );


  const handleDeleteGroup = useCallback(
    async (group: BookGroup) => {
      await removeGroup(group.id);
    },
    [removeGroup],
  );

  const toggleBookSelection = useCallback((bookId: string) => {
    setSelectedBookIds((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedBookIds(new Set());
    setShowBatchTagMenu(false);
  }, []);

  const handleBatchMoveGroup = useCallback(() => {
    if (selectedBookIds.size === 0) return;
    setShowBatchGroupPicker(true);
  }, [selectedBookIds]);

  const handleBatchGroupSelect = useCallback(
    (groupId: string | undefined) => {
      moveBooksToGroup([...selectedBookIds], groupId);
      exitSelectionMode();
      setShowBatchGroupPicker(false);
    },
    [exitSelectionMode, moveBooksToGroup, selectedBookIds],
  );

  const handleBatchGroupCreate = useCallback(
    async (name: string) => {
      const group = await addGroup(name);
      if (group) {
        moveBooksToGroup([...selectedBookIds], group.id);
        exitSelectionMode();
      }
      setShowBatchGroupPicker(false);
    },
    [addGroup, exitSelectionMode, moveBooksToGroup, selectedBookIds],
  );

  const isAllSelected = visibleBooks.length > 0 && selectedBookIds.size === visibleBooks.length;

  const toggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedBookIds(new Set());
    } else {
      setSelectedBookIds(new Set(visibleBooks.map((b) => b.id)));
    }
  }, [visibleBooks, isAllSelected]);

  const handleBatchDelete = useCallback(async () => {
    if (selectedBookIds.size === 0) return;
    if (
      !confirm(t("library.batchDeleteConfirm", `确定要删除选中的 ${selectedBookIds.size} 本书吗？`))
    )
      return;
    for (const id of selectedBookIds) {
      await removeBook(id);
    }
    exitSelectionMode();
  }, [selectedBookIds, removeBook, exitSelectionMode, t]);

  const handleBatchVectorize = useCallback(async () => {
    if (selectedBookIds.size === 0) return;
    const selectedBooks = books.filter((b) => selectedBookIds.has(b.id));
    for (const book of selectedBooks) {
      triggerVectorizeBook(book.id, book.filePath);
    }
    exitSelectionMode();
  }, [selectedBookIds, books, exitSelectionMode]);

  const handleBatchRemoveFromGroup = useCallback(() => {
    if (selectedBookIds.size === 0) return;
    moveBooksToGroup([...selectedBookIds], undefined);
    exitSelectionMode();
  }, [exitSelectionMode, moveBooksToGroup, selectedBookIds]);

  const handleBatchAddTag = useCallback(
    (tag: string) => {
      for (const id of selectedBookIds) {
        addTagToBook(id, tag);
      }
    },
    [selectedBookIds, addTagToBook],
  );

  if (books.length === 0) {
    return <ImportDropZone />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-6 pt-5 pb-2">
        {selectionMode ? (
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-full p-1.5 hover:bg-muted"
                onClick={exitSelectionMode}
              >
                <X className="size-5" />
              </button>
              <h1 className="text-lg font-semibold text-foreground">
                {t("library.selectedCount", {
                  count: selectedBookIds.size,
                  defaultValue: `已选 ${selectedBookIds.size} 本`,
                })}
              </h1>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
                title={t("library.selectAll", "全选")}
                onClick={toggleSelectAll}
              >
                <CheckCheck className={`size-4 ${isAllSelected ? "text-primary" : ""}`} />
              </button>
              <div className="relative">
                <button
                  type="button"
                  className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
                  title={t("home.manageTags", "标签")}
                  onClick={() => setShowBatchTagMenu(!showBatchTagMenu)}
                >
                  <Hash className="size-4" />
                </button>
                {showBatchTagMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowBatchTagMenu(false)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setShowBatchTagMenu(false);
                      }}
                    />
                    <div className="absolute right-0 top-full z-50 mt-1 min-w-36 max-h-52 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
                      {allTags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted"
                          onClick={() => handleBatchAddTag(tag)}
                        >
                          <span className="truncate">{tag}</span>
                        </button>
                      ))}
                      <div className="mt-1 border-t pt-1">
                        <div className="flex items-center gap-1 px-1">
                          <Plus className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <input
                            type="text"
                            className="w-full bg-transparent px-1 py-1 text-xs outline-none placeholder:text-muted-foreground"
                            placeholder={t("sidebar.tagPlaceholder")}
                            value={batchNewTagInput}
                            onChange={(e) => setBatchNewTagInput(e.target.value)}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Enter" && batchNewTagInput.trim()) {
                                addTag(batchNewTagInput.trim());
                                handleBatchAddTag(batchNewTagInput.trim());
                                setBatchNewTagInput("");
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <button
                ref={groupBtnRef}
                type="button"
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
                title={t("library.moveToGroup", "移入分组")}
                onClick={handleBatchMoveGroup}
              >
                <FolderInput className="size-4" />
              </button>
              {activeGroupId && (
                <button
                  type="button"
                  className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
                  title={t("library.removeFromGroup", "移出分组")}
                  onClick={handleBatchRemoveFromGroup}
                >
                  <FolderMinus className="size-4" />
                </button>
              )}
              <button
                type="button"
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
                title={t("home.vec_vectorize", "向量化")}
                onClick={handleBatchVectorize}
              >
                <Database className="size-4" />
              </button>
              <button
                type="button"
                className="rounded-lg p-2 text-destructive hover:bg-destructive/10"
                title={t("common.delete", "删除")}
                onClick={handleBatchDelete}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              {activeGroup && (
                <button
                  type="button"
                  className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setActiveGroupId("")}
                  title={t("common.back", "返回")}
                >
                  <ArrowLeft className="size-5" />
                </button>
              )}
              <h1 className="text-3xl font-bold text-foreground">
                {activeGroup
                  ? activeGroup.name
                  : activeTag === "__uncategorized__"
                    ? t("sidebar.uncategorized")
                    : activeTag || t("home.library")}
              </h1>
              {activeGroup && (
                <div className="relative">
                  <button
                    type="button"
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setShowGroupMenu((v) => !v)}
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                  {showGroupMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setShowGroupMenu(false)}
                      />
                      <div className="absolute left-0 top-full z-50 mt-1 min-w-32 rounded-lg border bg-popover p-1 shadow-lg">
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                          onClick={() => {
                            setShowGroupMenu(false);
                            handleDeleteGroup(activeGroup);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {t("common.delete", "删除")}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              <SyncButton />
            </div>
            <div className="flex items-center gap-2">
              {books.length > 0 && (
                <>
                  <div className="relative">
                    <button
                      ref={sortBtnRef}
                      type="button"
                      className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
                      title={t("library.sort", "排序")}
                      onClick={() => setShowSortMenu(!showSortMenu)}
                    >
                      <SortAsc className="size-4" />
                    </button>
                    {showSortMenu && (
                      <>
                        <div
                          className="fixed inset-0 z-40"
                          onClick={() => setShowSortMenu(false)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setShowSortMenu(false);
                          }}
                        />
                        <div className="absolute right-0 top-full z-50 mt-1 min-w-40 rounded-lg border bg-popover p-1 shadow-lg">
                          {SORT_OPTIONS.map(({ field, labelKey }) => (
                            <button
                              key={field}
                              type="button"
                              className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors ${
                                filter.sortField === field
                                  ? "bg-primary/10 text-primary font-medium"
                                  : "text-foreground hover:bg-muted"
                              }`}
                              onClick={() => handleSortChange(field)}
                            >
                              {filter.sortField === field ? (
                                filter.sortOrder === "asc" ? (
                                  <ArrowUpAZ className="size-3.5" />
                                ) : (
                                  <ArrowDownAZ className="size-3.5" />
                                )
                              ) : (
                                <span className="size-3.5" />
                              )}
                              {t(labelKey)}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    className={`rounded-lg p-2 transition-colors ${
                      isGroupView
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                    title={t("library.groupView", "分组")}
                    onClick={() => {
                      setActiveGroupId("");
                      setGroupView(!isGroupView);
                    }}
                  >
                    <Layers className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
                    onClick={() => setSelectionMode(true)}
                  >
                    {t("library.select", "选择")}
                  </button>
                </>
              )}
              <DesktopImportActions align="end">
                <button
                  id="tour-add-book"
                  type="button"
                  disabled={isImporting}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  {isImporting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  {isImporting ? t("library.importing", "导入中...") : t("home.addBook")}
                </button>
              </DesktopImportActions>
            </div>
          </>
        )}
      </div>

      {/* Search result hint */}
      {filter.search && (
        <div className="px-6 pb-2">
          {visibleItemCount > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("home.foundBooks", { count: visibleItemCount, query: filter.search })}
            </p>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                {t("home.noBooksFound", { query: filter.search })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{t("home.tryDifferentSearch")}</p>
            </div>
          )}
        </div>
      )}

      {/* Book display */}
      <div id="tour-book-list" className="flex-1 overflow-y-auto px-6 pb-4">
        {isGroupView && !activeGroupId && mixedItems.length > 0 ? (
          <div className="grid grid-cols-3 gap-x-5 gap-y-6 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {mixedItems.map((item) =>
              item.type === "group" ? (
                <GroupCard
                  key={item.group.id}
                  group={item.group}
                  books={item.books}
                  onOpen={setActiveGroupId}
                  renameGroup={renameGroup}
                  onDelete={handleDeleteGroup}
                />
              ) : (
                <BookCard
                  key={item.book.id}
                  book={item.book}
                  isSelectionMode={selectionMode}
                  isSelected={selectedBookIds.has(item.book.id)}
                  onSelect={toggleBookSelection}
                />
              ),
            )}
          </div>
        ) : (
          <BookGrid
            books={visibleBooks}
            selectionMode={selectionMode}
            selectedBookIds={selectedBookIds}
            onToggleSelect={toggleBookSelection}
          />
        )}
      </div>

      {showBatchGroupPicker && (
        <GroupPickerPopover
          groups={groups}
          onSelect={handleBatchGroupSelect}
          onCreateGroup={handleBatchGroupCreate}
          onClose={() => setShowBatchGroupPicker(false)}
          anchorRef={groupBtnRef}
        />
      )}
    </div>
  );
}
