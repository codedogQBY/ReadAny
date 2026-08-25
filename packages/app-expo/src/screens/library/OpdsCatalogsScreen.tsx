import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EditIcon,
  EyeOffIcon,
  GlobeIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { fontSize, fontWeight, radius, useColors, withOpacity } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { OpdsCatalog } from "@readany/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { OpdsCatalogFormSheet } from "./OpdsCatalogFormSheet";
import { opdsMobileRuntime } from "./opds-mobile-runtime";
import { createOpdsBrowserRouteParams } from "./opds-view-state";

type Props = NativeStackScreenProps<RootStackParamList, "OpdsCatalogs">;

export function OpdsCatalogsScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const layout = useResponsiveLayout();
  const store = useMemo(() => opdsMobileRuntime.getCatalogStore(), []);
  const [catalogs, setCatalogs] = useState<OpdsCatalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<OpdsCatalog>();
  const [busyId, setBusyId] = useState<string>();

  const syncCatalogs = useCallback(
    () => setCatalogs(store.listCatalogs({ includeHidden: true })),
    [store],
  );

  useEffect(() => {
    let active = true;
    void opdsMobileRuntime
      .ensureCatalogsLoaded()
      .then(() => {
        if (!active) return;
        syncCatalogs();
        setError(undefined);
      })
      .catch(() => {
        if (active) {
          setError(t("library.opds.catalogsLoadFailed"));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [syncCatalogs, t]);

  useEffect(() => {
    const editCatalogId = route.params?.editCatalogId;
    if (!editCatalogId || loading) return;
    const catalog = store.getCatalog(editCatalogId);
    if (catalog && !catalog.builtIn) {
      setEditing(catalog);
      setFormOpen(true);
      navigation.setParams({ editCatalogId: undefined });
    }
  }, [loading, navigation, route.params?.editCatalogId, store]);

  const visibleCatalogs = catalogs.filter((catalog) => !catalog.hidden);
  const hiddenBuiltIns = catalogs.filter((catalog) => catalog.builtIn && catalog.hidden);

  const s = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        header: {
          paddingHorizontal: layout.horizontalPadding,
          paddingTop: 12,
          paddingBottom: 12,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: withOpacity(colors.border, 0.9),
          alignItems: "center",
        },
        headerInner: {
          width: "100%",
          maxWidth: layout.centeredContentWidth,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        },
        iconButton: {
          width: 44,
          height: 44,
          borderRadius: radius.full,
          backgroundColor: colors.card,
          alignItems: "center",
          justifyContent: "center",
        },
        titleWrap: { flex: 1, minWidth: 0 },
        title: { fontSize: fontSize.xl, fontWeight: fontWeight.semibold, color: colors.foreground },
        subtitle: { marginTop: 2, fontSize: fontSize.sm, color: colors.mutedForeground },
        scrollContent: {
          width: "100%",
          maxWidth: layout.centeredContentWidth,
          alignSelf: "center",
          paddingHorizontal: layout.horizontalPadding,
          paddingTop: 18,
          paddingBottom: 32,
          gap: 18,
        },
        intro: {
          padding: 16,
          borderRadius: radius.xxl,
          backgroundColor: withOpacity(colors.primary, 0.07),
          borderWidth: 1,
          borderColor: withOpacity(colors.primary, 0.12),
        },
        introEyebrow: {
          fontSize: fontSize.xs,
          fontWeight: fontWeight.semibold,
          color: colors.primary,
          textTransform: "uppercase",
          letterSpacing: 0.8,
        },
        introText: {
          marginTop: 6,
          fontSize: fontSize.sm,
          lineHeight: 21,
          color: colors.foreground,
        },
        section: { gap: 10 },
        sectionTitle: {
          fontSize: fontSize.xs,
          fontWeight: fontWeight.semibold,
          color: colors.mutedForeground,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          paddingHorizontal: 2,
        },
        card: {
          borderRadius: radius.xxl,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.92),
          backgroundColor: colors.card,
          overflow: "hidden",
        },
        cardMain: {
          minHeight: 76,
          paddingHorizontal: 14,
          paddingVertical: 13,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        },
        catalogIcon: {
          width: 42,
          height: 42,
          borderRadius: 15,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: withOpacity(colors.primary, 0.09),
        },
        catalogCopy: { flex: 1, minWidth: 0 },
        nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
        catalogName: {
          flexShrink: 1,
          fontSize: fontSize.base,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        badge: {
          borderRadius: radius.full,
          paddingHorizontal: 7,
          paddingVertical: 3,
          backgroundColor: colors.muted,
        },
        badgeText: { fontSize: 10, fontWeight: fontWeight.semibold, color: colors.mutedForeground },
        catalogUrl: { marginTop: 4, fontSize: fontSize.xs, color: colors.mutedForeground },
        status: { marginTop: 4, fontSize: fontSize.xs, color: colors.mutedForeground },
        disabledCard: { opacity: 0.62 },
        actions: {
          minHeight: 48,
          paddingHorizontal: 10,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: withOpacity(colors.border, 0.86),
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 4,
        },
        action: {
          minWidth: 44,
          minHeight: 44,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.lg,
        },
        switchLabel: {
          marginRight: "auto",
          paddingLeft: 4,
          fontSize: fontSize.xs,
          color: colors.mutedForeground,
        },
        hiddenCard: {
          minHeight: 58,
          paddingHorizontal: 14,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.8),
          backgroundColor: withOpacity(colors.card, 0.72),
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        },
        hiddenName: { flex: 1, fontSize: fontSize.sm, color: colors.foreground },
        restoreText: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.medium,
          color: colors.primary,
        },
        state: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
        stateTitle: {
          marginTop: 14,
          fontSize: fontSize.lg,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        stateText: {
          marginTop: 6,
          fontSize: fontSize.sm,
          lineHeight: 21,
          textAlign: "center",
          color: colors.mutedForeground,
        },
      }),
    [colors, layout.centeredContentWidth, layout.horizontalPadding],
  );

  const mutate = async (catalogId: string, operation: () => Promise<unknown>) => {
    setBusyId(catalogId);
    setError(undefined);
    try {
      await operation();
      syncCatalogs();
    } catch {
      setError(t("library.opds.catalogActionFailed"));
    } finally {
      setBusyId(undefined);
    }
  };

  const confirmDelete = (catalog: OpdsCatalog) => {
    Alert.alert(t("library.opds.deleteTitle"), t("library.opds.deleteDescription"), [
      { text: t("library.opds.cancel"), style: "cancel" },
      {
        text: t("library.opds.delete"),
        style: "destructive",
        onPress: () => void mutate(catalog.id, () => store.removeCatalog(catalog.id)),
      },
    ]);
  };

  const authenticationLabel = (catalog: OpdsCatalog) => {
    if (catalog.auth === "anonymous") {
      return t("library.opds.authAnonymous");
    }
    if (catalog.passwordStorage === "persistent") {
      return t("library.opds.authSecure");
    }
    if (catalog.passwordStorage === "session-only") {
      return t("library.opds.authSession");
    }
    return t("library.opds.authMissing");
  };

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.state}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.stateTitle}>{t("library.opds.loadingCatalogs")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <View style={s.headerInner}>
          <TouchableOpacity
            style={s.iconButton}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel={t("library.opds.back")}
          >
            <ChevronLeftIcon size={20} color={colors.foreground} />
          </TouchableOpacity>
          <View style={s.titleWrap}>
            <Text style={s.title}>{t("library.opds.catalogsTitle")}</Text>
            <Text style={s.subtitle}>{t("library.opds.catalogsSubtitle")}</Text>
          </View>
          <TouchableOpacity
            style={s.iconButton}
            onPress={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={t("library.opds.form.addTitle")}
          >
            <PlusIcon size={20} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={s.intro}>
          <Text style={s.introEyebrow}>{t("library.opds.readerEyebrow")}</Text>
          <Text style={s.introText}>{t("library.opds.readerIntro")}</Text>
        </View>

        {error ? (
          <View style={s.intro} accessibilityRole="alert">
            <Text style={s.introText}>{error}</Text>
          </View>
        ) : null}

        <View style={s.section}>
          <Text style={s.sectionTitle}>{t("library.opds.available")}</Text>
          {visibleCatalogs.map((catalog) => {
            const busy = busyId === catalog.id;
            return (
              <View key={catalog.id} style={[s.card, !catalog.enabled && s.disabledCard]}>
                <TouchableOpacity
                  style={s.cardMain}
                  disabled={!catalog.enabled || busy}
                  onPress={() =>
                    navigation.navigate("OpdsBrowser", createOpdsBrowserRouteParams(catalog.id))
                  }
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !catalog.enabled || busy }}
                  accessibilityLabel={t("library.opds.browseCatalog", {
                    name: catalog.name,
                  })}
                >
                  <View style={s.catalogIcon}>
                    {busy ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <GlobeIcon size={19} color={colors.primary} />
                    )}
                  </View>
                  <View style={s.catalogCopy}>
                    <View style={s.nameRow}>
                      <Text style={s.catalogName} numberOfLines={1}>
                        {catalog.name}
                      </Text>
                      {catalog.builtIn ? (
                        <View style={s.badge}>
                          <Text style={s.badgeText}>{t("library.opds.builtIn")}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={s.catalogUrl} numberOfLines={1}>
                      {catalog.url}
                    </Text>
                    <Text style={s.status}>{authenticationLabel(catalog)}</Text>
                  </View>
                  {catalog.enabled ? (
                    <ChevronRightIcon size={18} color={colors.mutedForeground} />
                  ) : null}
                </TouchableOpacity>
                <View style={s.actions}>
                  {catalog.builtIn ? (
                    <>
                      <Text style={s.switchLabel}>{t("library.opds.builtInLocked")}</Text>
                      <TouchableOpacity
                        style={s.action}
                        onPress={() => void mutate(catalog.id, () => store.hideBuiltIn(catalog.id))}
                        accessibilityRole="button"
                        accessibilityLabel={t("library.opds.hideCatalog", {
                          name: catalog.name,
                        })}
                      >
                        <EyeOffIcon size={18} color={colors.mutedForeground} />
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <Text style={s.switchLabel}>
                        {catalog.enabled ? t("library.opds.enabled") : t("library.opds.disabled")}
                      </Text>
                      <Switch
                        value={catalog.enabled}
                        disabled={busy}
                        onValueChange={(value) =>
                          void mutate(catalog.id, () => store.setCatalogEnabled(catalog.id, value))
                        }
                        accessibilityLabel={t("library.opds.toggleCatalog", {
                          name: catalog.name,
                        })}
                      />
                      <TouchableOpacity
                        style={s.action}
                        onPress={() => {
                          setEditing(catalog);
                          setFormOpen(true);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={t("library.opds.editCatalog", {
                          name: catalog.name,
                        })}
                      >
                        <EditIcon size={18} color={colors.mutedForeground} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={s.action}
                        onPress={() => confirmDelete(catalog)}
                        accessibilityRole="button"
                        accessibilityLabel={t("library.opds.deleteCatalog", {
                          name: catalog.name,
                        })}
                      >
                        <Trash2Icon size={18} color={colors.destructive} />
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        {hiddenBuiltIns.length > 0 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>{t("library.opds.hiddenPresets")}</Text>
            {hiddenBuiltIns.map((catalog) => (
              <View key={catalog.id} style={s.hiddenCard}>
                <RotateCcwIcon size={17} color={colors.mutedForeground} />
                <Text style={s.hiddenName}>{catalog.name}</Text>
                <TouchableOpacity
                  style={s.action}
                  onPress={() => void mutate(catalog.id, () => store.restoreBuiltIn(catalog.id))}
                  accessibilityRole="button"
                  accessibilityLabel={t("library.opds.restoreCatalog", {
                    name: catalog.name,
                  })}
                >
                  <Text style={s.restoreText}>{t("library.opds.restore")}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <OpdsCatalogFormSheet
        visible={formOpen}
        catalog={editing}
        store={store}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          setEditing(undefined);
          syncCatalogs();
        }}
        onBackgroundSaved={syncCatalogs}
      />
    </SafeAreaView>
  );
}
