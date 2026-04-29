import { Trash2Icon, XIcon } from "@/components/ui/Icon";
import { fontSize as fs, fontWeight as fw, radius, useColors, withOpacity } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";
import { formatRelativeTimeShort, getMonthLabel, groupThreadsByTime } from "@readany/core/utils";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const SCREEN_WIDTH = Dimensions.get("window").width;
const SIDEBAR_WIDTH = Math.min(SCREEN_WIDTH * 0.75, 300);

interface Thread {
  id: string;
  title?: string;
  updatedAt: number;
  messages: Array<{ content?: string }>;
}

interface ThreadSidebarProps {
  visible: boolean;
  threads: Thread[];
  activeThreadId: string | null | undefined;
  sidebarAnim: Animated.Value;
  backdropAnim: Animated.Value;
  insetTop: number;
  onClose: () => void;
  onSelectThread: (id: string) => void;
  onRemoveThread: (id: string) => void;
}

export function ThreadSidebar({
  visible,
  threads,
  activeThreadId,
  sidebarAnim,
  backdropAnim,
  insetTop,
  onClose,
  onSelectThread,
  onRemoveThread,
}: ThreadSidebarProps) {
  const colors = useColors();
  const s = makeStyles(colors);
  const { t } = useTranslation();

  const formatTime = (ts: number) => formatRelativeTimeShort(ts, t);

  const groupedThreads = useMemo(() => {
    const grouped = groupThreadsByTime(threads);
    const sections: { key: string; label: string; threads: Thread[] }[] = [
      { key: "today", label: t("chat.today", "今天"), threads: grouped.today },
      { key: "yesterday", label: t("chat.yesterday", "昨天"), threads: grouped.yesterday },
      { key: "last7Days", label: t("chat.last7Days", "7 天内"), threads: grouped.last7Days },
      { key: "last30Days", label: t("chat.last30Days", "30 天内"), threads: grouped.last30Days },
    ];

    const olderByMonth = new Map<string, Thread[]>();
    for (const thread of grouped.older) {
      const monthLabel = getMonthLabel(thread.updatedAt);
      if (!olderByMonth.has(monthLabel)) olderByMonth.set(monthLabel, []);
      olderByMonth.get(monthLabel)!.push(thread);
    }
    const sortedMonths = [...olderByMonth.keys()].sort((a, b) => b.localeCompare(a));
    for (const month of sortedMonths) {
      sections.push({ key: month, label: month, threads: olderByMonth.get(month)! });
    }
    return sections;
  }, [threads, t]);

  if (!visible) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 20 }]} pointerEvents="box-none">
      <Animated.View style={[s.backdrop, { opacity: backdropAnim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View
        style={[s.sidebar, { paddingTop: insetTop, transform: [{ translateX: sidebarAnim }] }]}
      >
        <View style={s.header}>
          <Text style={s.title}>{t("chat.history", "历史记录")}</Text>
          <TouchableOpacity style={s.iconBtn} onPress={onClose}>
            <XIcon size={16} color={colors.foreground} />
          </TouchableOpacity>
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 20 }}
          showsVerticalScrollIndicator={false}
        >
          {threads.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyText}>{t("chat.noConversations", "暂无对话")}</Text>
            </View>
          ) : (
            groupedThreads.map(({ key, label, threads: sectionThreads }) => {
              if (sectionThreads.length === 0) return null;
              return (
                <View key={key}>
                  <Text style={s.sectionLabel}>{label}</Text>
                  {sectionThreads.map((thread) => {
                    const isActive = thread.id === activeThreadId;
                    const lastMsg =
                      thread.messages.length > 0
                        ? thread.messages[thread.messages.length - 1]
                        : null;
                    const preview = lastMsg?.content?.slice(0, 60) || "";
                    return (
                      <TouchableOpacity
                        key={thread.id}
                        style={[s.item, isActive && s.itemActive]}
                        onPress={() => onSelectThread(thread.id)}
                        activeOpacity={0.7}
                      >
                        <View style={s.itemContent}>
                          <View style={s.itemTitleRow}>
                            <Text
                              style={[s.itemTitle, isActive && s.itemTitleActive]}
                              numberOfLines={1}
                            >
                              {thread.title || t("chat.newChat", "新对话")}
                            </Text>
                            <Text style={s.itemTime}>{formatTime(thread.updatedAt)}</Text>
                          </View>
                          {preview ? (
                            <Text style={s.itemPreview} numberOfLines={1}>
                              {preview}
                            </Text>
                          ) : null}
                        </View>
                        <TouchableOpacity
                          style={s.deleteBtn}
                          onPress={() => onRemoveThread(thread.id)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Trash2Icon size={12} color={colors.mutedForeground} />
                        </TouchableOpacity>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.2)",
    },
    sidebar: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: SIDEBAR_WIDTH,
      backgroundColor: colors.background,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.border,
      paddingHorizontal: 12,
      paddingBottom: 12,
      shadowColor: "#000",
      shadowOffset: { width: 2, height: 0 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 8,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
    },
    title: { fontSize: fs.sm, fontWeight: fw.semibold, color: colors.foreground },
    iconBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    empty: { paddingVertical: 40, alignItems: "center" },
    emptyText: { fontSize: fs.xs, color: colors.mutedForeground },
    sectionLabel: {
      fontSize: 12,
      fontWeight: fw.medium,
      color: colors.mutedForeground,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    item: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      borderRadius: radius.md,
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    itemActive: { backgroundColor: withOpacity(colors.primary, 0.08) },
    itemContent: { flex: 1, gap: 2 },
    itemTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    itemTitle: { fontSize: fs.sm, fontWeight: fw.medium, color: colors.foreground, flex: 1 },
    itemTitleActive: { color: colors.primary },
    itemTime: { fontSize: 11, color: colors.mutedForeground, opacity: 0.5 },
    itemPreview: { fontSize: 13, color: colors.mutedForeground },
    deleteBtn: { marginTop: 2, padding: 4 },
  });
