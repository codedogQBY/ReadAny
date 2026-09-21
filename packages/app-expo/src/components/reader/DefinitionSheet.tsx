import { XIcon } from "@/components/ui/Icon";
import { useDictionaryStore } from "@/stores";
import { type ThemeColors, fontSize, fontWeight, radius, useColors } from "@/styles/theme";
import type { DictionaryEntry } from "@readany/core/dictionary";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  DefinitionController,
  type DefinitionControllerDependencies,
  type DefinitionState,
} from "./definition-controller";

interface DefinitionSheetProps {
  visible: boolean;
  text: string;
  onClose: () => void;
  onManageDictionaries: () => void;
  /** Injected by tests or an application-level dictionary composition. */
  controller?: DefinitionController;
}

export function DefinitionSheet({
  visible,
  text,
  onClose,
  onManageDictionaries,
  controller: suppliedController,
}: DefinitionSheetProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const s = makeStyles(colors);
  const fallbackController = useRef<DefinitionController | null>(null);
  if (!suppliedController && !fallbackController.current) {
    fallbackController.current = new DefinitionController(defaultDependencies());
  }
  const controller = suppliedController ?? fallbackController.current;
  if (!controller) throw new Error("Definition controller was not initialized");
  const [state, setState] = useState<DefinitionState>(controller.state);

  useEffect(() => controller.subscribe(setState), [controller]);

  useEffect(() => {
    if (visible) {
      void controller.open(text);
    } else {
      controller.close();
    }
  }, [controller, text, visible]);

  const close = () => onClose();
  const manageDictionaries = () => {
    onClose();
    onManageDictionaries();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable
        style={s.backdrop}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel={t("dictionary.close")}
      />
      <View style={[s.container, { paddingBottom: insets.bottom || 16 }]}>
        <View style={s.handle} />
        <View style={s.header}>
          <Text style={s.title}>{t("dictionary.title")}</Text>
          <TouchableOpacity
            style={s.closeButton}
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel={t("dictionary.close")}
          >
            <XIcon size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
        <ScrollView style={s.content} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          {renderState(state, controller, manageDictionaries, s, colors.primary, t)}
        </ScrollView>
      </View>
    </Modal>
  );
}

function renderState(
  state: DefinitionState,
  controller: DefinitionController,
  onManageDictionaries: () => void,
  s: ReturnType<typeof makeStyles>,
  primaryColor: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  switch (state.kind) {
    case "idle":
      return null;
    case "loading":
      return (
        <View style={s.loadingWrap} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={primaryColor} />
          <Text style={s.statusText}>{t("dictionary.loadingDefinition")}</Text>
        </View>
      );
    case "verifying":
      return <Text style={s.statusText}>{t("dictionary.verifying")}</Text>;
    case "unsupported":
      return <Text style={s.statusText}>{t("dictionary.unsupportedSelection")}</Text>;
    case "missing-pack":
      return <PackDownload state={state} controller={controller} s={s} t={t} />;
    case "downloading":
      return <PackDownload state={state} controller={controller} s={s} t={t} />;
    case "no-match":
      return <Text style={s.statusText}>{t("dictionary.noDefinitionFound")}</Text>;
    case "error":
      return (
        <View style={s.errorWrap} accessibilityLiveRegion="polite">
          <Text style={s.errorText}>{t("dictionary.lookupError")}</Text>
          <View style={s.actions}>
            <TouchableOpacity
              style={s.primaryButton}
              onPress={() => void controller.retry()}
              accessibilityRole="button"
              accessibilityLabel={t("dictionary.retryLookup")}
            >
              <Text style={s.primaryButtonText}>{t("dictionary.retry")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.secondaryButton}
              onPress={onManageDictionaries}
              accessibilityRole="button"
              accessibilityLabel={t("dictionary.manageDictionaries")}
            >
              <Text style={s.secondaryButtonText}>{t("dictionary.manageDictionaries")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    case "result":
      return (
        <View style={s.results}>
          <Text style={s.selectedText}>{state.displayText}</Text>
          {state.entries.map((entry) => (
            <EntryView key={entry.id} entry={entry} s={s} />
          ))}
        </View>
      );
  }
}

function EntryView({ entry, s }: { entry: DictionaryEntry; s: ReturnType<typeof makeStyles> }) {
  const forms =
    entry.language === "zh"
      ? [entry.simplified ?? entry.headword, entry.traditional]
      : [entry.headword];
  const uniqueForms = [...new Set(forms.filter((form): form is string => Boolean(form)))];

  return (
    <View style={s.entry}>
      <View style={s.entryHeading}>
        {uniqueForms.map((form) => (
          <Text key={form} style={s.headword}>
            {form}
          </Text>
        ))}
        {entry.pronunciation ? <Text style={s.pronunciation}>{entry.pronunciation}</Text> : null}
      </View>
      {entry.partOfSpeech ? <Text style={s.partOfSpeech}>{entry.partOfSpeech}</Text> : null}
      <View style={s.senses}>
        {entry.senses.map((sense, index) => (
          <Text key={`${sense.order}:${sense.definition}`} style={s.sense}>
            {index + 1}. {sense.definition}
          </Text>
        ))}
      </View>
    </View>
  );
}

function PackDownload({
  state,
  controller,
  s,
  t,
}: {
  state:
    | Extract<DefinitionState, { kind: "missing-pack" }>
    | Extract<DefinitionState, { kind: "downloading" }>;
  controller: DefinitionController;
  s: ReturnType<typeof makeStyles>;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const downloading = state.kind === "downloading";
  const descriptor = state.kind === "missing-pack" ? state.descriptor : undefined;
  const language = t(`dictionary.${state.language === "en" ? "english" : "chinese"}`);
  const progress = downloading ? Math.round(state.progress * 100) : null;
  return (
    <View style={s.downloadWrap} accessibilityLiveRegion="polite">
      <Text style={s.statusText}>
        {downloading
          ? t("dictionary.downloadingDefinition", { language, progress })
          : t("dictionary.downloadDefinition", {
              language,
              size: formatBytes(descriptor?.sizeBytes ?? 0),
            })}
      </Text>
      <TouchableOpacity
        style={[s.primaryButton, downloading && s.buttonDisabled]}
        disabled={downloading}
        onPress={() => void controller.download()}
        accessibilityRole="button"
        accessibilityLabel={
          downloading
            ? t("dictionary.downloadingAccessibility", { language })
            : t("dictionary.downloadAccessibility", { language })
        }
      >
        <Text style={s.primaryButtonText}>{t("dictionary.download")}</Text>
      </TouchableOpacity>
    </View>
  );
}

function defaultDependencies(): DefinitionControllerDependencies {
  return {
    lookup: (text) => useDictionaryStore.getState().lookup(text),
    install: async (descriptor, onProgress, onVerifying) => {
      const unsubscribe = useDictionaryStore.subscribe((state) => {
        const status = state.packs[descriptor.language];
        if (status.state === "downloading") onProgress(status.progress);
        if (status.state === "verifying") onVerifying?.();
      });
      onProgress(0);
      try {
        await useDictionaryStore.getState().install(descriptor.language);
      } finally {
        unsubscribe();
      }
    },
    getDescriptor: (language) => useDictionaryStore.getState().manifest?.packs[language],
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.3)",
    },
    container: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      maxHeight: "60%",
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
    },
    handle: {
      width: 40,
      height: 4,
      marginTop: 8,
      alignSelf: "center",
      borderRadius: 2,
      backgroundColor: colors.muted,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    closeButton: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.full,
    },
    content: {
      padding: 16,
    },
    loadingWrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 16,
    },
    statusText: {
      fontSize: fontSize.sm,
      lineHeight: 20,
      color: colors.mutedForeground,
    },
    downloadWrap: {
      gap: 12,
      paddingVertical: 16,
    },
    errorWrap: {
      gap: 12,
      paddingVertical: 16,
    },
    errorText: {
      fontSize: fontSize.sm,
      lineHeight: 20,
      color: colors.destructive,
    },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    primaryButton: {
      alignSelf: "flex-start",
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.lg,
      backgroundColor: colors.primary,
    },
    primaryButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },
    secondaryButton: {
      alignSelf: "flex-start",
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      backgroundColor: colors.card,
    },
    secondaryButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    buttonDisabled: {
      opacity: 0.55,
    },
    results: {
      gap: 12,
    },
    selectedText: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
    },
    entry: {
      gap: 8,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    entryHeading: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "baseline",
      gap: 8,
    },
    headword: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    pronunciation: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    partOfSpeech: {
      alignSelf: "flex-start",
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.lg,
      overflow: "hidden",
      fontSize: fontSize.xs,
      color: colors.primary,
      backgroundColor: colors.muted,
    },
    senses: {
      gap: 6,
    },
    sense: {
      fontSize: fontSize.base,
      lineHeight: 23,
      color: colors.foreground,
    },
  });
