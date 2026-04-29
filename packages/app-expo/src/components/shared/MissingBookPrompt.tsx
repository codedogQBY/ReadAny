import { useMissingBookPromptStore } from "@/stores/missing-book-prompt-store";
import { type ThemeColors, fontSize, fontWeight, radius, spacing, useColors } from "@/styles/theme";
import { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

export function MissingBookPrompt() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { visible, title, description, confirmLabel, cancelLabel, resolvePrompt } =
    useMissingBookPromptStore();

  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  // Handle Android back button
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      resolvePrompt(false);
      return true;
    });
    return () => sub.remove();
  }, [visible, resolvePrompt]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.overlay, { opacity }]} pointerEvents="auto">
      <Pressable style={StyleSheet.absoluteFill} onPress={() => resolvePrompt(false)} />
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => resolvePrompt(false)}
            activeOpacity={0.8}
          >
            <Text style={styles.secondaryText}>{cancelLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => resolvePrompt(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryText}>{confirmLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.32)",
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: spacing.xl,
      zIndex: 9999,
      elevation: 9999,
    },
    card: {
      width: "100%",
      maxWidth: 328,
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg,
      gap: spacing.md,
      zIndex: 1,
    },
    title: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      lineHeight: 24,
    },
    description: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      lineHeight: 18,
    },
    actions: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    secondaryButton: {
      flex: 1,
      minHeight: 44,
      borderRadius: radius.xl,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    primaryButton: {
      flex: 1,
      minHeight: 44,
      borderRadius: radius.xl,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: colors.primaryForeground,
    },
  });
