import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { SyncButton } from "@/components/ui/SyncButton";
import {
  BookOpenIcon,
  ChevronLeftIcon,
  HighlighterIcon,
  NotebookPenIcon,
  SearchIcon,
  ShareIcon,
  XIcon,
} from "@/components/ui/Icon";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import type { TabParamList } from "@/navigation/TabNavigator";
import { useAnnotationStore, useLibraryStore } from "@/stores";
import { useColors, useTheme } from "@/styles/theme";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { HighlightWithBook } from "@readany/core/db/database";
import { AnnotationExporter, type ExportFormat } from "@readany/core/export";
import { HIGHLIGHT_COLOR_HEX } from "@readany/core/types";
import type { Highlight } from "@readany/core/types";
import { eventBus } from "@readany/core/utils/event-bus";
/**
 * NotesScreen — matching Tauri mobile NotesPage exactly.
 * Features: stats header, book notebooks list with covers, detail view with
 * highlights/notes tabs, chapter grouping, color dots, edit/delete, export, search.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { HighlightCard } from "./notes/HighlightCard";
import { NotebookCard } from "./notes/NotebookCard";
import { NoteCard } from "./notes/NoteCard";
import { makeStyles } from "./notes/notes-styles";
import { useResolvedCovers } from "./notes/useResolvedCovers";

const NOTE_PNG = require("../../assets/note.png");
const NOTE_DARK_PNG = require("../../assets/note-dark.png");

type Nav = NativeStackNavigationProp<RootStackParamList>;
type DetailTab = "notes" | "highlights";
type Props = BottomTabScreenProps<TabParamList, "Notes">;

export function NotesView({
  initialBookId,
  showBackButton,
  edges = ["top"],
  hideDetailHeader,
}: {
  initialBookId?: string | null;
  showBackButton?: boolean;
  edges?: ("top" | "bottom" | "left" | "right")[];
  hideDetailHeader?: boolean;
}) {
  const colors = useColors();
  const { isDark } = useTheme();
  const s = makeStyles(colors);
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const {
    highlightsWithBooks,
    loadAllHighlightsWithBooks,
    removeHighlight,
    updateHighlight,
    stats,
    loadStats,
  } = useAnnotationStore();
  const books = useLibraryStore((s) => s.books);

  const [selectedBookId, setSelectedBookId] = useState<string | null>(initialBookId || null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [detailTab, setDetailTab] = useState<DetailTab>("notes");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");
  const [showExportMenu, setShowExportMenu] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      Promise.all([loadAllHighlightsWithBooks(500), loadStats()]).finally(() =>
        setIsLoading(false),
      );

      return () => {
        setSelectedBookId(null);
        setEditingId(null);
        setSearchQuery("");
      };
    }, [loadAllHighlightsWithBooks, loadStats]),
  );

  useEffect(() => {
    return eventBus.on("sync:completed", () => {
      setIsLoading(true);
      Promise.all([loadAllHighlightsWithBooks(500), loadStats()]).finally(() =>
        setIsLoading(false),
      );
    });
  }, [loadAllHighlightsWithBooks, loadStats]);

  // Handle incoming bookId
  useEffect(() => {
    if (initialBookId) {
      setSelectedBookId(initialBookId);
      setSearchQuery("");
      setEditingId(null);
      setDetailTab("notes");
    }
  }, [initialBookId]);

  // Group by book — matching Tauri exactly
  const bookNotebooks = useMemo(() => {
    const grouped = new Map<
      string,
      {
        bookId: string;
        title: string;
        author: string;
        coverUrl: string | null;
        highlights: HighlightWithBook[];
        notesCount: number;
        highlightsOnlyCount: number;
        latestAt: number;
      }
    >();

    for (const h of highlightsWithBooks) {
      const existing = grouped.get(h.bookId);
      if (existing) {
        existing.highlights.push(h);
        if (h.note) existing.notesCount++;
        else existing.highlightsOnlyCount++;
        if (h.createdAt > existing.latestAt) existing.latestAt = h.createdAt;
      } else {
        grouped.set(h.bookId, {
          bookId: h.bookId,
          title: h.bookTitle || t("notes.unknownBook", "未知书籍"),
          author: h.bookAuthor || t("notes.unknownAuthor", "未知作者"),
          coverUrl: h.bookCoverUrl || null,
          highlights: [h],
          notesCount: h.note ? 1 : 0,
          highlightsOnlyCount: h.note ? 0 : 1,
          latestAt: h.createdAt,
        });
      }
    }

    return Array.from(grouped.values()).sort((a, b) => b.latestAt - a.latestAt);
  }, [highlightsWithBooks, t]);

  // Resolve cover URLs using shared hook
  const resolvedCovers = useResolvedCovers(bookNotebooks);

  const selectedBook = useMemo(() => {
    if (!selectedBookId) return null;
    return bookNotebooks.find((b) => b.bookId === selectedBookId) || null;
  }, [selectedBookId, bookNotebooks]);

  const { notesList, highlightsList } = useMemo(() => {
    if (!selectedBook) return { notesList: [], highlightsList: [] };
    let all = selectedBook.highlights;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      all = all.filter(
        (h) =>
          h.text.toLowerCase().includes(q) ||
          h.note?.toLowerCase().includes(q) ||
          h.chapterTitle?.toLowerCase().includes(q),
      );
    }
    const sorted = all.sort((a, b) => b.createdAt - a.createdAt);
    return {
      notesList: sorted.filter((h) => h.note),
      highlightsList: sorted.filter((h) => !h.note),
    };
  }, [selectedBook, searchQuery]);

  const currentList = detailTab === "notes" ? notesList : highlightsList;

  // Group by chapter
  const itemsByChapter = useMemo(() => {
    const chapters: { chapter: string; items: HighlightWithBook[] }[] = [];
    const chapterMap = new Map<string, HighlightWithBook[]>();
    for (const h of currentList) {
      const chapter = h.chapterTitle || t("notes.unknownChapter", "未知章节");
      const arr = chapterMap.get(chapter) || [];
      arr.push(h);
      chapterMap.set(chapter, arr);
    }
    for (const [chapter, items] of chapterMap) {
      chapters.push({ chapter, items });
    }
    return chapters;
  }, [currentList, t]);

  const handleOpenBook = useCallback(
    (bookId: string, cfi?: string) => {
      void openMobileBook({ bookId, navigation: nav, t, cfi });
    },
    [nav, t],
  );

  const handleDeleteNote = useCallback(
    (highlight: HighlightWithBook) => {
      Alert.alert(t("common.confirm", "确认"), t("notes.deleteNoteConfirm", "确定删除此笔记？"), [
        { text: t("common.cancel", "取消"), style: "cancel" },
        {
          text: t("common.delete", "删除"),
          style: "destructive",
          onPress: () => {
            updateHighlight(highlight.id, { note: undefined });
          },
        },
      ]);
    },
    [updateHighlight, t],
  );

  const handleDeleteHighlight = useCallback(
    (highlight: HighlightWithBook) => {
      Alert.alert(
        t("common.confirm", "确认"),
        t("notes.deleteHighlightConfirm", "确定删除此高亮？"),
        [
          { text: t("common.cancel", "取消"), style: "cancel" },
          {
            text: t("common.delete", "删除"),
            style: "destructive",
            onPress: () => {
              removeHighlight(highlight.id);
            },
          },
        ],
      );
    },
    [removeHighlight, t],
  );

  const startEditNote = useCallback((highlight: HighlightWithBook) => {
    setEditingId(highlight.id);
    setEditNote(highlight.note || "");
  }, []);

  const saveNote = useCallback(
    (id: string) => {
      updateHighlight(id, { note: editNote || undefined });
      setEditingId(null);
      setEditNote("");
    },
    [updateHighlight, editNote],
  );

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditNote("");
  }, []);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      setShowExportMenu(false);
      if (!selectedBook) return;

      const book = books.find((b) => b.id === selectedBook.bookId);
      if (!book) return;

      const exporter = new AnnotationExporter();
      const content = exporter.export(selectedBook.highlights as Highlight[], [], book, { format });

      try {
        if (format === "notion") {
          await exporter.copyToClipboard(content);
          Alert.alert(t("common.success", "成功"), t("notes.copiedToClipboard", "已复制到剪贴板"));
        } else {
          const ext = format === "json" ? "json" : "md";
          await exporter.downloadAsFile(content, `${selectedBook.title}-${format}.${ext}`, format);
        }
      } catch (err) {
        console.error("Export failed:", err);
        Alert.alert(t("common.error", "错误"), t("notes.exportFailed", "导出失败"));
      }
    },
    [selectedBook, books, t],
  );

  const totalHighlights = stats?.totalHighlights ?? 0;
  const totalNotes = stats?.highlightsWithNotes ?? 0;
  const totalBooks = stats?.totalBooks ?? 0;

  // Loading
  if (isLoading) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top"]}>
        <View style={s.loadingWrap}>
          <View style={s.spinner} />
          <Text style={s.loadingText}>{t("common.loading", "加载中...")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Empty
  if (bookNotebooks.length === 0) {
    return (
      <SafeAreaView
        style={[s.container, { backgroundColor: colors.background }]}
        edges={hideDetailHeader ? [] : ["top"]}
      >
        {!hideDetailHeader && (
          <View style={s.header}>
            <Text style={s.headerTitle}>{t("notes.title", "笔记")}</Text>
          </View>
        )}
        <View style={s.emptyWrap}>
          <Image source={isDark ? NOTE_DARK_PNG : NOTE_PNG} style={{ width: 160, height: 160 }} />
          <Text style={s.emptyTitle}>{t("notes.empty", "暂无笔记")}</Text>
          <Text style={s.emptyHint}>{t("notes.emptyHint", "阅读时长按文字添加高亮和笔记")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Detail view
  if (selectedBookId && selectedBook) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={edges}>
        {/* Detail header - hide entirely when from reader and empty */}
        {!(hideDetailHeader && selectedBook.highlights.length === 0) && (
          <View style={s.detailHeader}>
            {!hideDetailHeader && (
              <View style={s.detailHeaderTop}>
                {/* Back button - return to list when in tab navigation */}
                {showBackButton && (
                  <TouchableOpacity style={s.backBtn} onPress={() => setSelectedBookId(null)}>
                    <ChevronLeftIcon size={20} color={colors.foreground} />
                  </TouchableOpacity>
                )}

                {/* Book cover */}
                {resolvedCovers.get(selectedBook.bookId) || selectedBook.coverUrl ? (
                  <Image
                    source={{
                      uri: resolvedCovers.get(selectedBook.bookId) || selectedBook.coverUrl || "",
                    }}
                    style={s.detailCover}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={s.detailCoverFallback}>
                    <BookOpenIcon size={16} color={colors.mutedForeground} />
                  </View>
                )}

                <View style={s.detailHeaderInfo}>
                  <Text style={s.detailTitle} numberOfLines={1}>
                    {selectedBook.title}
                  </Text>
                  <Text style={s.detailAuthor}>{selectedBook.author}</Text>
                </View>

                {/* Export button */}
                <TouchableOpacity
                  style={s.exportBtn}
                  onPress={() => setShowExportMenu(!showExportMenu)}
                >
                  <ShareIcon size={16} color={colors.foreground} />
                </TouchableOpacity>
              </View>
            )}

            {/* Tabs + search */}
            <View style={s.detailTabRow}>
              <View style={s.tabSwitcher}>
                <TouchableOpacity
                  style={[s.tabBtn, detailTab === "notes" && s.tabBtnActive]}
                  onPress={() => setDetailTab("notes")}
                >
                  <NotebookPenIcon
                    size={12}
                    color={
                      detailTab === "notes" ? colors.primaryForeground : colors.mutedForeground
                    }
                  />
                  <Text style={[s.tabBtnText, detailTab === "notes" && s.tabBtnTextActive]}>
                    {t("notebook.notesSection", "笔记")} ({selectedBook.notesCount || 0})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.tabBtn, detailTab === "highlights" && s.tabBtnActive]}
                  onPress={() => setDetailTab("highlights")}
                >
                  <HighlighterIcon
                    size={12}
                    color={
                      detailTab === "highlights" ? colors.primaryForeground : colors.mutedForeground
                    }
                  />
                  <Text style={[s.tabBtnText, detailTab === "highlights" && s.tabBtnTextActive]}>
                    {t("notebook.highlightsSection", "高亮")} (
                    {selectedBook.highlightsOnlyCount || 0})
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={s.detailSearch}>
                <SearchIcon size={14} color={colors.mutedForeground} />
                <TextInput
                  style={s.detailSearchInput}
                  placeholder={t("notes.searchPlaceholder", "搜索...")}
                  placeholderTextColor={colors.mutedForeground}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>
            </View>
          </View>
        )}

        {/* Detail content */}
        {currentList.length === 0 ? (
          <View style={s.detailEmpty}>
            <Text style={s.detailEmptyText}>
              {searchQuery
                ? t("notes.noSearchResults", "没有匹配结果")
                : detailTab === "notes"
                  ? t("notes.noNotes", "暂无笔记")
                  : t("highlights.noHighlights", "暂无高亮")}
            </Text>
          </View>
        ) : (
          <ScrollView style={s.detailList} showsVerticalScrollIndicator={false}>
            {itemsByChapter.map(({ chapter, items }) => (
              <View key={chapter} style={s.chapterGroup}>
                {/* Chapter divider */}
                <View style={s.chapterDivider}>
                  <View style={s.chapterLine} />
                  <Text style={s.chapterName}>{chapter}</Text>
                  <View style={s.chapterLine} />
                </View>

                {items.map((item) =>
                  detailTab === "notes" ? (
                    <NoteCard
                      key={item.id}
                      highlight={item}
                      isEditing={editingId === item.id}
                      editNote={editNote}
                      setEditNote={setEditNote}
                      onStartEdit={() => startEditNote(item)}
                      onSaveNote={() => saveNote(item.id)}
                      onCancelEdit={cancelEdit}
                      onDeleteNote={() => handleDeleteNote(item)}
                      onNavigate={() => handleOpenBook(selectedBook.bookId, item.cfi)}
                      t={t}
                    />
                  ) : (
                    <HighlightCard
                      key={item.id}
                      highlight={item}
                      onDelete={() => handleDeleteHighlight(item)}
                      onNavigate={() => handleOpenBook(selectedBook.bookId, item.cfi)}
                    />
                  ),
                )}
              </View>
            ))}
            <View style={{ height: 24 }} />
          </ScrollView>
        )}

        {/* Export menu */}
        <Modal
          visible={showExportMenu}
          transparent
          animationType="fade"
          onRequestClose={() => setShowExportMenu(false)}
        >
          <Pressable style={s.exportOverlay} onPress={() => setShowExportMenu(false)} />
          <View style={s.exportDropdown}>
            {(["markdown", "json", "obsidian", "notion"] as const).map((fmt) => (
              <TouchableOpacity key={fmt} style={s.exportItem} onPress={() => handleExport(fmt)}>
                <Text style={s.exportItemText}>
                  {fmt === "markdown"
                    ? "Markdown"
                    : fmt === "json"
                      ? "JSON"
                      : fmt === "obsidian"
                        ? "Obsidian"
                        : "Notion"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  // Main list view
  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={edges}>
      <View style={s.header}>
        <View style={s.headerRow}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={s.headerTitle}>{t("notes.title", "笔记")}</Text>
            <SyncButton size={18} color={colors.mutedForeground} />
          </View>
          {bookNotebooks.length > 0 && (
            <TouchableOpacity
              style={s.searchToggle}
              onPress={() => {
                setShowSearch(!showSearch);
                if (showSearch) setSearchQuery("");
              }}
            >
              {showSearch ? (
                <XIcon size={18} color={colors.mutedForeground} />
              ) : (
                <SearchIcon size={18} color={colors.mutedForeground} />
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Stats row */}
        <View style={s.statsRow}>
          <View style={s.statBadge}>
            <HighlighterIcon size={14} color={colors.amber} />
            <Text style={s.statValue}>{totalHighlights}</Text>
            <Text style={s.statLabel}>{t("notebook.highlightsSection", "高亮")}</Text>
          </View>
          <View style={s.statBadge}>
            <NotebookPenIcon size={14} color={colors.blue} />
            <Text style={s.statValue}>{totalNotes}</Text>
            <Text style={s.statLabel}>{t("notebook.notesSection", "笔记")}</Text>
          </View>
          <View style={s.statBadge}>
            <BookOpenIcon size={14} color={colors.emerald} />
            <Text style={s.statValue}>{totalBooks}</Text>
            <Text style={s.statLabel}>{t("profile.booksUnit", "本")}</Text>
          </View>
        </View>

        {showSearch && (
          <View style={s.searchBar}>
            <SearchIcon size={14} color={colors.mutedForeground} />
            <TextInput
              style={s.searchInput}
              placeholder={t("notes.searchPlaceholder", "搜索笔记...")}
              placeholderTextColor={colors.mutedForeground}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <XIcon size={14} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* Notebook list */}
      <FlatList
        data={bookNotebooks}
        keyExtractor={(item) => item.bookId}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <NotebookCard
            book={item}
            resolvedCoverUrl={resolvedCovers.get(item.bookId)}
            onPress={() => {
              setSelectedBookId(item.bookId);
              setSearchQuery("");
              setEditingId(null);
              setDetailTab("notes");
            }}
          />
        )}
      />
    </SafeAreaView>
  );
}

/** Note detail card — matching Tauri NoteDetailCard */
