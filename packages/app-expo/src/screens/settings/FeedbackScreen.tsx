import { KeyboardAwareScrollView } from "@/components/ui/KeyboardAwareScrollView";
import type { RootStackParamList } from "@/navigation/RootNavigator";
/**
 * FeedbackScreen — Submit bug reports / feature requests and track history.
 * Submissions are sent to a Cloudflare Worker that creates GitHub Issues.
 */
import { type ThemeColors, spacing, useColors } from "@/styles/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  collectDeviceInfo,
  collectLogs,
  getFeedbackHistory,
  getRemainingSubmissions,
  getUnreadFeedbackCount,
  markFeedbackReplySeen,
  refreshFeedbackStatus,
  submitFeedback,
} from "@readany/core/feedback";
import type { DeviceInfo, FeedbackRecord, FeedbackType } from "@readany/core/feedback";
import Constants from "expo-constants";
import type { TFunction } from "i18next";
import { Bug, Check, Lightbulb, MessageSquare } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsHeader } from "./SettingsHeader";

const FEEDBACK_TYPES: {
  key: FeedbackType;
  labelKey: string;
  fallback: string;
  Icon: LucideIcon;
}[] = [
  { key: "bug", labelKey: "feedback.typeBug", fallback: "Bug", Icon: Bug },
  { key: "feature", labelKey: "feedback.typeFeature", fallback: "建议", Icon: Lightbulb },
  { key: "other", labelKey: "feedback.typeOther", fallback: "其他", Icon: MessageSquare },
];

export default function FeedbackScreen() {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const [activeTab, setActiveTab] = useState<"submit" | "history">("submit");
  const [hasUnread, setHasUnread] = useState(false);
  const autoSwitchedRef = useRef(false);

  const recomputeUnread = useCallback(async () => {
    try {
      const count = await getUnreadFeedbackCount();
      setHasUnread(count > 0);
    } catch {
      // ignore — non-fatal
    }
  }, []);

  useEffect(() => {
    recomputeUnread();
  }, [recomputeUnread]);

  // Auto-switch to history tab once when unread replies exist
  useEffect(() => {
    if (hasUnread && !autoSwitchedRef.current) {
      setActiveTab("history");
      autoSwitchedRef.current = true;
    }
  }, [hasUnread]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top"]}
    >
      <SettingsHeader title={t("feedback.title", "反馈建议")} />

      {/* Tab bar */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "submit" && { borderBottomColor: colors.primary }]}
          onPress={() => setActiveTab("submit")}
        >
          <Text
            style={[
              styles.tabText,
              { color: activeTab === "submit" ? colors.primary : colors.mutedForeground },
            ]}
          >
            {t("feedback.submitTab", "提交反馈")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "history" && { borderBottomColor: colors.primary }]}
          onPress={() => setActiveTab("history")}
        >
          <View style={styles.tabLabelRow}>
            <Text
              style={[
                styles.tabText,
                { color: activeTab === "history" ? colors.primary : colors.mutedForeground },
              ]}
            >
              {t("feedback.historyTab", "我的反馈")}
            </Text>
            {hasUnread && (
              <View style={[styles.tabDot, { backgroundColor: colors.destructive }]} />
            )}
          </View>
        </TouchableOpacity>
      </View>

      {activeTab === "submit" ? (
        <SubmitTab colors={colors} t={t} locale={i18n.language} />
      ) : (
        <HistoryTab colors={colors} t={t} onUnreadChange={recomputeUnread} />
      )}
    </SafeAreaView>
  );
}

interface FeedbackTabProps {
  colors: ThemeColors;
  t: TFunction;
}

function SubmitTab({ colors, t, locale }: FeedbackTabProps & { locale: string }) {
  const [type, setType] = useState<FeedbackType>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [includeLogs, setIncludeLogs] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const remaining = getRemainingSubmissions();

  const deviceInfo: DeviceInfo = useMemo(
    () =>
      collectDeviceInfo({
        platform: Platform.OS as DeviceInfo["platform"],
        osVersion: `${Platform.OS} ${Platform.Version}`,
        appVersion: Constants.expoConfig?.version ?? "unknown",
        locale,
      }),
    [locale],
  );

  const canSubmit = title.trim().length > 0 && description.trim().length > 0 && remaining > 0;
  const submitBackgroundColor = canSubmit ? colors.primary : colors.muted;
  const submitForegroundColor = canSubmit ? colors.primaryForeground : colors.mutedForeground;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const logs = includeLogs ? await collectLogs() : undefined;
      const result = await submitFeedback({
        type,
        title: title.trim(),
        description: description.trim(),
        includeLogs,
        deviceInfo,
        logs,
      });
      Alert.alert(
        t("feedback.submitSuccess", "提交成功"),
        t("feedback.submitSuccessDesc", "感谢你的反馈！Issue #{{number}} 已创建。", {
          number: result.issueNumber,
        }),
        [{ text: t("common.ok", "好的") }],
      );
      setTitle("");
      setDescription("");
      setIncludeLogs(false);
    } catch (err) {
      Alert.alert(
        t("feedback.submitFailed", "提交失败"),
        err instanceof Error
          ? err.message
          : t("feedback.submitFailedUnknown", "提交失败，请稍后重试"),
      );
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, submitting, type, title, description, includeLogs, deviceInfo, t]);

  return (
    <KeyboardAwareScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.formContent}
      bottomOffset={spacing.xxl * 3}
      extraKeyboardSpace={spacing.xxl * 2}
      contentBottomInset={spacing.xxl * 3}
    >
        <View style={[styles.introBlock, { borderBottomColor: colors.border }]}>
          <Text style={[styles.introTitle, { color: colors.foreground }]}>
            {t("feedback.title", "反馈建议")}
          </Text>
          <Text style={[styles.introText, { color: colors.mutedForeground }]}>
            {t("feedback.desc", "提交 bug 报告或功能建议，我们会尽快处理")}
          </Text>
        </View>

        <Text style={[styles.label, { color: colors.foreground }]}>
          {t("feedback.type", "类型")}
        </Text>
        <View style={styles.typeRow}>
          {FEEDBACK_TYPES.map((ft) => (
            <TouchableOpacity
              key={ft.key}
              style={[
                styles.typeBtn,
                { borderColor: type === ft.key ? colors.primary : colors.border },
                type === ft.key && { backgroundColor: `${colors.primary}15` },
              ]}
              onPress={() => setType(ft.key)}
            >
              <ft.Icon size={14} color={type === ft.key ? colors.primary : colors.foreground} />
              <Text
                style={[
                  styles.typeBtnText,
                  { color: type === ft.key ? colors.primary : colors.foreground },
                ]}
              >
                {t(ft.labelKey, ft.fallback)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Title */}
        <Text style={[styles.label, { color: colors.foreground }]}>
          {t("feedback.titleLabel", "标题")} *
        </Text>
        <TextInput
          style={[
            styles.input,
            { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card },
          ]}
          placeholder={t("feedback.titlePlaceholder", "简要描述问题或建议")}
          placeholderTextColor={colors.mutedForeground}
          value={title}
          onChangeText={setTitle}
          maxLength={100}
        />

        {/* Description */}
        <Text style={[styles.label, { color: colors.foreground }]}>
          {t("feedback.descLabel", "详细描述")} *
        </Text>
        <TextInput
          style={[
            styles.textArea,
            { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card },
          ]}
          placeholder={t("feedback.descPlaceholder", "请详细描述你遇到的问题或建议...")}
          placeholderTextColor={colors.mutedForeground}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
        />

        <View
          style={[styles.logPanel, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <TouchableOpacity
            style={styles.checkRow}
            onPress={() => setIncludeLogs((checked) => !checked)}
            activeOpacity={0.75}
          >
            <View
              style={[
                styles.checkbox,
                {
                  borderColor: includeLogs ? colors.primary : colors.border,
                  backgroundColor: includeLogs ? colors.primary : colors.background,
                },
              ]}
            >
              {includeLogs && <Check size={13} color={colors.primaryForeground} strokeWidth={3} />}
            </View>
            <Text style={[styles.logTitle, { color: colors.foreground }]}>
              {t("feedback.uploadLogs", "上传应用日志")}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            {t("feedback.logsHint", "仅在勾选时附带最近 1 小时诊断日志，帮助定位问题。")}
          </Text>
        </View>

        <View style={[styles.deviceInfoBox, { backgroundColor: colors.muted }]}>
          <Text style={[styles.deviceInfoText, { color: colors.mutedForeground }]}>
            {t("feedback.deviceInfo", "{{platform}} · v{{version}} · {{locale}}", {
              platform: `${deviceInfo.platform} ${deviceInfo.osVersion}`,
              version: deviceInfo.appVersion,
              locale: deviceInfo.locale,
            })}
          </Text>
        </View>

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: submitBackgroundColor }]}
          onPress={handleSubmit}
          disabled={!canSubmit || submitting}
          activeOpacity={0.8}
        >
          {submitting ? (
            <ActivityIndicator color={submitForegroundColor} size="small" />
          ) : (
            <Text style={[styles.submitBtnText, { color: submitForegroundColor }]}>
              {t("feedback.submit", "提交反馈")}
            </Text>
          )}
        </TouchableOpacity>
        <Text style={[styles.remainingText, { color: colors.mutedForeground }]}>
          {t("feedback.remaining", "今日还可提交 {{count}} 次", { count: remaining })}
        </Text>
    </KeyboardAwareScrollView>
  );
}

// ─── History Tab ────────────────────────────────────────────────────────────

function HistoryTab({
  colors,
  t,
  onUnreadChange,
}: FeedbackTabProps & { onUnreadChange?: () => void }) {
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const handleOpenIssue = useCallback(
    async (item: FeedbackRecord) => {
      if (item.hasNewReply) {
        setRecords((current) =>
          current.map((record) =>
            record.id === item.id ? { ...record, hasNewReply: false } : record,
          ),
        );
        await markFeedbackReplySeen(item.issueNumber).catch(() => {});
        onUnreadChange?.();
      }
      navigation.navigate("FeedbackDetail", { issueNumber: item.issueNumber, title: item.title });
    },
    [navigation, onUnreadChange],
  );

  useEffect(() => {
    async function loadRecords() {
      const history = await getFeedbackHistory();
      setRecords(history);
      if (history.length === 0) return;

      await refreshFeedbackStatus(history.map((record) => record.issueNumber));
      setRecords(await getFeedbackHistory());
      onUnreadChange?.();
    }

    loadRecords()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [onUnreadChange]);

  if (loading) {
    return (
      <View style={styles.emptyState}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (records.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          {t("feedback.noHistory", "暂无反馈记录")}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={records}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: 16 }}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={[styles.historyItem, { borderBottomColor: colors.border }]}
          onPress={() => handleOpenIssue(item)}
          activeOpacity={0.7}
        >
          <View style={styles.historyLeft}>
            <View style={styles.historyTitleRow}>
              {item.hasNewReply && (
                <View style={[styles.unreadDot, { backgroundColor: colors.destructive }]} />
              )}
              <Text
                style={[styles.historyTitle, { color: colors.foreground, flex: 1 }]}
                numberOfLines={1}
              >
                {item.title}
              </Text>
            </View>
            <Text style={[styles.historyMeta, { color: colors.mutedForeground }]}>
              #{item.issueNumber} · {new Date(item.createdAt).toLocaleDateString()}
            </Text>
            {item.hasNewReply && (
              <Text style={[styles.newReplyText, { color: colors.amber }]}>
                {t("feedback.newReply", "有新回复")}
              </Text>
            )}
          </View>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor:
                  item.status === "open" ? `${colors.primary}20` : `${colors.mutedForeground}20`,
              },
            ]}
          >
            <Text
              style={[
                styles.statusText,
                { color: item.status === "open" ? colors.primary : colors.mutedForeground },
              ]}
            >
              {item.status === "open"
                ? t("feedback.statusOpen", "处理中")
                : t("feedback.statusClosed", "已关闭")}
            </Text>
          </View>
        </TouchableOpacity>
      )}
    />
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabText: { fontSize: 14, fontWeight: "500" },
  tabLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  tabDot: { width: 6, height: 6, borderRadius: 3 },
  scrollView: { flex: 1 },
  formContent: { padding: 16, gap: 4 },
  introBlock: {
    paddingBottom: 14,
    marginBottom: 4,
    borderBottomWidth: 0.5,
  },
  introTitle: { fontSize: 15, fontWeight: "600" },
  introText: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  label: { fontSize: 13, fontWeight: "500", marginTop: 12, marginBottom: 6 },
  typeRow: { flexDirection: "row", gap: 8 },
  typeBtn: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  typeBtnText: { fontSize: 13, fontWeight: "500" },
  input: {
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  textArea: {
    minHeight: 100,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  logPanel: {
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  logTitle: { fontSize: 13, fontWeight: "500" },
  hint: { fontSize: 11, marginTop: 4 },
  deviceInfoBox: {
    marginTop: 12,
    padding: 10,
    borderRadius: 6,
  },
  deviceInfoText: { fontSize: 11 },
  submitBtn: {
    marginTop: 20,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  submitBtnText: { fontSize: 15, fontWeight: "600" },
  remainingText: { fontSize: 11, textAlign: "center", marginTop: 8 },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyText: { fontSize: 14 },
  historyItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  historyLeft: { flex: 1, marginRight: 12 },
  historyTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  unreadDot: { width: 6, height: 6, borderRadius: 3 },
  historyTitle: { fontSize: 14, fontWeight: "500" },
  historyMeta: { fontSize: 11, marginTop: 3 },
  newReplyText: { fontSize: 11, marginTop: 3, fontWeight: "500" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: "500" },
});
