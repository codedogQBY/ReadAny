/**
 * ChapterTranslationSheet — bottom action-sheet on mobile for whole-chapter translation.
 *
 * Triggered from the Languages toolbar button. Shows as a modal bottom sheet:
 *   idle → language selector + translate button
 *   extracting / translating → progress + cancel
 *   complete → toggle original / translation visibility + clear
 *   error → message + retry + clear
 */

import { CheckIcon, EyeIcon, EyeOffIcon, LanguagesIcon, Trash2Icon } from "@/components/ui/Icon";
import { useSettingsStore } from "@/stores";
import { type ThemeColors, fontSize, useColors } from "@/styles/theme";
import type { ChapterTranslationState } from "@readany/core/hooks";
import type { TranslationTargetLang } from "@readany/core/types/translation";
import { TRANSLATOR_LANGS } from "@readany/core/types/translation";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

interface ChapterTranslationSheetProps {
  visible: boolean;
  onClose: () => void;
  state: ChapterTranslationState;
  onStart: (targetLang?: string) => void;
  onCancel: () => void;
  onToggleOriginalVisible: () => void;
  onToggleTranslationVisible: () => void;
  onReset: () => void;
}

export function ChapterTranslationSheet({
  visible,
  onClose,
  state,
  onStart,
  onCancel,
  onToggleOriginalVisible,
  onToggleTranslationVisible,
  onReset,
}: ChapterTranslationSheetProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const s = makeStyles(colors);
  const defaultLang = useSettingsStore((ss) => ss.translationConfig.targetLang);
  const setTranslationLang = useSettingsStore((ss) => ss.setTranslationLang);
  const [selectedLang, setSelectedLang] = useState<TranslationTargetLang>(defaultLang);
  const [showLangPicker, setShowLangPicker] = useState(false);

  const renderContent = () => {
    // ── idle: language picker + translate ──
    if (state.status === "idle") {
      return (
        <>
          <View style={s.titleRow}>
            <LanguagesIcon size={18} color={colors.foreground} />
            <Text style={s.sheetTitle}>{t("translation.translateChapter")}</Text>
          </View>

          <Pressable style={s.langSelector} onPress={() => setShowLangPicker(true)}>
            <Text style={s.langSelectorLabel}>{t("translation.targetLanguage")}</Text>
            <View style={s.langSelectorValue}>
              <Text style={s.langSelectorText}>{TRANSLATOR_LANGS[selectedLang]}</Text>
              <Text style={s.langChevron}>▾</Text>
            </View>
          </Pressable>

          <Pressable
            style={s.primaryButton}
            onPress={() => {
              setTranslationLang(selectedLang);
              onStart(selectedLang);
            }}
          >
            <Text style={s.primaryButtonText}>{t("translation.translateChapter")}</Text>
          </Pressable>

          {/* Language picker modal */}
          <Modal
            visible={showLangPicker}
            transparent
            animationType="fade"
            onRequestClose={() => setShowLangPicker(false)}
          >
            <Pressable style={s.langModalOverlay} onPress={() => setShowLangPicker(false)}>
              <View style={s.langModalContent}>
                <Text style={s.langModalTitle}>
                  {t("translation.selectLanguage", { defaultValue: "Select Language" })}
                </Text>
                <FlatList
                  data={Object.entries(TRANSLATOR_LANGS) as [TranslationTargetLang, string][]}
                  keyExtractor={([code]) => code}
                  renderItem={({ item: [code, name] }) => (
                    <Pressable
                      style={[
                        s.langOption,
                        code === selectedLang && { backgroundColor: colors.muted },
                      ]}
                      onPress={() => {
                        setSelectedLang(code as TranslationTargetLang);
                        setShowLangPicker(false);
                      }}
                    >
                      <Text
                        style={[
                          s.langOptionText,
                          code === selectedLang && { color: colors.primary },
                        ]}
                      >
                        {name}
                      </Text>
                    </Pressable>
                  )}
                />
              </View>
            </Pressable>
          </Modal>
        </>
      );
    }

    // ── extracting ──
    if (state.status === "extracting") {
      return (
        <View style={s.statusRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={s.statusText}>{t("common.loading")}</Text>
        </View>
      );
    }

    // ── translating: progress + cancel ──
    if (state.status === "translating") {
      const { translatedChars, totalChars } = state.progress;
      const pct = totalChars > 0 ? Math.round((translatedChars / totalChars) * 100) : 0;

      return (
        <>
          <View style={s.statusRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={s.statusText}>
              {t("translation.translatingProgress", {
                count: Math.round(translatedChars / 100),
                total: Math.round(totalChars / 100),
              })}
            </Text>
          </View>
          <View style={s.progressBg}>
            <View style={[s.progressFill, { width: `${pct}%` }]} />
          </View>
          <Pressable style={s.destructiveButton} onPress={onCancel}>
            <Text style={s.destructiveButtonText}>{t("translation.cancelTranslation")}</Text>
          </Pressable>
        </>
      );
    }

    // ── complete: toggle original / translation + clear ──
    if (state.status === "complete") {
      return (
        <>
          <View style={s.titleRow}>
            <CheckIcon size={18} color={colors.primary} />
            <Text style={[s.sheetTitle, { color: colors.primary }]}>
              {t("translation.chapterTranslated")}
            </Text>
          </View>

          <Pressable style={s.langSelector} onPress={() => setShowLangPicker(true)}>
            <Text style={s.langSelectorLabel}>{t("translation.targetLanguage")}</Text>
            <View style={s.langSelectorValue}>
              <Text style={s.langSelectorText}>{TRANSLATOR_LANGS[selectedLang]}</Text>
              <Text style={s.langChevron}>▾</Text>
            </View>
          </Pressable>

          <Pressable
            style={s.primaryButton}
            onPress={() => {
              setTranslationLang(selectedLang);
              onStart(selectedLang);
            }}
          >
            <Text style={s.primaryButtonText}>{t("translation.translateChapter")}</Text>
          </Pressable>

          <View style={s.toggleRow}>
            <Pressable
              style={[s.toggleButton, !state.originalVisible && s.toggleButtonOff]}
              onPress={onToggleOriginalVisible}
            >
              <Text style={[s.toggleLabel, !state.originalVisible && s.toggleLabelOff]}>
                {t("translation.original")}
              </Text>
              {state.originalVisible ? (
                <EyeIcon size={16} color={colors.foreground} />
              ) : (
                <EyeOffIcon size={16} color={colors.mutedForeground} />
              )}
            </Pressable>

            <Pressable
              style={[s.toggleButton, !state.translationVisible && s.toggleButtonOff]}
              onPress={onToggleTranslationVisible}
            >
              <Text style={[s.toggleLabel, !state.translationVisible && s.toggleLabelOff]}>
                {t("translation.translationLabel")}
              </Text>
              {state.translationVisible ? (
                <EyeIcon size={16} color={colors.foreground} />
              ) : (
                <EyeOffIcon size={16} color={colors.mutedForeground} />
              )}
            </Pressable>
          </View>

          <Pressable
            style={s.destructiveButton}
            onPress={() => {
              onReset();
              onClose();
            }}
          >
            <View style={s.buttonRow}>
              <Trash2Icon size={14} color={colors.destructive || "#ef4444"} />
              <Text style={s.destructiveButtonText}>{t("common.remove")}</Text>
            </View>
          </Pressable>

          {/* Language picker modal */}
          <Modal
            visible={showLangPicker}
            transparent
            animationType="fade"
            onRequestClose={() => setShowLangPicker(false)}
          >
            <Pressable style={s.langModalOverlay} onPress={() => setShowLangPicker(false)}>
              <View style={s.langModalContent}>
                <Text style={s.langModalTitle}>
                  {t("translation.selectLanguage", { defaultValue: "Select Language" })}
                </Text>
                <FlatList
                  data={Object.entries(TRANSLATOR_LANGS) as [TranslationTargetLang, string][]}
                  keyExtractor={([code]) => code}
                  renderItem={({ item: [code, name] }) => (
                    <Pressable
                      style={[
                        s.langOption,
                        code === selectedLang && { backgroundColor: colors.muted },
                      ]}
                      onPress={() => {
                        setSelectedLang(code as TranslationTargetLang);
                        setShowLangPicker(false);
                      }}
                    >
                      <Text
                        style={[
                          s.langOptionText,
                          code === selectedLang && { color: colors.primary },
                        ]}
                      >
                        {name}
                      </Text>
                    </Pressable>
                  )}
                />
              </View>
            </Pressable>
          </Modal>
        </>
      );
    }

    // ── error: message + retry + clear ──
    if (state.status === "error") {
      return (
        <>
          <Text
            style={[s.statusText, { color: colors.destructive || "#ef4444", textAlign: "center" }]}
            numberOfLines={2}
          >
            {state.message}
          </Text>
          <Pressable
            style={s.primaryButton}
            onPress={() => {
              setTranslationLang(selectedLang);
              onStart(selectedLang);
            }}
          >
            <Text style={s.primaryButtonText}>{t("common.retry")}</Text>
          </Pressable>
          <Pressable
            style={s.destructiveButton}
            onPress={() => {
              onReset();
              onClose();
            }}
          >
            <View style={s.buttonRow}>
              <Trash2Icon size={14} color={colors.destructive || "#ef4444"} />
              <Text style={s.destructiveButtonText}>{t("common.remove")}</Text>
            </View>
          </Pressable>
        </>
      );
    }

    return null;
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
          {/* Drag handle */}
          <View style={s.handleBar} />

          {renderContent()}

          {/* Close row — only for idle/complete, others have explicit actions */}
          {(state.status === "idle" || state.status === "complete") && (
            <Pressable style={s.closeRow} onPress={onClose}>
              <Text style={s.closeText}>{t("common.close")}</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.35)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: 20,
      paddingBottom: 34, // safe area
      paddingTop: 8,
      gap: 12,
    },
    handleBar: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      alignSelf: "center",
      marginBottom: 4,
    },
    sheetTitle: {
      fontSize: fontSize.base,
      fontWeight: "600",
      color: colors.foreground,
      textAlign: "center",
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },
    buttonRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },

    // Language selector
    langSelector: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: colors.muted,
    },
    langSelectorLabel: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    langSelectorValue: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    langSelectorText: {
      fontSize: fontSize.sm,
      fontWeight: "500",
      color: colors.foreground,
    },
    langChevron: {
      fontSize: 12,
      color: colors.mutedForeground,
    },

    // Buttons
    primaryButton: {
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: colors.primary,
      alignItems: "center",
    },
    primaryButtonText: {
      fontSize: fontSize.sm,
      fontWeight: "600",
      color: "#fff",
    },
    destructiveButton: {
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: colors.muted,
      alignItems: "center",
    },
    destructiveButtonText: {
      fontSize: fontSize.sm,
      color: colors.destructive || "#ef4444",
    },

    // Status
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 4,
    },
    statusText: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    progressBg: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.muted,
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      backgroundColor: colors.primary,
      borderRadius: 3,
    },

    // Toggle buttons for complete state
    toggleRow: {
      flexDirection: "row",
      gap: 10,
    },
    toggleButton: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: colors.muted,
      borderWidth: 1.5,
      borderColor: colors.primary,
    },
    toggleButtonOff: {
      borderColor: colors.border,
      opacity: 0.6,
    },
    toggleLabel: {
      fontSize: fontSize.sm,
      fontWeight: "500",
      color: colors.foreground,
    },
    toggleLabelOff: {
      color: colors.mutedForeground,
    },

    // Close
    closeRow: {
      alignItems: "center",
      paddingVertical: 8,
    },
    closeText: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },

    // Language picker modal (nested)
    langModalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.4)",
      justifyContent: "center",
      alignItems: "center",
    },
    langModalContent: {
      width: 260,
      maxHeight: 400,
      backgroundColor: colors.background,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 4,
    },
    langModalTitle: {
      fontSize: fontSize.sm,
      fontWeight: "600",
      color: colors.foreground,
      textAlign: "center",
      marginBottom: 8,
    },
    langOption: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 8,
    },
    langOptionText: {
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
  });
}
