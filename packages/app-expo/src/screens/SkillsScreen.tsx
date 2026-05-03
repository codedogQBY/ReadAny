import { ChevronLeftIcon, EditIcon, PlusIcon, PuzzleIcon, Trash2Icon } from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { type ThemeColors, fontSize, fontWeight, radius, useColors } from "@/styles/theme";
import { useNavigation } from "@react-navigation/native";
import { builtinSkills } from "@readany/core/ai/skills/builtin-skills";
import { deleteSkill, getSkills, insertSkill, upsertSkill } from "@readany/core/db";
import type { Skill } from "@readany/core/types";
/**
 * SkillsScreen — matching Tauri mobile SkillsPage exactly.
 * Built-in skills with toggle, custom skills with edit/delete, create new skill.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const SKILL_ICONS: Record<string, string> = {
  summarizer: "📝",
  "concept-explainer": "💡",
  "argument-analyzer": "⚖️",
  "character-tracker": "👥",
  "quote-collector": "✨",
  "reading-guide": "📖",
  translator: "🌐",
  "vocabulary-builder": "📚",
};

export default function SkillsScreen() {
  const colors = useColors();
  const s = makeStyles(colors);
  const layout = useResponsiveLayout();
  const nav = useNavigation();
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPrompt, setFormPrompt] = useState("");

  const loadSkills = useCallback(async () => {
    try {
      const dbSkills = await getSkills();
      const mergedSkills = builtinSkills.map((builtin) => {
        const dbSkill = dbSkills.find((s) => s.id === builtin.id);
        return dbSkill
          ? {
              ...builtin,
              description: dbSkill.description,
              enabled: dbSkill.enabled,
              prompt: dbSkill.prompt,
              updatedAt: dbSkill.updatedAt,
            }
          : builtin;
      });
      const customSkills = dbSkills.filter((s) => !s.builtIn);
      setSkills([...mergedSkills, ...customSkills]);
    } catch {
      setSkills(builtinSkills);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleToggle = useCallback(
    async (skillId: string, enabled: boolean) => {
      const skill = skills.find((s) => s.id === skillId);
      if (!skill) return;

      const updatedSkill = { ...skill, enabled, updatedAt: Date.now() };
      try {
        await upsertSkill(updatedSkill);
        setSkills((prev) => prev.map((s) => (s.id === skillId ? updatedSkill : s)));
      } catch (err) {
        console.error("Failed to toggle skill:", err);
      }
    },
    [skills],
  );

  const handleCreateSkill = useCallback(() => {
    setEditingSkill(null);
    setFormName("");
    setFormDescription("");
    setFormPrompt("");
    setEditorOpen(true);
  }, []);

  const handleEditSkill = useCallback((skill: Skill) => {
    setEditingSkill(skill);
    setFormName(skill.name);
    setFormDescription(skill.description);
    setFormPrompt(skill.prompt || "");
    setEditorOpen(true);
  }, []);

  const handleDeleteSkill = useCallback(
    async (skillId: string) => {
      Alert.alert(t("common.confirm", "确认"), t("skills.deleteConfirm", "确定删除此技能？"), [
        { text: t("common.cancel", "取消"), style: "cancel" },
        {
          text: t("common.delete", "删除"),
          style: "destructive",
          onPress: async () => {
            try {
              await deleteSkill(skillId);
              setSkills((prev) => prev.filter((s) => s.id !== skillId));
            } catch (err) {
              console.error("Failed to delete skill:", err);
            }
          },
        },
      ]);
    },
    [t],
  );

  const handleSaveSkill = useCallback(async () => {
    if (!formName.trim()) return;
    try {
      if (editingSkill) {
        const updatedSkill = {
          ...editingSkill,
          name: editingSkill.builtIn ? editingSkill.name : formName.trim(),
          description: formDescription.trim(),
          prompt: formPrompt.trim(),
          updatedAt: Date.now(),
        };
        await upsertSkill(updatedSkill);
        setSkills((prev) =>
          prev.map((s) => (s.id === editingSkill.id ? { ...s, ...updatedSkill } : s)),
        );
      } else {
        const newSkill: Skill = {
          id: `custom-${Date.now()}`,
          name: formName.trim(),
          description: formDescription.trim(),
          prompt: formPrompt.trim(),
          enabled: true,
          builtIn: false,
          parameters: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await insertSkill(newSkill);
        setSkills((prev) => [...prev, newSkill]);
      }
      setEditorOpen(false);
    } catch (err) {
      console.error("Failed to save skill:", err);
    }
  }, [editingSkill, formName, formDescription, formPrompt]);

  const builtInList = skills.filter((s) => s.builtIn);
  const customList = skills.filter((s) => !s.builtIn);
  const useTwoColumnLayout = layout.isTabletLandscape;

  if (loading) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top"]}>
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={colors.mutedForeground} />
        </View>
      </SafeAreaView>
    );
  }

  const builtInSection = (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{t("skills.builtinSkills", "内置技能")}</Text>
      {builtInList.map((skill) => (
        <TouchableOpacity
          key={skill.id}
          style={s.skillCard}
          onPress={() => handleEditSkill(skill)}
          activeOpacity={0.7}
        >
          <Text style={s.skillEmoji}>{SKILL_ICONS[skill.id] || "🔧"}</Text>
          <View style={s.skillInfo}>
            <Text style={s.skillName}>{skill.name}</Text>
            <Text style={s.skillDesc} numberOfLines={1}>
              {skill.description}
            </Text>
          </View>
          <Switch
            value={skill.enabled}
            onValueChange={(v) => handleToggle(skill.id, v)}
            trackColor={{ false: colors.muted, true: colors.primary }}
            thumbColor={colors.card}
          />
        </TouchableOpacity>
      ))}
    </View>
  );

  const customSection = (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{t("skills.customSkills", "自定义技能")}</Text>
      {customList.length === 0 ? (
        <View style={s.customEmpty}>
          <View style={s.customEmptyIcon}>
            <PuzzleIcon size={28} color={colors.mutedForeground} />
          </View>
          <Text style={s.customEmptyText}>{t("skills.noCustomSkills", "暂无自定义技能")}</Text>
          <TouchableOpacity style={s.customEmptyBtn} onPress={handleCreateSkill}>
            <PlusIcon size={16} color={colors.primaryForeground} />
            <Text style={s.customEmptyBtnText}>{t("settings.addSkill", "添加技能")}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        customList.map((skill) => (
          <View key={skill.id} style={s.skillCard}>
            <Text style={s.skillEmoji}>{SKILL_ICONS[skill.id] || "🔧"}</Text>
            <TouchableOpacity style={s.skillInfo} onPress={() => handleEditSkill(skill)}>
              <Text style={s.skillName}>{skill.name}</Text>
              <Text style={s.skillDesc} numberOfLines={1}>
                {skill.description}
              </Text>
            </TouchableOpacity>
            <View style={s.customActions}>
              <TouchableOpacity style={s.iconBtn} onPress={() => handleEditSkill(skill)}>
                <EditIcon size={14} color={colors.mutedForeground} />
              </TouchableOpacity>
              <TouchableOpacity style={s.iconBtn} onPress={() => handleDeleteSkill(skill.id)}>
                <Trash2Icon size={14} color={colors.mutedForeground} />
              </TouchableOpacity>
              <Switch
                value={skill.enabled}
                onValueChange={(v) => handleToggle(skill.id, v)}
                trackColor={{ false: colors.muted, true: colors.primary }}
                thumbColor={colors.card}
              />
            </View>
          </View>
        ))
      )}
    </View>
  );

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top"]}>
      {/* Header */}
      <View style={s.header}>
        <View style={[s.headerInner, { maxWidth: layout.centeredContentWidth }]}>
          <View style={s.headerLeft}>
            <TouchableOpacity
              style={s.backBtn}
              onPress={() => {
                if (nav.canGoBack()) {
                  nav.goBack();
                } else {
                  nav.navigate("Tabs" as never);
                }
              }}
            >
              <ChevronLeftIcon size={20} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={s.headerTitle}>{t("skills.title", "技能")}</Text>
          </View>
          <TouchableOpacity style={s.addBtn} onPress={handleCreateSkill}>
            <PlusIcon size={14} color={colors.foreground} />
            <Text style={s.addBtnText}>{t("settings.addSkill", "添加技能")}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={s.scrollView}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.contentInner, { maxWidth: layout.centeredContentWidth }]}>
          {useTwoColumnLayout ? (
            <View style={s.sectionGrid}>
              <View style={s.sectionColumn}>{builtInSection}</View>
              <View style={s.sectionColumn}>{customSection}</View>
            </View>
          ) : (
            <>
              {builtInSection}
              {customSection}
            </>
          )}
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Skill Editor Modal */}
      <Modal
        visible={editorOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setEditorOpen(false)}
      >
        <Pressable style={s.editorOverlay} onPress={() => setEditorOpen(false)} />
        <View style={[s.editorSheet, layout.isTablet && s.editorSheetTablet]}>
          <View style={s.editorHandle} />
          <Text style={s.editorTitle}>
            {editingSkill ? t("skills.editSkill", "编辑技能") : t("skills.createSkill", "创建技能")}
          </Text>

          <ScrollView style={s.editorContent}>
            <Text style={s.fieldLabel}>{t("skills.name", "名称")} *</Text>
            <TextInput
              style={[s.fieldInput, editingSkill?.builtIn && s.fieldInputDisabled]}
              value={formName}
              onChangeText={setFormName}
              placeholder={t("skills.namePlaceholder", "技能名称")}
              placeholderTextColor={colors.mutedForeground}
              editable={!editingSkill?.builtIn}
            />

            <Text style={s.fieldLabel}>{t("skills.description", "描述")}</Text>
            <TextInput
              style={s.fieldInput}
              value={formDescription}
              onChangeText={setFormDescription}
              placeholder={t("skills.descriptionPlaceholder", "简要描述...")}
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={s.fieldLabel}>{t("skills.prompt", "提示词")}</Text>
            <TextInput
              style={[s.fieldInput, s.fieldTextarea]}
              value={formPrompt}
              onChangeText={setFormPrompt}
              placeholder={t("skills.promptPlaceholder", "输入提示词...")}
              placeholderTextColor={colors.mutedForeground}
              multiline
              textAlignVertical="top"
            />
          </ScrollView>

          <View style={s.editorActions}>
            <TouchableOpacity style={s.editorCancelBtn} onPress={() => setEditorOpen(false)}>
              <Text style={s.editorCancelText}>{t("common.cancel", "取消")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.editorSaveBtn, !formName.trim() && s.editorSaveBtnDisabled]}
              onPress={handleSaveSkill}
              disabled={!formName.trim()}
            >
              <Text style={s.editorSaveText}>{t("common.save", "保存")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
    header: {
      alignItems: "center",
      paddingVertical: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
    },
    headerInner: {
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
    },
    headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
    backBtn: { padding: 4 },
    headerTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    addBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderWidth: 0.5,
      borderColor: colors.border,
      borderRadius: radius.lg,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    addBtnText: { fontSize: fontSize.xs, color: colors.foreground },
    scrollView: { flex: 1 },
    scrollContent: { paddingBottom: 8, alignItems: "center" },
    contentInner: { width: "100%" },
    sectionGrid: { flexDirection: "row", gap: 16, alignItems: "flex-start" },
    sectionColumn: { flex: 1, minWidth: 0 },
    section: { paddingHorizontal: 16, paddingTop: 16 },
    sectionTitle: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 12,
    },
    skillCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 8,
    },
    skillEmoji: { fontSize: 24 },
    skillInfo: { flex: 1, minWidth: 0 },
    skillName: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.foreground },
    skillDesc: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: 2 },
    customActions: { flexDirection: "row", alignItems: "center", gap: 6 },
    iconBtn: { padding: 6 },
    customEmpty: { alignItems: "center", paddingVertical: 32 },
    customEmptyIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    customEmptyText: { fontSize: fontSize.sm, color: colors.mutedForeground, marginBottom: 12 },
    customEmptyBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.primary,
      borderRadius: radius.lg,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    customEmptyBtnText: { fontSize: fontSize.sm, color: colors.primaryForeground },
    // Editor
    editorOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
    editorSheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      maxHeight: "80%",
      paddingBottom: 34,
    },
    editorSheetTablet: {
      width: "100%",
      borderRadius: 20,
      marginBottom: 28,
    },
    editorHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.muted,
      alignSelf: "center",
      marginTop: 12,
      marginBottom: 8,
    },
    editorTitle: {
      fontSize: fontSize.md,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      paddingHorizontal: 20,
      marginBottom: 16,
    },
    editorContent: { paddingHorizontal: 20 },
    fieldLabel: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      marginBottom: 4,
      marginTop: 12,
    },
    fieldInput: {
      height: 36,
      backgroundColor: colors.muted,
      borderRadius: radius.lg,
      paddingHorizontal: 12,
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
    fieldInputDisabled: { opacity: 0.6 },
    fieldTextarea: { height: 120, paddingVertical: 8, textAlignVertical: "top" },
    editorActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 8,
      paddingHorizontal: 20,
      paddingTop: 16,
    },
    editorCancelBtn: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: radius.lg,
      borderWidth: 0.5,
      borderColor: colors.border,
    },
    editorCancelText: { fontSize: fontSize.sm, color: colors.foreground },
    editorSaveBtn: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: radius.lg,
      backgroundColor: colors.primary,
    },
    editorSaveBtnDisabled: { opacity: 0.5 },
    editorSaveText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },
  });
