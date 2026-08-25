import {
  BookOpenIcon,
  ChevronRightIcon,
  CloudIcon,
  GlobeIcon,
  LibraryIcon,
} from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { fontSize, fontWeight, radius, useColors, withOpacity } from "@/styles/theme";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

type PopoverAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

interface WebDavImportSourceSheetProps {
  visible: boolean;
  hasSavedWebDav: boolean;
  anchor: PopoverAnchor | null;
  localImportBusy?: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  onPickLocal: () => void;
  onPickSavedWebDav: () => void;
  onPickTemporaryWebDav: () => void;
  onPickOpds: () => void;
}

export function WebDavImportSourceSheet({
  visible,
  hasSavedWebDav,
  anchor,
  localImportBusy = false,
  onClose,
  onDismiss,
  onPickLocal,
  onPickSavedWebDav,
  onPickTemporaryWebDav,
  onPickOpds,
}: WebDavImportSourceSheetProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const layout = useResponsiveLayout();
  const popoverWidth = Math.min(layout.width - 24, layout.isTablet ? 300 : 248);
  const screenPadding = 12;
  const fallbackAnchor = {
    x: layout.width - screenPadding - 44,
    y: 96,
    width: 44,
    height: 44,
  };
  const activeAnchor = anchor ?? fallbackAnchor;
  const preferredLeft = activeAnchor.x + activeAnchor.width - popoverWidth;
  const popoverLeft = Math.min(
    Math.max(screenPadding, preferredLeft),
    layout.width - popoverWidth - screenPadding,
  );
  const showBelow = activeAnchor.y + activeAnchor.height + 12 + 284 < layout.height - screenPadding;
  const popoverTop = showBelow
    ? activeAnchor.y + activeAnchor.height + 10
    : Math.max(screenPadding, activeAnchor.y - 284);

  const s = useMemo(
    () =>
      StyleSheet.create({
        overlay: {
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.08)",
        },
        sheetWrap: {
          position: "absolute",
          width: popoverWidth,
          left: popoverLeft,
          top: popoverTop,
        },
        sheet: {
          backgroundColor: colors.background,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.92),
          paddingVertical: 6,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.1,
          shadowRadius: 14,
          elevation: 8,
        },
        options: {
          maxHeight: 294,
        },
        optionCard: {
          paddingHorizontal: 14,
          paddingVertical: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        },
        optionDisabled: {
          opacity: 0.56,
        },
        iconWrap: {
          width: 26,
          height: 26,
          borderRadius: radius.md,
          alignItems: "center",
          justifyContent: "center",
        },
        optionText: {
          flex: 1,
          minWidth: 0,
        },
        optionTitle: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        separator: {
          height: StyleSheet.hairlineWidth,
          backgroundColor: withOpacity(colors.border, 0.8),
          marginHorizontal: 14,
        },
      }),
    [colors, popoverLeft, popoverTop, popoverWidth],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.sheetWrap} onPress={(event) => event.stopPropagation()}>
          <View style={s.sheet}>
            <ScrollView style={s.options} bounces={false}>
              <TouchableOpacity
                style={[s.optionCard, localImportBusy && s.optionDisabled]}
                onPress={onPickLocal}
                activeOpacity={0.85}
                disabled={localImportBusy}
              >
                <View style={s.iconWrap}>
                  <BookOpenIcon size={18} color={colors.primary} />
                </View>
                <View style={s.optionText}>
                  <Text style={s.optionTitle}>{t("library.importSourceLocal", "本地文件")}</Text>
                </View>
                <ChevronRightIcon size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
              <View style={s.separator} />

              <TouchableOpacity
                style={[s.optionCard, !hasSavedWebDav && s.optionDisabled]}
                onPress={onPickSavedWebDav}
                activeOpacity={0.85}
              >
                <View style={s.iconWrap}>
                  <CloudIcon size={18} color={colors.primary} />
                </View>
                <View style={s.optionText}>
                  <Text style={s.optionTitle}>
                    {t("library.importSourceSavedWebDav", "我的 WebDAV")}
                  </Text>
                </View>
                <ChevronRightIcon size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
              <View style={s.separator} />

              <TouchableOpacity
                style={s.optionCard}
                onPress={onPickTemporaryWebDav}
                activeOpacity={0.85}
              >
                <View style={s.iconWrap}>
                  <GlobeIcon size={18} color={colors.primary} />
                </View>
                <View style={s.optionText}>
                  <Text style={s.optionTitle}>
                    {t("library.importSourceTemporaryWebDav", "连接其他 WebDAV")}
                  </Text>
                </View>
                <ChevronRightIcon size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
              <View style={s.separator} />

              <TouchableOpacity
                style={s.optionCard}
                onPress={onPickOpds}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t("library.opds.catalogsTitle")}
              >
                <View style={s.iconWrap}>
                  <LibraryIcon size={18} color={colors.primary} />
                </View>
                <View style={s.optionText}>
                  <Text style={s.optionTitle}>{t("library.opds.catalogsTitle")}</Text>
                </View>
                <ChevronRightIcon size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            </ScrollView>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
