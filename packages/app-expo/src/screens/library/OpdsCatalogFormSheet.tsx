import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { fontSize, fontWeight, radius, useColors, withOpacity } from "@/styles/theme";
import {
  type OpdsCatalog,
  type OpdsCatalogAuth,
  type OpdsCatalogStore,
  canPreserveOpdsCatalogPassword,
  classifyOpdsUrl,
} from "@readany/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createOpdsFormSaveOwner } from "./opds-form-save-owner";

interface OpdsCatalogFormSheetProps {
  visible: boolean;
  catalog?: OpdsCatalog;
  store: OpdsCatalogStore;
  onClose: () => void;
  onSaved: () => void;
  onBackgroundSaved?: () => void;
}

export function OpdsCatalogFormSheet({
  visible,
  catalog,
  store,
  onClose,
  onSaved,
  onBackgroundSaved,
}: OpdsCatalogFormSheetProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<OpdsCatalogAuth>("anonymous");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [renderedOpenGeneration, setRenderedOpenGeneration] = useState(0);
  const [error, setError] = useState<string>();
  const saveOwner = useRef(createOpdsFormSaveOwner());
  const wasVisible = useRef(false);

  useEffect(() => {
    const opening = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (!visible) {
      saveOwner.current.close();
      setPassword("");
      return;
    }
    if (!opening) return;
    const generation = saveOwner.current.open();
    setRenderedOpenGeneration(generation);
    setName(catalog?.name ?? "");
    setUrl(catalog?.url ?? "");
    setAuth(catalog?.auth ?? "anonymous");
    setUsername(catalog?.username ?? "");
    setPassword("");
    setEnabled(catalog?.enabled ?? true);
    setError(undefined);
  }, [catalog, visible]);

  const hasPassword = (catalog?.passwordStorage ?? "none") !== "none";
  const preservesPassword = Boolean(
    catalog &&
      canPreserveOpdsCatalogPassword(catalog, {
        url: url.trim(),
        auth,
        username: username.trim(),
      }),
  );
  const canSubmit =
    name.trim().length > 0 &&
    url.trim().length > 0 &&
    (auth === "anonymous" ||
      (username.trim().length > 0 && (password.length > 0 || preservesPassword))) &&
    !submitting;
  const savingCurrentOpen = saveOwner.current.isSavingCurrent(renderedOpenGeneration);

  const s = useMemo(
    () =>
      StyleSheet.create({
        overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
        keyboardWrap: { width: "100%", justifyContent: "flex-end" },
        sheet: {
          alignSelf: "center",
          width: "100%",
          maxWidth: layout.isTablet ? 620 : undefined,
          maxHeight: "94%",
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 16) + 12,
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
          backgroundColor: colors.background,
          gap: 14,
        },
        handle: {
          alignSelf: "center",
          width: 38,
          height: 4,
          borderRadius: radius.full,
          backgroundColor: withOpacity(colors.border, 0.95),
        },
        title: { fontSize: fontSize.xl, fontWeight: fontWeight.semibold, color: colors.foreground },
        subtitle: {
          marginTop: 4,
          fontSize: fontSize.sm,
          lineHeight: 20,
          color: colors.mutedForeground,
        },
        scroll: { flexGrow: 0 },
        content: { gap: 14, paddingBottom: 4 },
        field: { gap: 7 },
        label: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.foreground },
        input: {
          minHeight: 48,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.92),
          backgroundColor: colors.card,
          paddingHorizontal: 14,
          fontSize: fontSize.base,
          color: colors.foreground,
        },
        segmented: {
          minHeight: 48,
          padding: 4,
          borderRadius: radius.xl,
          backgroundColor: colors.muted,
          flexDirection: "row",
          gap: 4,
        },
        segment: {
          flex: 1,
          minHeight: 40,
          borderRadius: radius.lg,
          alignItems: "center",
          justifyContent: "center",
        },
        segmentActive: { backgroundColor: colors.card },
        segmentText: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.medium,
          color: colors.mutedForeground,
        },
        segmentTextActive: { color: colors.foreground },
        helper: { fontSize: fontSize.xs, lineHeight: 18, color: colors.mutedForeground },
        switchRow: {
          minHeight: 56,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.92),
          backgroundColor: colors.card,
          paddingHorizontal: 14,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        },
        switchCopy: { flex: 1 },
        switchTitle: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.medium,
          color: colors.foreground,
        },
        switchHint: { marginTop: 2, fontSize: fontSize.xs, color: colors.mutedForeground },
        errorBox: {
          padding: 12,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: withOpacity(colors.destructive, 0.24),
          backgroundColor: withOpacity(colors.destructive, 0.08),
        },
        errorText: { fontSize: fontSize.sm, lineHeight: 20, color: colors.destructive },
        footer: { flexDirection: "row", gap: 10 },
        button: {
          minHeight: 48,
          borderRadius: radius.xl,
          alignItems: "center",
          justifyContent: "center",
        },
        cancelButton: {
          flex: 1,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.9),
          backgroundColor: colors.card,
        },
        saveButton: {
          flex: 1.2,
          flexDirection: "row",
          gap: 8,
          backgroundColor: canSubmit ? colors.primary : withOpacity(colors.primary, 0.42),
        },
        cancelText: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.medium,
          color: colors.foreground,
        },
        saveText: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.semibold,
          color: colors.primaryForeground,
        },
      }),
    [canSubmit, colors, insets.bottom, layout.isTablet],
  );

  const persist = async () => {
    if (!canSubmit) return;
    const token = saveOwner.current.start(renderedOpenGeneration);
    if (!token) return;
    setSubmitting(true);
    setError(undefined);
    let succeeded = false;
    try {
      const input = {
        name: name.trim(),
        url: url.trim(),
        enabled,
        auth,
        ...(auth === "basic"
          ? { username: username.trim(), ...(password ? { password } : {}) }
          : {}),
      };
      if (catalog) await store.updateCatalog(catalog.id, input);
      else await store.addCatalog(input);
      succeeded = true;
    } catch {
      // Ownership is resolved in finally so stale failures cannot touch a reopened form.
    } finally {
      const outcome = saveOwner.current.finish(token);
      setSubmitting(saveOwner.current.hasActiveSave());
      if (succeeded && outcome === "current") {
        setPassword("");
        onSaved();
      } else if (succeeded && outcome === "stale") {
        onBackgroundSaved?.();
      } else if (!succeeded && outcome === "current") {
        setError(t("library.opds.form.saveFailed"));
      }
    }
  };

  const handleSave = () => {
    if (!canSubmit) return;
    const classification = classifyOpdsUrl(url.trim());
    if (!classification.allowed) {
      const key =
        classification.reason === "public-http"
          ? "publicHttpBlocked"
          : classification.reason === "credentials-not-allowed"
            ? "credentialsInUrl"
            : "invalidUrl";
      setError(t(`library.opds.form.${key}`));
      return;
    }
    if (!classification.requiresInsecureConfirmation) {
      void persist();
      return;
    }
    Alert.alert(t("library.opds.form.localHttpTitle"), t("library.opds.form.localHttpWarning"), [
      { text: t("library.opds.cancel"), style: "cancel" },
      {
        text: t("library.opds.continue"),
        onPress: () => void persist(),
      },
    ]);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!savingCurrentOpen) onClose();
      }}
    >
      <Pressable
        style={s.overlay}
        disabled={savingCurrentOpen}
        onPress={() => {
          if (!savingCurrentOpen) onClose();
        }}
      >
        <KeyboardAvoidingView
          style={s.keyboardWrap}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable style={s.sheet} onPress={(event) => event.stopPropagation()}>
            <View style={s.handle} />
            <View>
              <Text style={s.title}>
                {catalog ? t("library.opds.form.editTitle") : t("library.opds.form.addTitle")}
              </Text>
              <Text style={s.subtitle}>{t("library.opds.form.subtitle")}</Text>
            </View>
            <ScrollView
              style={s.scroll}
              contentContainerStyle={s.content}
              automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={s.field}>
                <Text style={s.label}>{t("library.opds.form.name")}</Text>
                <TextInput
                  style={s.input}
                  value={name}
                  onChangeText={setName}
                  placeholder={t("library.opds.form.namePlaceholder")}
                  placeholderTextColor={colors.mutedForeground}
                  accessibilityLabel={t("library.opds.form.name")}
                  editable={!savingCurrentOpen}
                />
              </View>
              <View style={s.field}>
                <Text style={s.label}>{t("library.opds.form.url")}</Text>
                <TextInput
                  style={s.input}
                  value={url}
                  onChangeText={setUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  placeholder="https://catalog.example.com/opds"
                  placeholderTextColor={colors.mutedForeground}
                  accessibilityLabel={t("library.opds.form.url")}
                  editable={!savingCurrentOpen}
                />
              </View>
              <View style={s.field}>
                <Text style={s.label}>{t("library.opds.form.authentication")}</Text>
                <View style={s.segmented} accessibilityRole="radiogroup">
                  {(["anonymous", "basic"] as const).map((mode) => (
                    <TouchableOpacity
                      key={mode}
                      style={[s.segment, auth === mode && s.segmentActive]}
                      onPress={() => setAuth(mode)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: auth === mode }}
                      disabled={savingCurrentOpen}
                    >
                      <Text style={[s.segmentText, auth === mode && s.segmentTextActive]}>
                        {mode === "anonymous"
                          ? t("library.opds.form.anonymous")
                          : t("library.opds.form.basic")}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              {auth === "basic" ? (
                <>
                  <View style={s.field}>
                    <Text style={s.label}>{t("library.opds.form.username")}</Text>
                    <TextInput
                      style={s.input}
                      value={username}
                      onChangeText={setUsername}
                      autoCapitalize="none"
                      autoCorrect={false}
                      accessibilityLabel={t("library.opds.form.username")}
                      editable={!savingCurrentOpen}
                    />
                  </View>
                  <View style={s.field}>
                    <Text style={s.label}>{t("library.opds.form.password")}</Text>
                    <TextInput
                      style={s.input}
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder={
                        hasPassword
                          ? t(
                              preservesPassword
                                ? "library.opds.form.passwordUnchanged"
                                : "library.opds.form.passwordRequiredForIdentityChange",
                            )
                          : undefined
                      }
                      placeholderTextColor={colors.mutedForeground}
                      accessibilityLabel={t("library.opds.form.password")}
                      editable={!savingCurrentOpen}
                    />
                    {catalog ? (
                      <Text style={s.helper}>
                        {catalog.passwordStorage === "persistent"
                          ? t("library.opds.form.passwordStoredSecurely")
                          : catalog.passwordStorage === "session-only"
                            ? t("library.opds.form.passwordSessionOnly")
                            : t("library.opds.form.passwordMissing")}
                      </Text>
                    ) : null}
                  </View>
                </>
              ) : null}
              <View style={s.switchRow}>
                <View style={s.switchCopy}>
                  <Text style={s.switchTitle}>{t("library.opds.form.enabled")}</Text>
                  <Text style={s.switchHint}>{t("library.opds.form.enabledHint")}</Text>
                </View>
                <Switch
                  value={enabled}
                  onValueChange={setEnabled}
                  accessibilityLabel={t("library.opds.form.enabled")}
                  disabled={savingCurrentOpen}
                />
              </View>
              {error ? (
                <View style={s.errorBox} accessibilityRole="alert">
                  <Text style={s.errorText}>{error}</Text>
                </View>
              ) : null}
            </ScrollView>
            <View style={s.footer}>
              <TouchableOpacity
                style={[s.button, s.cancelButton]}
                onPress={onClose}
                disabled={savingCurrentOpen}
                accessibilityState={{ disabled: savingCurrentOpen }}
              >
                <Text style={s.cancelText}>{t("library.opds.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.button, s.saveButton]}
                onPress={handleSave}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSubmit, busy: submitting }}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : null}
                <Text style={s.saveText}>{t("library.opds.save")}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}
