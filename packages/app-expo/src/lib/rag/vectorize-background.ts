import i18n from "@readany/core/i18n";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";
import BackgroundService from "react-native-background-actions";
import {
  type BackgroundTextKey,
  type BackgroundVectorizeHandle,
  type ResultNotifierLike,
  createBackgroundVectorize,
} from "./vectorize-background-core";

export type { BackgroundVectorizeHandle };

const RESULT_CHANNEL_ID = "vectorize-result";

const TEXT: Record<BackgroundTextKey, { key: string; defaultValue: string }> = {
  title: { key: "vectorize.bgTitle", defaultValue: "Indexing books" },
  progress: {
    key: "vectorize.bgProgress",
    defaultValue: "{{title}} · {{percent}}% ({{current}}/{{total}})",
  },
  doneTitle: { key: "vectorize.bgDoneTitle", defaultValue: "Indexing finished" },
  doneBody: { key: "vectorize.bgDoneBody", defaultValue: "{{done}} of {{total}} book(s) indexed" },
  partialBody: {
    key: "vectorize.bgPartialBody",
    defaultValue:
      "{{done}} indexed, {{failed}} stopped. Open ReadAny and tap Vectorize to continue where it left off.",
  },
};

let permissionRequested = false;

const notifier: ResultNotifierLike = {
  async ensurePermission() {
    if (Platform.OS !== "android" || permissionRequested) return;
    permissionRequested = true;
    try {
      // Android 13+ only shows the permission prompt once a channel exists.
      await Notifications.setNotificationChannelAsync(RESULT_CHANNEL_ID, {
        name: i18n.t("vectorize.bgChannel", { defaultValue: "Indexing results" }),
        importance: Notifications.AndroidImportance.DEFAULT,
      });
      const current = await Notifications.getPermissionsAsync();
      if (!current.granted && current.canAskAgain) await Notifications.requestPermissionsAsync();
    } catch (err) {
      console.warn("[VectorizeBackground] Notification permission request failed:", err);
    }
  },
  async notify(title, body) {
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: { channelId: RESULT_CHANNEL_ID },
    });
  },
};

const background = createBackgroundVectorize({
  isAndroid: Platform.OS === "android",
  service: BackgroundService,
  notifier,
  text: (key, params) => i18n.t(TEXT[key].key, { defaultValue: TEXT[key].defaultValue, ...params }),
  isAppForeground: () => AppState.currentState === "active",
});

/**
 * Call when a vectorization queue starts and `release()` it when the queue is empty.
 * While at least one caller holds it, the app keeps running with the screen off and shows
 * a progress notification. Resolves to a no-op handle where that is not possible.
 */
export const acquireBackgroundVectorize = background.acquire;
