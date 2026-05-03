/**
 * ReaderSettingsPanel — bottom-sheet modal for reading display settings.
 */
import { XIcon } from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { useColors } from "@/styles/theme";
import type { ReadSettings } from "@readany/core/types";
import { Modal, Pressable, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { makeStyles } from "./reader-styles";
import { useFontStore } from "@readany/core/stores";

interface Props {
  visible: boolean;
  readSettings: ReadSettings;
  onClose: () => void;
  onUpdateSetting: <K extends keyof ReadSettings>(key: K, value: ReadSettings[K]) => void;
}

export function ReaderSettingsPanel({ visible, readSettings, onClose, onUpdateSetting }: Props) {
  const colors = useColors();
  const s = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const { t } = useTranslation();

  const customFonts = useFontStore((s) => s.fonts);
  const selectedFontId = useFontStore((s) => s.selectedFontId);
  const setSelectedFont = useFontStore((s) => s.setSelectedFont);

  const {
    fontSize: settingFontSize,
    lineHeight: settingLineHeight,
    paragraphSpacing: settingParagraphSpacing,
    pageMargin: settingPageMargin,
    viewMode: settingViewMode,
    showTopTitleProgress,
    showBottomTimeBattery,
  } = readSettings;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={s.modalBackdrop} onPress={onClose} />
      <View
        style={[
          s.bottomSheet,
          { paddingBottom: insets.bottom || 16 },
          layout.isTablet && {
            width: "100%",
          },
        ]}
      >
        <View style={s.sheetHeader}>
          <Text style={s.sheetTitle}>{t("reader.settings", "阅读设置")}</Text>
          <TouchableOpacity onPress={onClose}>
            <XIcon size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Font Size */}
          <View style={s.settingRow}>
            <Text style={s.settingLabel}>{t("reader.fontSize", "字号")}</Text>
            <View style={s.settingControl}>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => onUpdateSetting("fontSize", Math.max(12, settingFontSize - 1))}
              >
                <Text style={s.stepBtnText}>A-</Text>
              </TouchableOpacity>
              <Text style={s.settingValue}>{settingFontSize}</Text>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => onUpdateSetting("fontSize", Math.min(32, settingFontSize + 1))}
              >
                <Text style={s.stepBtnText}>A+</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* Line Height */}
          <View style={s.settingRow}>
            <Text style={s.settingLabel}>{t("reader.lineHeight", "行高")}</Text>
            <View style={s.settingControl}>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() =>
                  onUpdateSetting(
                    "lineHeight",
                    Math.round(Math.max(1.2, settingLineHeight - 0.1) * 10) / 10,
                  )
                }
              >
                <Text style={s.stepBtnText}>-</Text>
              </TouchableOpacity>
              <Text style={s.settingValue}>{settingLineHeight.toFixed(1)}</Text>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() =>
                  onUpdateSetting(
                    "lineHeight",
                    Math.round(Math.min(2.5, settingLineHeight + 0.1) * 10) / 10,
                  )
                }
              >
                <Text style={s.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* Paragraph Spacing */}
          <View style={s.settingRow}>
            <Text style={s.settingLabel}>{t("reader.paragraphSpacing", "段间距")}</Text>
            <View style={s.settingControl}>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() =>
                  onUpdateSetting("paragraphSpacing", Math.max(0, settingParagraphSpacing - 2))
                }
              >
                <Text style={s.stepBtnText}>-</Text>
              </TouchableOpacity>
              <Text style={s.settingValue}>{settingParagraphSpacing}</Text>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() =>
                  onUpdateSetting("paragraphSpacing", Math.min(24, settingParagraphSpacing + 2))
                }
              >
                <Text style={s.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* Page Margin */}
          <View style={s.settingRow}>
            <Text style={s.settingLabel}>{t("reader.pageMargin", "页边距")}</Text>
            <View style={s.settingControl}>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => onUpdateSetting("pageMargin", Math.max(0, settingPageMargin - 4))}
              >
                <Text style={s.stepBtnText}>-</Text>
              </TouchableOpacity>
              <Text style={s.settingValue}>{settingPageMargin}</Text>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => onUpdateSetting("pageMargin", Math.min(48, settingPageMargin + 4))}
              >
                <Text style={s.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* Font */}
          <View style={s.settingRow}>
            <Text style={s.settingLabel}>{t("fonts.title", "字体")}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.themeScroll}>
              <View style={s.themeRow}>
                <TouchableOpacity
                  style={[s.themeBtn, !selectedFontId && s.themeBtnActive]}
                  onPress={() => setSelectedFont(null)}
                >
                  <Text style={[s.themeBtnText, !selectedFontId && s.themeBtnTextActive]}>
                    {t("fonts.systemDefault", "系统默认")}
                  </Text>
                </TouchableOpacity>
                {customFonts.map((font) => (
                  <TouchableOpacity
                    key={font.id}
                    style={[s.themeBtn, selectedFontId === font.id && s.themeBtnActive]}
                    onPress={() => setSelectedFont(font.id)}
                  >
                    <Text style={[s.themeBtnText, selectedFontId === font.id && s.themeBtnTextActive]}>
                      {font.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
          {/* View Mode */}
          <View style={s.settingRow}>
            <Text style={s.settingLabel}>{t("reader.viewMode", "阅读模式")}</Text>
            <View style={s.viewModeRow}>
              <TouchableOpacity
                style={[s.viewModeBtn, settingViewMode === "paginated" && s.viewModeBtnActive]}
                onPress={() => onUpdateSetting("viewMode", "paginated")}
              >
                <Text
                  style={[s.viewModeBtnText, settingViewMode === "paginated" && s.viewModeBtnTextActive]}
                >
                  {t("reader.paginated", "翻页")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.viewModeBtn, settingViewMode === "scroll" && s.viewModeBtnActive]}
                onPress={() => onUpdateSetting("viewMode", "scroll")}
              >
                <Text
                  style={[s.viewModeBtnText, settingViewMode === "scroll" && s.viewModeBtnTextActive]}
                >
                  {t("reader.scrollMode", "滚动")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={s.settingRow}>
            <Text style={s.settingLabel}>{t("settings.showTopTitleProgress")}</Text>
            <TouchableOpacity
              style={[s.settingToggleBtn, showTopTitleProgress !== false && s.settingToggleBtnActive]}
              onPress={() => onUpdateSetting("showTopTitleProgress", !(showTopTitleProgress !== false))}
            >
              <Text style={[s.settingToggleText, showTopTitleProgress !== false && s.settingToggleTextActive]}>
                {showTopTitleProgress !== false ? t("settings.enabled") : t("settings.disabled")}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={s.settingRow}>
            <Text style={s.settingLabel}>{t("settings.showBottomTimeBattery")}</Text>
            <TouchableOpacity
              style={[s.settingToggleBtn, showBottomTimeBattery !== false && s.settingToggleBtnActive]}
              onPress={() => onUpdateSetting("showBottomTimeBattery", !(showBottomTimeBattery !== false))}
            >
              <Text style={[s.settingToggleText, showBottomTimeBattery !== false && s.settingToggleTextActive]}>
                {showBottomTimeBattery !== false ? t("settings.enabled") : t("settings.disabled")}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
