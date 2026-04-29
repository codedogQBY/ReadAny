/**
 * BadgesScreen.tsx — Mobile badge wall + share poster preview.
 */
import { ChevronLeftIcon, ShareIcon } from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { useReadingSessionStore } from "@/stores";
import { useNavigation } from "@react-navigation/native";
import {
  ALL_BADGE_DEFINITIONS,
  BADGE_CATEGORIES,
  BADGE_NUMBERS,
  type BadgeDefinition,
  type BadgeTier,
  buildStatsSummary,
  evaluateBadges,
  groupBadgesByCategory,
  readingReportsService,
} from "@readany/core/stats";
import { File, Paths } from "expo-file-system";
import { LinearGradient } from "expo-linear-gradient";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { captureRef } from "react-native-view-shot";
import AppIcon from "../../assets/icon.png";
import { BadgeBackIconMobile, BadgeIconMobile } from "./stats/BadgeIconMobile";

const BADGE_WALL_GRADIENT = ["#15192f", "#1e2446", "#151a31"] as const;
const BADGE_WALL_PANEL = "rgba(255,255,255,0.05)";
const BADGE_WALL_BORDER = "rgba(245, 216, 158, 0.14)";
const BADGE_WALL_TITLE = "#d8bf8d";
const BADGE_WALL_SUBTITLE = "rgba(216, 191, 141, 0.76)";
const BADGE_WALL_LABEL = "rgba(255,255,255,0.88)";
const BADGE_WALL_MUTED = "rgba(255,255,255,0.48)";
const BADGE_SHARE_PILL = "rgba(242, 217, 162, 0.14)";
const BADGE_SHARE_BUTTON = "#f1d49d";
const BADGE_SHARE_BUTTON_TEXT = "#2d2442";

type BadgeSharePalette = {
  outer: string;
  inner: string;
  ring: string;
  text: string;
};

const SHARE_BADGE_PALETTES: Record<BadgeTier, BadgeSharePalette> = {
  bronze: { outer: "#aa7544", inner: "#e4c596", ring: "#80522f", text: "#fff7ec" },
  silver: { outer: "#d7dbe4", inner: "#f8f9fb", ring: "#b6bcc8", text: "#5f6673" },
  gold: { outer: "#d7aa45", inner: "#fff1b3", ring: "#9b7023", text: "#fffef2" },
  platinum: { outer: "#8ec0d8", inner: "#eff9ff", ring: "#5f879f", text: "#203746" },
  diamond: { outer: "#68cbff", inner: "#ddf5ff", ring: "#2482bb", text: "#0b4f78" },
  legendary: { outer: "#be94ef", inner: "#f7e8ff", ring: "#855bc1", text: "#ffffff" },
};

const LEFT_LAUREL_PATH =
  "M736.853333 731.306667c-1.706667-1.706667-4.266667-1.706667-6.4 0-8.106667 7.253333-30.293333 30.72-30.293333 72.106666s22.186667 64.853333 30.293333 72.106667c1.706667 1.706667 4.266667 1.706667 6.4 0 8.106667-7.253333 30.293333-30.72 30.293334-72.106667 0.426667-41.386667-21.76-64.426667-30.293334-72.106666z m-19.626666 168.106666c-10.24-3.413333-41.386667-11.093333-77.226667 9.813334-35.84 20.906667-44.8 51.626667-46.933333 62.293333-0.426667 2.56 0.853333 4.693333 2.986666 5.546667 10.666667 3.413333 41.386667 11.093333 77.226667-9.813334 35.84-20.906667 44.8-51.626667 46.933333-62.293333 0.853333-2.56-0.426667-4.693333-2.986666-5.546667zM502.186667 810.666667c-40.533333 8.533333-58.453333 34.986667-64 44.373333-1.28 2.133333-0.426667 4.693333 1.28 5.973333 8.96 6.826667 35.84 23.466667 76.373333 15.36 40.533333-8.533333 58.453333-34.986667 64-44.373333 1.28-2.133333 0.426667-4.693333-1.28-5.973333-8.96-6.826667-36.266667-23.893333-76.373333-15.36z m102.4-1.28c10.24-4.266667 38.4-19.626667 51.2-58.88 12.8-39.253333-0.853333-68.266667-6.4-78.08a4.906667 4.906667 0 0 0-5.973334-2.133334c-10.24 4.266667-38.4 19.626667-51.2 58.88s0.853333 68.266667 6.4 78.08c1.28 2.133333 3.84 2.986667 5.973334 2.133334z m-115.626667-90.453334c11.093333-1.28 42.24-7.68 66.133333-41.386666s19.2-65.706667 16.213334-76.373334a4.437333 4.437333 0 0 0-5.12-3.413333c-11.093333 1.28-42.24 7.68-66.133334 41.386667s-19.2 65.706667-16.213333 76.373333c0.426667 2.133333 2.56 3.413333 5.12 3.413333z m-29.866667 8.106667c-6.4-8.96-27.733333-33.28-68.693333-36.693333-40.96-3.84-66.133333 16.213333-74.24 23.893333-1.706667 1.706667-2.133333 4.266667-0.426667 6.4 6.4 8.96 27.733333 33.28 68.693334 36.693333 40.96 3.84 66.133333-16.213333 74.24-23.893333 1.706667-1.706667 2.133333-4.693333 0.426666-6.4z m74.666667-219.733333c0-2.56-1.706667-4.266667-3.84-4.693334-11.093333-1.706667-42.666667-4.266667-74.666667 22.186667s-35.84 58.026667-36.266666 69.12c0 2.56 1.706667 4.266667 3.84 4.693333 11.093333 1.706667 42.666667 4.266667 74.666666-22.186666s35.84-58.026667 36.266667-69.12z m-143.786667 96.853333c2.133333-1.28 2.986667-3.84 2.133334-5.973333-3.84-10.24-17.92-39.253333-56.32-54.186667s-67.84-2.133333-77.653334 2.986667c-2.133333 1.28-3.413333 3.84-2.56 5.973333 3.84 10.24 17.92 39.253333 56.32 54.186667 38.826667 14.506667 68.266667 2.133333 78.08-2.986667z m-6.826666-148.053333c2.56-0.426667 4.266667-2.133333 4.266666-4.693334 0-11.093333-2.56-43.093333-33.706666-70.4-31.146667-27.733333-62.72-26.453333-73.813334-25.173333-2.56 0.426667-4.266667 2.56-4.266666 4.693333 0 11.093333 2.56 43.093333 33.706666 70.4 30.72 27.733333 62.72 26.453333 73.813334 25.173334z m89.173333-51.2c-39.253333 13.226667-54.186667 41.386667-58.453333 51.626666-0.853333 2.133333 0 4.693333 2.133333 5.973334 9.386667 5.546667 38.4 19.2 77.653333 5.973333s54.186667-41.386667 58.453334-51.626667c0.853333-2.133333 0-4.693333-2.133334-5.973333-9.386667-5.546667-38.4-19.2-77.653333-5.973333z m116.053333-101.973334c-8.533333-6.826667-34.986667-24.746667-75.946666-17.92-40.533333 7.253333-59.733333 32.853333-65.28 42.24-1.28 2.133333-0.853333 4.693333 0.853333 6.4 8.533333 6.826667 34.986667 24.746667 75.946667 17.92 40.533333-7.253333 59.733333-32.853333 65.28-42.24 1.28-2.133333 0.853333-4.693333-0.853334-6.4z m-171.946666 19.2c2.56 0 4.266667-1.706667 4.693333-3.84 2.133333-11.093333 3.84-43.093333-22.186667-75.093333-26.453333-31.573333-58.453333-35.413333-69.546666-35.84-2.56 0-4.266667 1.706667-4.693334 3.84-1.706667 11.093333-3.84 43.52 22.613334 75.093333 26.453333 32 58.026667 35.84 69.12 35.84z m64.853333-122.88c2.133333 0.853333 4.693333-0.426667 5.546667-2.56 4.693333-10.24 14.933333-40.533333-2.133334-78.08-17.066667-37.546667-46.933333-49.493333-57.6-52.906666a5.12 5.12 0 0 0-5.546666 2.56c-4.266667 10.24-14.933333 40.533333 2.56 78.506666 17.066667 37.546667 46.933333 49.493333 57.173333 52.48zM577.28 256c40.96 3.84 66.133333-16.213333 74.24-23.466667 1.706667-1.706667 2.133333-4.266667 0.426667-6.4-6.4-8.96-27.306667-33.28-68.693334-37.12-40.96-3.84-66.133333 16.213333-74.24 23.466667-1.706667 1.706667-2.133333 4.266667-0.426666 6.4 6.826667 8.96 27.733333 33.28 68.693333 37.12z m-26.88-110.506667c48.64 8.96 110.506667-47.36 105.813333-97.28 0-2.56-1.706667-4.266667-4.266666-4.693333C603.306667 34.56 541.866667 90.88 546.133333 140.8c0 2.56 2.133333 4.266667 4.266667 4.693333z";
const RIGHT_LAUREL_PATH =
  "M382.72 909.226667c-35.84-20.906667-66.986667-13.226667-77.226667-9.813334-2.133333 0.853333-3.413333 2.986667-2.986666 5.546667 2.133333 11.093333 11.093333 41.813333 46.933333 62.293333 35.84 20.906667 66.986667 13.226667 77.226667 9.813334 2.133333-0.853333 3.413333-2.986667 2.986666-5.546667-2.133333-10.666667-11.093333-41.813333-46.933333-62.293333z m-90.88-177.92c-1.706667-1.706667-4.266667-1.706667-6.4 0-8.106667 7.253333-30.293333 30.72-30.293333 72.106666s22.186667 64.853333 30.293333 72.106667c1.706667 1.706667 4.266667 1.706667 6.4 0 8.106667-7.253333 30.293333-30.72 30.293333-72.106667s-21.76-64.426667-30.293333-72.106666z m87.466667-60.586667c-2.133333-0.853333-4.693333 0-5.973334 2.133333-5.546667 9.386667-19.2 38.826667-6.4 78.08 12.8 39.253333 40.96 54.613333 51.2 58.88 2.133333 0.853333 4.693333 0 5.973334-2.133333 5.546667-9.386667 19.2-38.826667 6.4-78.08s-40.96-54.613333-51.2-58.88zM520.533333 810.666667c-40.533333-8.533333-67.413333 8.533333-76.373333 15.36-1.706667 1.28-2.56 4.266667-1.28 5.973333 5.546667 9.813333 23.466667 36.266667 64 44.373333 40.533333 8.533333 67.413333-8.533333 76.373333-15.36 1.706667-1.28 2.56-4.266667 1.28-5.973333-5.12-9.386667-23.466667-35.84-64-44.373333z m-64-213.333334a4.437333 4.437333 0 0 0-5.12 3.413334c-2.56 10.666667-7.253333 42.666667 16.213334 76.373333 23.893333 33.706667 55.04 40.106667 66.133333 41.386667 2.56 0.426667 4.693333-1.28 5.12-3.413334 2.56-10.666667 7.253333-42.666667-16.213333-76.373333-23.893333-33.706667-55.04-40.106667-66.133334-41.386667z m175.786667 93.013334c-40.96 3.84-62.293333 27.733333-68.693333 36.693333-1.28 2.133333-1.28 4.693333 0.426666 6.4 8.106667 7.68 32.853333 27.733333 74.24 23.893333 40.96-3.84 62.293333-27.733333 68.693334-36.693333 1.28-2.133333 1.28-4.693333-0.426667-6.4-8.106667-7.68-33.28-27.733333-74.24-23.893333z m132.693333-143.36c-9.813333-5.12-39.253333-17.493333-77.653333-2.986667s-52.48 43.52-56.32 54.186667c-0.853333 2.133333 0 4.693333 2.133333 5.973333 9.813333 5.12 39.253333 17.493333 77.653334 2.986667 38.4-14.506667 52.48-43.52 56.32-54.186667 0.853333-2.133333 0-4.693333-2.133334-5.973333z m-165.12 51.2c2.56-0.426667 3.84-2.56 3.84-4.693334-0.426667-11.093333-4.266667-43.093333-36.266666-69.12-32-26.453333-64-23.893333-74.666667-22.186666-2.56 0.426667-3.84 2.56-3.84 4.693333 0.426667 11.093333 4.266667 43.093333 36.266667 69.12 32 26.453333 64 24.32 74.666666 22.186667z m35.84-146.773334c0 2.56 1.706667 4.266667 4.266667 4.693334 11.093333 1.28 43.093333 2.56 73.813333-24.746667 30.72-27.306667 33.706667-59.306667 33.706667-70.4 0-2.56-1.706667-4.266667-4.266667-4.693333-11.093333-1.28-43.093333-2.56-73.813333 24.746666-31.146667 27.306667-34.133333 59.306667-33.706667 70.4z m-26.88 5.12c-4.266667-10.24-19.2-38.826667-58.453333-51.626666-39.253333-13.226667-68.266667 0.426667-77.653333 5.973333-2.133333 1.28-2.986667 3.84-2.133334 5.973333 4.266667 10.24 19.2 38.826667 58.453334 51.626667 39.253333 13.226667 68.266667-0.426667 77.653333-5.973333 2.133333-1.28 2.986667-3.84 2.133333-5.973334z m-34.133333-122.88c1.706667-1.706667 2.133333-4.266667 0.853333-6.4-5.546667-9.386667-24.746667-35.413333-65.28-42.24-40.533333-7.253333-67.413333 10.666667-75.946666 17.92-1.706667 1.706667-2.133333 4.266667-0.853334 6.4 5.973333 9.386667 24.746667 35.413333 65.28 42.24 40.533333 6.826667 67.413333-11.093333 75.946667-17.92z m26.88-15.36c0.426667 2.56 2.56 4.266667 4.693333 3.84 11.093333-0.426667 42.666667-3.84 69.12-35.84 26.453333-32 24.32-64 22.613334-75.093333-0.426667-2.56-2.56-4.266667-4.693334-3.84-11.093333 0.426667-42.666667 3.84-69.12 35.84-26.453333 32-24.32 64-22.613333 75.093333z m-60.16-119.04c10.666667-2.986667 40.106667-14.933333 57.6-52.906666 17.066667-37.546667 6.826667-68.266667 2.133333-78.08-0.853333-2.133333-3.413333-3.413333-5.546666-2.56-10.666667 2.986667-40.106667 14.933333-57.6 52.906666s-6.826667 68.266667-2.133334 78.08a4.266667 4.266667 0 0 0 5.546667 2.56z m-171.093333 26.88c-1.28 1.706667-0.853333 4.266667 0.853333 5.973334 8.106667 7.68 32.853333 27.733333 74.24 23.893333a95.573333 95.573333 0 0 0 68.693333-37.12c1.28-2.133333 1.28-4.693333-0.426666-6.4-8.106667-7.68-33.28-27.306667-74.24-23.466667-41.386667 3.84-62.293333 27.733333-69.12 37.12z m101.973333-80.64c2.56-0.426667 4.266667-2.133333 4.266667-4.693333 4.266667-49.92-57.173333-106.24-105.813334-97.28-2.56 0.426667-4.266667 2.133333-4.266666 4.693333-4.693333 49.92 57.173333 106.24 105.813333 97.28z";

export default function BadgesScreen() {
  const { t } = useTranslation();
  const nav = useNavigation();
  const layout = useResponsiveLayout();
  const { width } = useWindowDimensions();
  const currentSession = useReadingSessionStore((s) => s.currentSession);

  const [allFacts, setAllFacts] = useState<import("@readany/core/stats").DailyReadingFact[]>([]);
  const [selectedBadge, setSelectedBadge] = useState<BadgeDefinition | null>(null);
  const [sharePreviewOpen, setSharePreviewOpen] = useState(false);
  const [isSharingPoster, setIsSharingPoster] = useState(false);
  const sharePosterRef = React.useRef<View>(null);

  useEffect(() => {
    readingReportsService
      .getAllDailyFacts(currentSession)
      .then(setAllFacts)
      .catch(() => {});
  }, [currentSession]);

  const earnedBadges = useMemo(() => {
    if (allFacts.length === 0) return [];
    return evaluateBadges(allFacts, buildStatsSummary(allFacts));
  }, [allFacts]);

  const earnedIds = useMemo(() => new Set(earnedBadges.map((b) => b.id)), [earnedBadges]);
  const grouped = useMemo(() => groupBadgesByCategory(ALL_BADGE_DEFINITIONS), []);
  const earnedBadgeDefinitions = useMemo(() => {
    const earned = new Set(earnedBadges.map((badge) => badge.id));
    return ALL_BADGE_DEFINITIONS.filter((badge) => earned.has(badge.id));
  }, [earnedBadges]);
  const posterWidth = Math.min(width - 32, layout.isTablet ? 520 : 360);
  const categorySectionWidth = layout.isTabletLandscape
    ? Math.floor((layout.centeredContentWidth - 16) / 2)
    : layout.centeredContentWidth;

  const capturePosterFile = React.useCallback(async () => {
    if (earnedBadgeDefinitions.length === 0 || !sharePosterRef.current) return null;

    const capturedUri = await captureRef(sharePosterRef, {
      format: "png",
      quality: 1,
      result: "tmpfile",
    });

    const exportFile = new File(
      Paths.cache,
      `readany-badges-${new Date().toISOString().slice(0, 10)}.png`,
    );
    if (exportFile.exists) {
      exportFile.delete();
    }
    new File(capturedUri).copy(exportFile);
    return exportFile;
  }, [earnedBadgeDefinitions.length]);

  const handleSharePoster = React.useCallback(async () => {
    if (earnedBadgeDefinitions.length === 0 || isSharingPoster) return;
    setIsSharingPoster(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        return;
      }

      const exportFile = await capturePosterFile();
      if (!exportFile) return;

      await Sharing.shareAsync(exportFile.uri, {
        mimeType: "image/png",
        dialogTitle: t("stats.desktop.badgeShareAction"),
      });
    } catch (error) {
      console.error("[BadgesScreen] Failed to share badge poster", error);
    } finally {
      setIsSharingPoster(false);
    }
  }, [capturePosterFile, isSharingPoster, earnedBadgeDefinitions.length, t]);

  const handleSavePoster = React.useCallback(async () => {
    if (earnedBadgeDefinitions.length === 0 || isSharingPoster) return;
    setIsSharingPoster(true);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          t("stats.desktop.badgeSaveAction"),
          t("stats.desktop.badgeSavePermissionDenied"),
        );
        return;
      }

      const exportFile = await capturePosterFile();
      if (!exportFile) return;

      await MediaLibrary.saveToLibraryAsync(exportFile.uri);
      Alert.alert(
        t("stats.desktop.badgeSaveSuccessTitle"),
        t("stats.desktop.badgeSaveSuccessDesc"),
      );
    } catch (error) {
      console.error("[BadgesScreen] Failed to save badge poster", error);
    } finally {
      setIsSharingPoster(false);
    }
  }, [capturePosterFile, isSharingPoster, earnedBadgeDefinitions.length, t]);

  return (
    <View style={{ flex: 1, backgroundColor: BADGE_WALL_GRADIENT[0] }}>
      <LinearGradient
        colors={[...BADGE_WALL_GRADIENT]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <SafeAreaView style={{ flex: 1, backgroundColor: "transparent" }} edges={["top"]}>
        <View style={{ alignItems: "center", paddingVertical: 10 }}>
          <View
            style={{
              width: "100%",
              maxWidth: layout.centeredContentWidth,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 12,
            }}
          >
            <TouchableOpacity
              onPress={() => {
                if (nav.canGoBack()) {
                  nav.goBack();
                } else {
                  nav.navigate("Tabs" as never);
                }
              }}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ChevronLeftIcon size={20} color="#fff7ea" />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={earnedBadgeDefinitions.length === 0}
              onPress={() => setSharePreviewOpen(true)}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: "center",
                justifyContent: "center",
                opacity: earnedBadgeDefinitions.length === 0 ? 0.35 : 1,
              }}
            >
              <ShareIcon size={18} color="#f8e4ba" />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 18,
            paddingBottom: 42,
            alignItems: "center",
          }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ width: "100%", maxWidth: layout.centeredContentWidth }}>
            <BadgeWallPoster
              width={Math.min(layout.centeredContentWidth, layout.isTablet ? 560 : 420)}
              badges={earnedBadgeDefinitions}
              count={earnedBadgeDefinitions.length}
              title={t("stats.desktop.myBadges")}
              subtitle={t("stats.desktop.myBadgesDesc")}
              countLabel={t("stats.desktop.badgesEarnedCount", {
                count: earnedBadgeDefinitions.length,
              })}
              emptyLabel={t("stats.desktop.noBadges")}
              remainingLabel={(remaining) =>
                t("stats.desktop.badgesRemainingCount", { count: remaining })
              }
              resolveTitle={(badge) => t(`stats.desktop.badge_${badge.id}_title`)}
              onBadgePress={setSelectedBadge}
            />

            <View
              style={{
                marginTop: 28,
                gap: 16,
                flexDirection: layout.isTabletLandscape ? "row" : "column",
                flexWrap: layout.isTabletLandscape ? "wrap" : "nowrap",
                alignItems: "flex-start",
              }}
            >
              {BADGE_CATEGORIES.map(({ key, titleKey }) => {
                const badges = grouped.get(key);
                if (!badges || badges.length === 0) return null;

                return (
                  <BadgeCategorySection
                    key={key}
                    width={categorySectionWidth}
                    title={t(titleKey)}
                    badges={badges}
                    earnedIds={earnedIds}
                    resolveTitle={(badge) => t(`stats.desktop.badge_${badge.id}_title`)}
                    onBadgePress={setSelectedBadge}
                  />
                );
              })}
            </View>
          </View>
        </ScrollView>

        {selectedBadge && (
          <BadgeDetailModal
            badge={selectedBadge}
            isEarned={earnedIds.has(selectedBadge.id)}
            t={t}
            onClose={() => setSelectedBadge(null)}
          />
        )}

        <BadgeSharePreviewModal
          open={sharePreviewOpen}
          width={posterWidth}
          posterRef={sharePosterRef}
          badges={earnedBadgeDefinitions}
          title={t("stats.desktop.sharePreview")}
          description={t("stats.desktop.sharePreviewDesc")}
          count={earnedBadgeDefinitions.length}
          posterTitle={t("stats.desktop.myBadges")}
          posterSubtitle={t("stats.desktop.myBadgesDesc")}
          posterCountLabel={t("stats.desktop.badgesEarnedCount", {
            count: earnedBadgeDefinitions.length,
          })}
          emptyLabel={t("stats.desktop.noBadges")}
          remainingLabel={(remaining) =>
            t("stats.desktop.badgesRemainingCount", { count: remaining })
          }
          saveLabel={
            isSharingPoster
              ? t("stats.desktop.badgeSharePreparing")
              : t("stats.desktop.badgeSaveAction")
          }
          shareLabel={
            isSharingPoster
              ? t("stats.desktop.badgeSharePreparing")
              : t("stats.desktop.badgeShareAction")
          }
          resolveTitle={(badge) => t(`stats.desktop.badge_${badge.id}_title`)}
          onClose={() => setSharePreviewOpen(false)}
          onSave={handleSavePoster}
          onShare={handleSharePoster}
        />
      </SafeAreaView>
    </View>
  );
}

function BadgeCategorySection({
  width,
  title,
  badges,
  earnedIds,
  resolveTitle,
  onBadgePress,
}: {
  width?: number;
  title: string;
  badges: BadgeDefinition[];
  earnedIds: Set<string>;
  resolveTitle: (badge: BadgeDefinition) => string;
  onBadgePress: (badge: BadgeDefinition) => void;
}) {
  return (
    <View
      style={{
        width: width ?? "100%",
        borderRadius: 22,
        paddingHorizontal: 16,
        paddingVertical: 18,
        backgroundColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.05)",
      }}
    >
      <Text
        style={{
          fontSize: 15,
          fontWeight: "700",
          color: "#f4e2b8",
          marginBottom: 14,
        }}
      >
        {title}
      </Text>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          columnGap: 10,
          rowGap: 20,
          justifyContent: "flex-start",
        }}
      >
        {badges.map((badge) => {
          const isEarned = earnedIds.has(badge.id);
          return (
            <TouchableOpacity
              key={badge.id}
              activeOpacity={0.82}
              onPress={() => onBadgePress(badge)}
              style={{
                width: "30.5%",
                alignItems: "center",
                gap: 8,
              }}
            >
              <BadgeIconMobile badge={badge} isEarned={isEarned} size={72} />
              <Text
                style={{
                  fontSize: 11,
                  lineHeight: 16,
                  fontWeight: "700",
                  textAlign: "center",
                  color: isEarned ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.28)",
                }}
                numberOfLines={2}
              >
                {resolveTitle(badge)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function BadgeWallPoster({
  width,
  badges,
  count,
  title,
  subtitle,
  countLabel: _countLabel,
  emptyLabel,
  remainingLabel,
  resolveTitle,
  onBadgePress,
  variant = "wall",
}: {
  width: number;
  badges: BadgeDefinition[];
  count: number;
  title: string;
  subtitle: string;
  countLabel: string;
  emptyLabel: string;
  remainingLabel: (remaining: number) => string;
  resolveTitle: (badge: BadgeDefinition) => string;
  onBadgePress?: (badge: BadgeDefinition) => void;
  variant?: "wall" | "share";
}) {
  const columns = 3;
  const maxRows = variant === "wall" ? 3 : Number.POSITIVE_INFINITY;
  const gap = variant === "share" ? 18 : 14;
  const maxVisibleCount = Number.isFinite(maxRows) ? columns * maxRows : badges.length;
  const visibleBadges = variant === "wall" ? badges.slice(0, maxVisibleCount) : badges;
  const remainingCount = Math.max(0, badges.length - visibleBadges.length);
  const itemWidth = Math.floor((width - gap * (columns - 1)) / columns);
  const iconSize = Math.min(
    variant === "share" ? 86 : 92,
    itemWidth * (variant === "share" ? 0.82 : 0.84),
  );
  const rows = chunkItems(visibleBadges, columns);
  const titleFontSize = variant === "share" ? 27 : 27;
  const subtitleFontSize = variant === "share" ? 12 : 12;
  const titleLineHeight = variant === "share" ? 29 : 29;
  const subtitleLineHeight = variant === "share" ? 15 : 15;
  const titleSubtitleGap = variant === "share" ? 1 : 1;
  const headlineHeight = titleLineHeight + subtitleLineHeight + titleSubtitleGap;
  const countFontSize = variant === "share" ? 54 : 58;

  return (
    <View>
      <View style={{ alignItems: "center", marginBottom: variant === "share" ? 26 : 30 }}>
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: variant === "share" ? 4 : 4 }}
        >
          <LaurelBranch side="left" compact={variant === "share"} />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: variant === "share" ? 12 : 12,
            }}
          >
            <View
              style={{
                height: headlineHeight,
                justifyContent: "center",
                alignItems: "flex-start",
              }}
            >
              <Text
                style={{
                  fontSize: titleFontSize,
                  lineHeight: titleLineHeight,
                  fontWeight: "800",
                  color: BADGE_WALL_TITLE,
                  textAlign: "left",
                }}
              >
                {title}
              </Text>
              <Text
                style={{
                  marginTop: titleSubtitleGap,
                  fontSize: subtitleFontSize,
                  lineHeight: subtitleLineHeight,
                  color: BADGE_WALL_SUBTITLE,
                  textAlign: "left",
                }}
              >
                {subtitle}
              </Text>
            </View>
            <View
              style={{
                minHeight: headlineHeight,
                justifyContent: "flex-start",
                transform: [{ translateX: variant === "share" ? -2 : -4 }, { translateY: 5 }],
              }}
            >
              <Text
                style={{
                  fontSize: countFontSize,
                  lineHeight: countFontSize,
                  fontWeight: "900",
                  color: BADGE_WALL_TITLE,
                  includeFontPadding: false,
                }}
              >
                {count}
              </Text>
            </View>
          </View>
          <LaurelBranch side="right" compact={variant === "share"} />
        </View>
      </View>

      {badges.length === 0 ? (
        <View
          style={{
            minHeight: 240,
            borderRadius: 24,
            borderWidth: 1,
            borderColor: BADGE_WALL_BORDER,
            backgroundColor: BADGE_WALL_PANEL,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 28,
          }}
        >
          <Text
            style={{
              fontSize: 15,
              lineHeight: 24,
              color: BADGE_WALL_SUBTITLE,
              textAlign: "center",
            }}
          >
            {emptyLabel}
          </Text>
        </View>
      ) : (
        <View style={{ gap: variant === "share" ? 22 : 24 }}>
          {rows.map((row, rowIndex) => (
            <View
              key={`row-${rowIndex}`}
              style={{
                flexDirection: "row",
                justifyContent: "center",
                columnGap: gap,
              }}
            >
              {row.map((badge) => (
                <TouchableOpacity
                  key={badge.id}
                  activeOpacity={0.82}
                  disabled={!onBadgePress}
                  onPress={() => onBadgePress?.(badge)}
                  style={{
                    width: itemWidth,
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <BadgeIconMobile badge={badge} isEarned size={iconSize} />
                  <Text
                    style={{
                      fontSize: variant === "share" ? 11 : 12,
                      lineHeight: variant === "share" ? 16 : 17,
                      fontWeight: "700",
                      color: BADGE_WALL_LABEL,
                      textAlign: "center",
                    }}
                    numberOfLines={2}
                  >
                    {resolveTitle(badge)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
          {remainingCount > 0 && variant === "wall" ? (
            <View style={{ alignItems: "center", marginTop: -2 }}>
              <Text
                style={{
                  fontSize: 13,
                  lineHeight: 18,
                  fontWeight: "700",
                  color: "rgba(255,255,255,0.56)",
                }}
              >
                {remainingLabel(remainingCount)}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

function BadgeSharePreviewModal({
  open,
  width,
  posterRef,
  badges,
  title,
  description,
  count,
  posterTitle,
  posterSubtitle,
  posterCountLabel,
  emptyLabel,
  remainingLabel,
  saveLabel,
  shareLabel,
  resolveTitle,
  onClose,
  onSave,
  onShare,
}: {
  open: boolean;
  width: number;
  posterRef: React.RefObject<View | null>;
  badges: BadgeDefinition[];
  title: string;
  description: string;
  count: number;
  posterTitle: string;
  posterSubtitle: string;
  posterCountLabel: string;
  emptyLabel: string;
  remainingLabel: (remaining: number) => string;
  saveLabel: string;
  shareLabel: string;
  resolveTitle: (badge: BadgeDefinition) => string;
  onClose: () => void;
  onSave: () => void;
  onShare: () => void;
}) {
  const { height: viewportHeight } = useWindowDimensions();
  const posterPreviewMaxHeight = Math.min(viewportHeight * 0.62, 620);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.58)",
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 18,
        }}
      >
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />
        <View
          style={{
            width: "100%",
            maxWidth: width + 32,
            borderRadius: 28,
            backgroundColor: "#11152c",
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: 18,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.08)",
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: "700", color: "#fff8ed", textAlign: "center" }}>
            {title}
          </Text>
          <Text
            style={{
              marginTop: 6,
              marginBottom: 14,
              fontSize: 12,
              lineHeight: 18,
              color: "rgba(255,255,255,0.58)",
              textAlign: "center",
            }}
          >
            {description}
          </Text>

          <View
            style={{
              marginTop: 4,
              alignItems: "center",
            }}
          >
            <ScrollView
              style={{ maxHeight: posterPreviewMaxHeight, width: "100%" }}
              contentContainerStyle={{ alignItems: "center", paddingBottom: 4 }}
              showsVerticalScrollIndicator={false}
            >
              <BadgeSharePosterCard
                ref={posterRef}
                width={width - 8}
                badges={badges}
                count={count}
                title={posterTitle}
                subtitle={posterSubtitle}
                countLabel={posterCountLabel}
                emptyLabel={emptyLabel}
                remainingLabel={remainingLabel}
                resolveTitle={resolveTitle}
              />
            </ScrollView>
          </View>

          <View
            style={{
              marginTop: 16,
              flexDirection: "row",
              gap: 10,
            }}
          >
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={onSave}
              style={{
                flex: 1,
                height: 48,
                borderRadius: 24,
                backgroundColor: BADGE_SHARE_BUTTON,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: "800", color: BADGE_SHARE_BUTTON_TEXT }}>
                {saveLabel}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.9}
              onPress={onShare}
              style={{
                flex: 1,
                height: 48,
                borderRadius: 24,
                backgroundColor: "rgba(255,255,255,0.08)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.1)",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: 8,
              }}
            >
              <ShareIcon size={16} color="#fff8ed" />
              <Text style={{ fontSize: 14, fontWeight: "800", color: "#fff8ed" }}>
                {shareLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const BadgeSharePosterCard = React.forwardRef<
  View,
  {
    width: number;
    badges: BadgeDefinition[];
    count: number;
    title: string;
    subtitle: string;
    countLabel: string;
    emptyLabel: string;
    remainingLabel: (remaining: number) => string;
    resolveTitle: (badge: BadgeDefinition) => string;
  }
>(
  (
    { width, badges, count, title, subtitle, countLabel, emptyLabel, remainingLabel, resolveTitle },
    ref,
  ) => (
    <View
      ref={ref}
      collapsable={false}
      style={{
        width,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <LinearGradient
        colors={[...BADGE_WALL_GRADIENT]}
        style={{
          paddingHorizontal: 18,
          paddingTop: 22,
          paddingBottom: 18,
        }}
      >
        <BadgeWallPoster
          width={width - 36}
          badges={badges}
          count={count}
          title={title}
          subtitle={subtitle}
          countLabel={countLabel}
          emptyLabel={emptyLabel}
          remainingLabel={remainingLabel}
          resolveTitle={resolveTitle}
          variant="share"
        />
        <View
          style={{
            marginTop: 22,
            alignItems: "center",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Image
              source={AppIcon}
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
              }}
              resizeMode="contain"
            />
            <Text
              style={{
                fontSize: 13,
                lineHeight: 16,
                fontWeight: "800",
                color: "rgba(255,248,237,0.94)",
                letterSpacing: 0.3,
              }}
            >
              ReadAny
            </Text>
          </View>
        </View>
      </LinearGradient>
    </View>
  ),
);

BadgeSharePosterCard.displayName = "BadgeSharePosterCard";

function LaurelBranch({ side, compact = false }: { side: "left" | "right"; compact?: boolean }) {
  const width = compact ? 40 : 42;
  const height = compact ? 40 : 42;
  const path = side === "left" ? LEFT_LAUREL_PATH : RIGHT_LAUREL_PATH;
  const fill = "#cfb888";

  return (
    <View style={{ opacity: 0.92 }}>
      <Svg width={width} height={height} viewBox="0 0 1024 1024">
        <Path d={path} fill={fill} />
      </Svg>
    </View>
  );
}

function buildBadgeShareSvg({
  badges,
  title,
  subtitle,
  badgeCountLabel,
  generatedAtLabel,
  emptyLabel,
  resolveTitle,
}: {
  badges: BadgeDefinition[];
  title: string;
  subtitle: string;
  badgeCountLabel: string;
  generatedAtLabel: string;
  emptyLabel: string;
  resolveTitle: (badge: BadgeDefinition) => string;
}) {
  const width = 1080;
  const columns = 3;
  const itemWidth = 260;
  const gapX = 54;
  const rowGap = 128;
  const paddingTop = 260;
  const rows = Math.max(1, Math.ceil(badges.length / columns));
  const height = paddingTop + rows * rowGap + 240;
  const badgeRows = chunkItems(badges, columns);

  const badgeNodes = badges.length
    ? badgeRows
        .map((row, rowIndex) => {
          const rowWidth = row.length * itemWidth + Math.max(0, row.length - 1) * gapX;
          const startX = (width - rowWidth) / 2;

          return row
            .map((badge, colIndex) => {
              const cx = startX + colIndex * (itemWidth + gapX) + itemWidth / 2;
              const y = paddingTop + rowIndex * rowGap;
              const p = SHARE_BADGE_PALETTES[badge.tier] ?? SHARE_BADGE_PALETTES.bronze;
              const num = BADGE_NUMBERS[badge.id] || "★";
              const label = resolveTitle(badge);

              return `
            <g transform="translate(${cx}, ${y})">
              <circle cx="0" cy="0" r="48" fill="${p.outer}" />
              <circle cx="0" cy="0" r="38" fill="${p.inner}" />
              <circle cx="0" cy="0" r="43" fill="none" stroke="${p.ring}" stroke-width="2" stroke-dasharray="5 4" opacity="0.4" />
              <text x="0" y="12" text-anchor="middle" font-size="${num.length > 2 ? 20 : 24}" font-weight="800" fill="${p.text}">${escapeXml(num)}</text>
              <text x="0" y="78" text-anchor="middle" font-size="22" font-weight="700" fill="#f6f0df">${escapeXml(label)}</text>
            </g>
          `;
            })
            .join("");
        })
        .join("")
    : `
      <text x="${width / 2}" y="${paddingTop + 40}" text-anchor="middle" font-size="30" fill="rgba(255,255,255,0.58)">
        ${escapeXml(emptyLabel)}
      </text>
    `;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#15192f" />
          <stop offset="50%" stop-color="#1e2446" />
          <stop offset="100%" stop-color="#151a31" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" rx="48" fill="url(#bg)" />
      <g opacity="0.18">
        <circle cx="152" cy="96" r="2" fill="#f2d9a2" />
        <circle cx="908" cy="132" r="1.6" fill="#f2d9a2" />
        <circle cx="838" cy="218" r="1.8" fill="#f2d9a2" />
        <circle cx="284" cy="164" r="1.4" fill="#f2d9a2" />
      </g>
      ${buildSvgLaurel(width / 2 - 170, 98, "left")}
      ${buildSvgLaurel(width / 2 + 170, 98, "right")}
      <text x="${width / 2 - 112}" y="124" text-anchor="start" font-size="44" font-weight="800" fill="#f2d9a2">${escapeXml(title)}</text>
      <rect x="${width / 2 + 108}" y="90" width="78" height="58" rx="29" fill="rgba(242,217,162,0.14)" stroke="rgba(242,217,162,0.18)" />
      <text x="${width / 2 + 147}" y="137" text-anchor="middle" font-size="30" font-weight="900" fill="#f2d9a2">${escapeXml(String(badges.length))}</text>
      <text x="${width / 2 - 112}" y="154" text-anchor="start" font-size="20" fill="rgba(246,231,201,0.76)">${escapeXml(subtitle)}</text>
      ${badgeNodes}
      <rect x="${width / 2 - 120}" y="${height - 94}" width="240" height="44" rx="22" fill="rgba(242,217,162,0.12)" />
      <text x="${width / 2}" y="${height - 64}" text-anchor="middle" font-size="22" font-weight="700" fill="#f2d9a2">${escapeXml(generatedAtLabel)}</text>
    </svg>
  `.trim();
}

function buildSvgLaurel(x: number, y: number, side: "left" | "right") {
  const path = side === "left" ? LEFT_LAUREL_PATH : RIGHT_LAUREL_PATH;
  return `
    <g transform="translate(${x}, ${y}) scale(0.06, 0.06)">
      <path d="${path}" fill="#cfb888" />
    </g>
  `;
}

function chunkItems<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/* ─── Badge Detail Modal — Centered with spin ─── */

function BadgeDetailModal({
  badge,
  isEarned,
  t,
  onClose,
}: {
  badge: BadgeDefinition;
  isEarned: boolean;
  t: (key: string) => string;
  onClose: () => void;
}) {
  const progress = useSharedValue(0);

  React.useEffect(() => {
    progress.value = 0;

    progress.value = withTiming(1, {
      duration: 1800,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
  }, [badge.id, progress]);

  const shellStyle = useAnimatedStyle(() => {
    const scale = interpolate(
      progress.value,
      [0, 0.12, 0.39, 0.57, 0.82, 1],
      [0.965, 1, 1, 1.02, 1.02, 1],
    );
    const lift = interpolate(progress.value, [0, 0.12, 0.57, 0.82, 1], [6, 0, -1, -1, 0]);

    return {
      transform: [{ translateY: lift }, { scale }],
    };
  });

  const frontFaceStyle = useAnimatedStyle(() => {
    const rotate = interpolate(
      progress.value,
      [0, 0.14, 0.39, 0.57, 0.82, 0.93, 1],
      [0, 0, 88, -88, -88, 0, 0],
    );
    const opacity = interpolate(
      progress.value,
      [0, 0.16, 0.39, 0.59, 0.82, 0.91, 1],
      [1, 1, 0, 0, 0, 1, 1],
    );

    return {
      opacity,
      transform: [{ perspective: 1400 }, { rotateY: `${rotate}deg` }],
    };
  });

  const backFaceStyle = useAnimatedStyle(() => {
    const rotate = interpolate(
      progress.value,
      [0, 0.32, 0.5, 0.57, 0.82, 0.93, 1],
      [-92, -92, 0, 0, 0, 92, 92],
    );
    const opacity = interpolate(
      progress.value,
      [0, 0.34, 0.5, 0.59, 0.82, 0.91, 1],
      [0, 0, 1, 1, 1, 0, 0],
    );

    return {
      opacity,
      transform: [{ perspective: 1400 }, { rotateY: `${rotate}deg` }],
    };
  });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          justifyContent: "center",
          alignItems: "center",
        }}
        onPress={onClose}
      >
        <Pressable
          style={{
            backgroundColor: "#1f2542",
            borderRadius: 24,
            paddingHorizontal: 32,
            paddingVertical: 32,
            alignItems: "center",
            gap: 16,
            width: "80%",
            maxWidth: 320,
            borderWidth: 1,
            borderColor: "rgba(242,217,162,0.14)",
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.15,
            shadowRadius: 24,
            elevation: 10,
          }}
          onPress={() => {}}
        >
          {/* Front/back flip badge */}
          <Animated.View
            renderToHardwareTextureAndroid
            shouldRasterizeIOS
            style={{
              width: 120,
              height: 120,
            }}
          >
            <Animated.View
              renderToHardwareTextureAndroid
              shouldRasterizeIOS
              style={[
                {
                  position: "absolute",
                  top: 0,
                  right: 0,
                  bottom: 0,
                  left: 0,
                },
                shellStyle,
              ]}
            >
              <Animated.View
                renderToHardwareTextureAndroid
                shouldRasterizeIOS
                style={[
                  {
                    position: "absolute",
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                    alignItems: "center",
                    justifyContent: "center",
                    backfaceVisibility: "hidden",
                  },
                  frontFaceStyle,
                ]}
              >
                <BadgeIconMobile badge={badge} isEarned size={120} />
              </Animated.View>
              <Animated.View
                renderToHardwareTextureAndroid
                shouldRasterizeIOS
                style={[
                  {
                    position: "absolute",
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                    alignItems: "center",
                    justifyContent: "center",
                    backfaceVisibility: "hidden",
                  },
                  backFaceStyle,
                ]}
              >
                <BadgeBackIconMobile badge={badge} isEarned size={120} />
              </Animated.View>
            </Animated.View>
          </Animated.View>

          {/* Title */}
          <Text
            style={{
              fontSize: 20,
              fontWeight: "700",
              color: "#f3dfb1",
              marginTop: 4,
              textAlign: "center",
            }}
          >
            {t(`stats.desktop.badge_${badge.id}_title`)}
          </Text>

          {/* Description */}
          <Text
            style={{
              fontSize: 14,
              color: "rgba(244, 228, 186, 0.68)",
              textAlign: "center",
              lineHeight: 20,
            }}
          >
            {t(`stats.desktop.badge_${badge.id}_desc`)}
          </Text>

          {/* Status pill */}
          <View
            style={{
              paddingHorizontal: 20,
              paddingVertical: 8,
              borderRadius: 16,
              backgroundColor: isEarned ? "rgba(242, 217, 162, 0.14)" : "rgba(255,255,255,0.08)",
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: "600",
                color: isEarned ? "#f1d49d" : "rgba(255,255,255,0.52)",
              }}
            >
              {isEarned ? t("stats.desktop.badgeEarnedOn") : t("stats.desktop.badgeNotEarned")}
            </Text>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
