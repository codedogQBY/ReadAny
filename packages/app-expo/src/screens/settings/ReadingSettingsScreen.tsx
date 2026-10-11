import { ReaderSettingsPanel } from "@/screens/reader/ReaderSettingsPanel";
import { useSettingsStore } from "@/stores";
import { useColors } from "@/styles/theme";
import type { ReadSettings } from "@readany/core/types";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsHeader } from "./SettingsHeader";

export default function ReadingSettingsScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const readSettings = useSettingsStore((state) => state.readSettings);
  const updateReadSettings = useSettingsStore((state) => state.updateReadSettings);

  const updateSetting = useCallback(
    <K extends keyof ReadSettings>(key: K, value: ReadSettings[K]) => {
      updateReadSettings({ [key]: value } as Partial<ReadSettings>);
    },
    [updateReadSettings],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <SettingsHeader
        title={t("settings.reading_title", "Reading")}
        subtitle={t("settings.realtimeHint")}
      />
      <ReaderSettingsPanel
        embedded
        visible
        readSettings={readSettings}
        onClose={() => undefined}
        onUpdateSetting={updateSetting}
      />
    </SafeAreaView>
  );
}
