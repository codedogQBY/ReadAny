/**
 * Shared sync store — manages sync configuration and state for multiple backends.
 * Supports WebDAV, S3, and LAN sync.
 * Used by both desktop (Tauri) and mobile (Expo).
 */

import { create } from "zustand";
import { emitLibraryChanged } from "../events/library-events";
import { getPlatformService } from "../services/platform";
import type { S3Config, SyncConfig, WebDavConfig } from "../sync/sync-backend";
import {
  DEFAULT_SYNC_CONFIG,
  DEFAULT_WEBDAV_REMOTE_ROOT,
  SYNC_CONFIG_KEY,
  SYNC_SECRET_KEYS,
} from "../sync/sync-backend";
import type { ISyncBackend } from "../sync/sync-backend";
import { createSyncBackend, getSecretKeyForBackend } from "../sync/sync-backend-factory";
import { sanitizeWebDavRemoteRoot, sanitizeWebDavUrl } from "../sync/webdav-client";
import type {
  SyncDirection,
  SyncProgress,
  SyncResult,
  SyncStatusType,
} from "../sync/sync-types";
import { eventBus } from "../utils/event-bus";

let activeSyncPromise: Promise<SyncResult | null> | null = null;
const SYNC_RUNTIME_STATE_KEY = "sync_runtime_state";

interface PersistedSyncRuntimeState {
  lastSyncAt: number | null;
  lastResult: SyncResult | null;
}

function runWithSyncLock(task: () => Promise<SyncResult | null>): Promise<SyncResult | null> {
  if (activeSyncPromise) return activeSyncPromise;

  activeSyncPromise = task().finally(() => {
    activeSyncPromise = null;
  });

  return activeSyncPromise;
}

async function flushPendingReadingSession(): Promise<void> {
  try {
    const { useReadingSessionStore } = await import("./reading-session-store");
    console.log("[SyncStore] Flushing pending reading session before sync...");
    await useReadingSessionStore.getState().saveCurrentSession();
    console.log("[SyncStore] Pending reading session flushed.");
  } catch (error) {
    console.warn("[SyncStore] Failed to flush reading session before sync:", error);
  }
}

function notifyLibraryStateChanged(): void {
  try {
    emitLibraryChanged();
  } catch (error) {
    console.warn("[SyncStore] Failed to notify library refresh after sync:", error);
  }
}

function notifySyncCompleted(timestamp: number): void {
  try {
    eventBus.emit("sync:completed", { timestamp });
  } catch (error) {
    console.warn("[SyncStore] Failed to emit sync completion event:", error);
  }
}

async function loadPersistedSyncRuntimeState(): Promise<PersistedSyncRuntimeState> {
  try {
    const platform = getPlatformService();
    const raw = await platform.kvGetItem(SYNC_RUNTIME_STATE_KEY);
    if (!raw) {
      return { lastSyncAt: null, lastResult: null };
    }

    const parsed = JSON.parse(raw) as PersistedSyncRuntimeState;
    return {
      lastSyncAt: typeof parsed.lastSyncAt === "number" ? parsed.lastSyncAt : null,
      lastResult: parsed.lastResult ?? null,
    };
  } catch {
    return { lastSyncAt: null, lastResult: null };
  }
}

async function persistSyncRuntimeState(state: PersistedSyncRuntimeState): Promise<void> {
  try {
    const platform = getPlatformService();
    await platform.kvSetItem(SYNC_RUNTIME_STATE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("[SyncStore] Failed to persist sync runtime state:", error);
  }
}

export interface SyncState {
  // Config
  config: SyncConfig | null;
  isConfigured: boolean;
  backendType: "webdav" | "s3" | "lan" | null;

  // Runtime state
  status: SyncStatusType;
  lastSyncAt: number | null;
  lastResult: SyncResult | null;
  error: string | null;
  progress: SyncProgress | null;

  // Conflict resolution
  pendingDirection: SyncDirection | null;

  // Actions
  loadConfig: () => Promise<void>;

  // WebDAV actions
  saveWebDavConfig: (
    url: string,
    username: string,
    password: string,
    allowInsecure?: boolean,
    remoteRoot?: string,
  ) => Promise<void>;
  testWebDavConnection: (
    url: string,
    username: string,
    password: string,
    allowInsecure?: boolean,
    remoteRoot?: string,
  ) => Promise<boolean>;

  // S3 actions
  saveS3Config: (
    config: Omit<
      S3Config,
      "type" | "autoSync" | "syncIntervalMins" | "wifiOnly" | "notifyOnComplete"
    >,
    secretAccessKey: string,
  ) => Promise<void>;
  testS3Connection: (
    config: Omit<
      S3Config,
      "type" | "autoSync" | "syncIntervalMins" | "wifiOnly" | "notifyOnComplete"
    >,
    secretAccessKey: string,
  ) => Promise<boolean>;

  // Sync actions
  syncNow: (
    resolvedDirection?: "upload" | "download",
    useIncremental?: boolean,
  ) => Promise<SyncResult | null>;
  /** Run sync using an explicitly provided backend (e.g. for LAN sync) */
  syncWithBackend: (
    backend: ISyncBackend,
    resolvedDirection?: "upload" | "download",
    useIncremental?: boolean,
  ) => Promise<SyncResult | null>;
  /** New simplified sync (JSON-based, no full db file sync) */
  syncSimple: (backend: ISyncBackend) => Promise<SyncResult | null>;
  forceFullSync: (direction: "upload" | "download") => Promise<SyncResult | null>;
  setAutoSync: (enabled: boolean) => Promise<void>;
  setSyncIntervalMins: (minutes: number) => Promise<void>;
  setWifiOnly: (enabled: boolean) => Promise<void>;
  setNotifyOnComplete: (enabled: boolean) => Promise<void>;
  resetSync: () => Promise<void>;
}

function normalizeSyncConfig(config: SyncConfig): SyncConfig {
  if (config.type === "webdav") {
    return {
      ...config,
      url: sanitizeWebDavUrl(config.url),
      username: config.username.trim(),
      remoteRoot:
        sanitizeWebDavRemoteRoot(config.remoteRoot ?? DEFAULT_WEBDAV_REMOTE_ROOT)
        || DEFAULT_WEBDAV_REMOTE_ROOT,
    };
  }
  return config;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  config: null,
  isConfigured: false,
  backendType: null,
  status: "idle",
  lastSyncAt: null,
  lastResult: null,
  error: null,
  progress: null,
  pendingDirection: null,

  loadConfig: async () => {
    try {
      const platform = getPlatformService();
      const configStr = await platform.kvGetItem(SYNC_CONFIG_KEY);
      console.log(`[SyncStore] loadConfig: configStr = ${configStr ? "found" : "not found"}`);
      if (configStr) {
        const parsedConfig = JSON.parse(configStr) as SyncConfig;
        const normalizedConfig = normalizeSyncConfig(parsedConfig);
        if (JSON.stringify(parsedConfig) !== JSON.stringify(normalizedConfig)) {
          await platform.kvSetItem(SYNC_CONFIG_KEY, JSON.stringify(normalizedConfig));
        }
        const config =
          normalizedConfig.type === "webdav" || normalizedConfig.type === "s3"
            ? ({ ...DEFAULT_SYNC_CONFIG, ...normalizedConfig } as SyncConfig)
            : normalizedConfig;
        const secretKey = config.type !== "lan" ? getSecretKeyForBackend(config.type) : null;
        const secret = secretKey ? await platform.kvGetItem(secretKey) : null;
        console.log(
          `[SyncStore] loadConfig: secretKey = ${secretKey}, secret = ${secret ? "found" : "not found"}`,
        );

        const isConfigured =
          config.type === "lan"
            ? true
            : !!(
                secret &&
                ((config.type === "webdav" && config.url && config.username) ||
                  (config.type === "s3" && config.endpoint && config.bucket && config.accessKeyId))
              );

        console.log(
          `[SyncStore] loadConfig: isConfigured = ${isConfigured}, backendType = ${config.type}`,
        );
        const runtimeState = await loadPersistedSyncRuntimeState();
        set({
          config,
          isConfigured,
          backendType: config.type,
          lastSyncAt: runtimeState.lastSyncAt,
          lastResult: runtimeState.lastResult,
        });
      } else {
        const runtimeState = await loadPersistedSyncRuntimeState();
        set({
          lastSyncAt: runtimeState.lastSyncAt,
          lastResult: runtimeState.lastResult,
        });
      }
    } catch (e) {
      console.error("[SyncStore] loadConfig error:", e);
    }
  },

  saveWebDavConfig: async (url, username, password, allowInsecure, remoteRoot) => {
    const platform = getPlatformService();
    const existing = get().config;
    const config: WebDavConfig = {
      type: "webdav",
      url: sanitizeWebDavUrl(url),
      username: username.trim(),
      remoteRoot:
        sanitizeWebDavRemoteRoot(
          remoteRoot ?? (existing as WebDavConfig)?.remoteRoot ?? DEFAULT_WEBDAV_REMOTE_ROOT,
        ) || DEFAULT_WEBDAV_REMOTE_ROOT,
      allowInsecure: allowInsecure ?? (existing as WebDavConfig)?.allowInsecure ?? false,
      autoSync: (existing as WebDavConfig)?.autoSync ?? DEFAULT_SYNC_CONFIG.autoSync,
      syncIntervalMins:
        (existing as WebDavConfig)?.syncIntervalMins ?? DEFAULT_SYNC_CONFIG.syncIntervalMins,
      wifiOnly: (existing as WebDavConfig)?.wifiOnly ?? DEFAULT_SYNC_CONFIG.wifiOnly,
      notifyOnComplete:
        (existing as WebDavConfig)?.notifyOnComplete ?? DEFAULT_SYNC_CONFIG.notifyOnComplete,
    };
    console.log(`[SyncStore] saveWebDavConfig: saving config and password...`);
    console.log(
      `[SyncStore] saveWebDavConfig: SYNC_CONFIG_KEY = "${SYNC_CONFIG_KEY}", SYNC_SECRET_KEYS.webdav = "${SYNC_SECRET_KEYS.webdav}"`,
    );
    await platform.kvSetItem(SYNC_CONFIG_KEY, JSON.stringify(config));
    await platform.kvSetItem(SYNC_SECRET_KEYS.webdav, password);

    // Verify save
    const savedPassword = await platform.kvGetItem(SYNC_SECRET_KEYS.webdav);
    console.log(
      `[SyncStore] saveWebDavConfig: password verification = ${savedPassword ? "SUCCESS" : "FAILED"}`,
    );

    set({ config, isConfigured: true, backendType: "webdav" });
  },

  testWebDavConnection: async (url, username, password, allowInsecure, remoteRoot) => {
    const backend = createSyncBackend(
      {
        type: "webdav",
        url: sanitizeWebDavUrl(url),
        username: username.trim(),
        remoteRoot:
          sanitizeWebDavRemoteRoot(remoteRoot ?? DEFAULT_WEBDAV_REMOTE_ROOT)
          || DEFAULT_WEBDAV_REMOTE_ROOT,
        allowInsecure: allowInsecure ?? false,
        autoSync: false,
        syncIntervalMins: DEFAULT_SYNC_CONFIG.syncIntervalMins,
        wifiOnly: DEFAULT_SYNC_CONFIG.wifiOnly,
        notifyOnComplete: DEFAULT_SYNC_CONFIG.notifyOnComplete,
      },
      password,
    );
    return backend.testConnection();
  },

  saveS3Config: async (s3Config, secretAccessKey) => {
    const platform = getPlatformService();
    const existing = get().config;
    const config: S3Config = {
      ...s3Config,
      type: "s3",
      autoSync: (existing as S3Config)?.autoSync ?? DEFAULT_SYNC_CONFIG.autoSync,
      syncIntervalMins:
        (existing as S3Config)?.syncIntervalMins ?? DEFAULT_SYNC_CONFIG.syncIntervalMins,
      wifiOnly: (existing as S3Config)?.wifiOnly ?? DEFAULT_SYNC_CONFIG.wifiOnly,
      notifyOnComplete:
        (existing as S3Config)?.notifyOnComplete ?? DEFAULT_SYNC_CONFIG.notifyOnComplete,
    };
    await platform.kvSetItem(SYNC_CONFIG_KEY, JSON.stringify(config));
    await platform.kvSetItem(SYNC_SECRET_KEYS.s3, secretAccessKey);
    set({ config, isConfigured: true, backendType: "s3" });
  },

  testS3Connection: async (s3Config, secretAccessKey) => {
    try {
      const config: S3Config = {
        ...s3Config,
        type: "s3",
        autoSync: false,
        syncIntervalMins: 30,
        wifiOnly: false,
        notifyOnComplete: true,
      };
      const backend = createSyncBackend(config, secretAccessKey);
      return backend.testConnection();
    } catch {
      return false;
    }
  },

  syncNow: async (_resolvedDirection, _useIncremental) => {
    const currentState = get();
    if (currentState.status !== "idle" && currentState.status !== "error") {
      return activeSyncPromise;
    }

    return runWithSyncLock(async () => {
      const state = get();
      if (!state.isConfigured || !state.config) {
        set({ error: "Sync not configured" });
        return null;
      }

      const platform = getPlatformService();
      const secretKey =
        state.config.type !== "lan" ? getSecretKeyForBackend(state.config.type) : null;
      const secret = secretKey ? await platform.kvGetItem(secretKey) : null;

      if (state.config.type !== "lan" && !secret) {
        set({ error: "No credentials configured" });
        return null;
      }

      if (state.config.type !== "lan" && "wifiOnly" in state.config && state.config.wifiOnly) {
        if (platform.isOnWifi) {
          const isWifi = await platform.isOnWifi();
          if (!isWifi) {
            set({ error: "Sync skipped: WiFi-only mode is enabled and device is not on WiFi" });
            return null;
          }
        }
      }

      try {
        await flushPendingReadingSession();
        set({ status: "checking", error: null, pendingDirection: null });
        const backend = createSyncBackend(state.config, secret || "");

        const connected = await backend.testConnection();
        if (!connected) {
          const connectionError = "无法连接到同步服务器，请检查网络和凭据";
          const result: SyncResult = {
            success: false,
            direction: "none",
            filesUploaded: 0,
            filesDownloaded: 0,
            durationMs: 0,
            error: connectionError,
          };
          set({
            status: "error",
            error: connectionError,
            pendingDirection: null,
            progress: null,
            lastResult: result,
          });
          await persistSyncRuntimeState({
            lastSyncAt: get().lastSyncAt,
            lastResult: result,
          });
          return result;
        }

        set({ error: null });

        const result = await get().syncSimple(backend);
        if (!result) {
          set({ status: "idle", progress: null, pendingDirection: null });
        } else {
          await persistSyncRuntimeState({
            lastSyncAt: get().lastSyncAt,
            lastResult: get().lastResult,
          });
        }
        return result;
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        const result: SyncResult = {
          success: false,
          direction: "none",
          filesUploaded: 0,
          filesDownloaded: 0,
          durationMs: 0,
          error,
        };
        set({ status: "error", error, pendingDirection: null, progress: null, lastResult: result });
        await persistSyncRuntimeState({
          lastSyncAt: get().lastSyncAt,
          lastResult: result,
        });
        return result;
      }
    });
  },

  syncWithBackend: async (backend, _resolvedDirection, _useIncremental = true) => {
    const state = get();
    if (state.status !== "idle" && state.status !== "error") {
      return activeSyncPromise;
    }

    return runWithSyncLock(async () => {
      try {
        await flushPendingReadingSession();
        set({ status: "checking", error: null, pendingDirection: null });
        const result = await get().syncSimple(backend);
        if (!result) {
          set({ status: "idle", progress: null, pendingDirection: null });
        } else {
          await persistSyncRuntimeState({
            lastSyncAt: get().lastSyncAt,
            lastResult: get().lastResult,
          });
        }
        return result;
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        const result: SyncResult = {
          success: false,
          direction: "none",
          filesUploaded: 0,
          filesDownloaded: 0,
          durationMs: 0,
          error,
        };
        set({ status: "error", error, pendingDirection: null, progress: null, lastResult: result });
        await persistSyncRuntimeState({
          lastSyncAt: get().lastSyncAt,
          lastResult: result,
        });
        return result;
      }
    });
  },

  syncSimple: async (backend: ISyncBackend) => {
    const state = get();
    // syncSimple is usually entered right after a successful connection check,
    // so allow both "idle" and "checking" as valid entry states.
    if (state.status !== "idle" && state.status !== "checking") return null;

    set({ status: "syncing-files", error: null, progress: null });

    try {
      const { runSimpleSync } = await import("../sync/simple-sync");

      const receiveOnly = backend.type === "lan";
      const result = await runSimpleSync(
        backend,
        (progress) => {
          set({
            progress: {
              phase: progress.phase,
              operation: progress.operation,
              completedFiles: 0,
              totalFiles: 1,
              message: progress.message,
            },
          });
        },
        receiveOnly ? { receiveOnly: true } : undefined,
      );

      if (result.success) {
        const syncedAt = Date.now();
        const direction = receiveOnly ? ("download" as const) : ("upload" as const);
        set({
          status: "idle",
          lastSyncAt: syncedAt,
          lastResult: {
            success: true,
            direction,
            filesUploaded: result.filesUploaded,
            filesDownloaded: result.filesDownloaded,
            durationMs: 0,
          },
          error: null,
          progress: null,
        });
        notifyLibraryStateChanged();
        notifySyncCompleted(syncedAt);
        await persistSyncRuntimeState({
          lastSyncAt: syncedAt,
          lastResult: {
            success: true,
            direction,
            filesUploaded: result.filesUploaded,
            filesDownloaded: result.filesDownloaded,
            durationMs: 0,
          },
        });
      } else {
        set({
          status: "error",
          lastResult: {
            success: false,
            direction: "none",
            filesUploaded: 0,
            filesDownloaded: 0,
            durationMs: 0,
            error: result.error || "同步失败",
          },
          error: result.error || "同步失败",
          progress: null,
        });
        await persistSyncRuntimeState({
          lastSyncAt: get().lastSyncAt,
          lastResult: {
            success: false,
            direction: "none",
            filesUploaded: 0,
            filesDownloaded: 0,
            durationMs: 0,
            error: result.error || "同步失败",
          },
        });
      }

      return {
        success: result.success,
        direction: receiveOnly ? ("download" as const) : ("upload" as const),
        filesUploaded: result.filesUploaded,
        filesDownloaded: result.filesDownloaded,
        durationMs: 0,
        error: result.error,
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      set({
        status: "error",
        lastResult: {
          success: false,
          direction: "none",
          filesUploaded: 0,
          filesDownloaded: 0,
          durationMs: 0,
          error,
        },
        error,
        progress: null,
      });
      await persistSyncRuntimeState({
        lastSyncAt: get().lastSyncAt,
        lastResult: {
          success: false,
          direction: "none",
          filesUploaded: 0,
          filesDownloaded: 0,
          durationMs: 0,
          error,
        },
      });
      return {
        success: false,
        direction: "none" as const,
        filesUploaded: 0,
        filesDownloaded: 0,
        durationMs: 0,
        error,
      };
    }
  },

  forceFullSync: async (direction) => {
    const state = get();
    if (state.status !== "idle" && state.status !== "error") {
      return activeSyncPromise;
    }
    if (!state.isConfigured || !state.config) {
      set({ error: "Sync not configured" });
      return null;
    }

    const platform = getPlatformService();
    const secretKey =
      state.config.type !== "lan" ? getSecretKeyForBackend(state.config.type) : null;
    const secret = secretKey ? await platform.kvGetItem(secretKey) : null;

    if (state.config.type !== "lan" && !secret) {
      set({ error: "No credentials configured" });
      return null;
    }

    if (state.config.type !== "lan" && "wifiOnly" in state.config && state.config.wifiOnly) {
      if (platform.isOnWifi) {
        const isWifi = await platform.isOnWifi();
        if (!isWifi) {
          set({ error: "Sync skipped: WiFi-only mode is enabled and device is not on WiFi" });
          return null;
        }
      }
    }

    const config = state.config;

    return runWithSyncLock(async () => {
      try {
        await flushPendingReadingSession();
        set({ status: "checking", error: null, pendingDirection: null, progress: null });
        const backend = createSyncBackend(config, secret || "");
        const connected = await backend.testConnection();

        if (!connected) {
          const connectionError = "无法连接到同步服务器，请检查网络和凭据";
          const result: SyncResult = {
            success: false,
            direction: "none",
            filesUploaded: 0,
            filesDownloaded: 0,
            durationMs: 0,
            error: connectionError,
          };
          set({
            status: "error",
            error: connectionError,
            pendingDirection: null,
            progress: null,
            lastResult: result,
          });
          await persistSyncRuntimeState({
            lastSyncAt: get().lastSyncAt,
            lastResult: result,
          });
          return result;
        }

        const { runSimpleSync } = await import("../sync/simple-sync");

        set({ status: "syncing-files", error: null, progress: null });

        const receiveOnly = direction === "download";
        const startTime = Date.now();
        const simpleResult = await runSimpleSync(
          backend,
          (progress) => {
            set({
              status: "syncing-files",
              progress: {
                phase: progress.phase,
                operation: progress.operation,
                completedFiles: 0,
                totalFiles: 1,
                message: progress.message,
              },
            });
          },
          {
            receiveOnly,
            forceApply: receiveOnly,
            fileSyncOptions:
              direction === "upload"
                ? { forceUploadAll: true }
                : {
                    forceDownloadAll: true,
                    downloadRemoteBooks: true,
                    disableUploads: true,
                    disableRemoteDeletes: true,
                  },
          },
        );

        const result: SyncResult = {
          success: simpleResult.success,
          direction,
          filesUploaded: simpleResult.filesUploaded,
          filesDownloaded: simpleResult.filesDownloaded,
          durationMs: Date.now() - startTime,
          error: simpleResult.error,
        };

        notifyLibraryStateChanged();

        if (result.success) {
          const syncedAt = Date.now();
          set({
            status: "idle",
            lastSyncAt: syncedAt,
            lastResult: result,
            error: null,
            progress: null,
            pendingDirection: null,
          });
          notifySyncCompleted(syncedAt);
          await persistSyncRuntimeState({
            lastSyncAt: syncedAt,
            lastResult: result,
          });
        } else {
          set({
            status: "error",
            lastResult: result,
            error: result.error || "同步失败",
            progress: null,
            pendingDirection: null,
          });
          await persistSyncRuntimeState({
            lastSyncAt: get().lastSyncAt,
            lastResult: result,
          });
        }

        return result;
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        const result: SyncResult = {
          success: false,
          direction,
          filesUploaded: 0,
          filesDownloaded: 0,
          durationMs: 0,
          error,
        };
        set({
          status: "error",
          lastResult: result,
          error,
          progress: null,
          pendingDirection: null,
        });
        await persistSyncRuntimeState({
          lastSyncAt: get().lastSyncAt,
          lastResult: result,
        });
        return result;
      }
    });
  },

  setAutoSync: async (enabled) => {
    const state = get();
    if (!state.config) return;
    const config = { ...state.config, autoSync: enabled };
    const platform = getPlatformService();
    await platform.kvSetItem(SYNC_CONFIG_KEY, JSON.stringify(config));
    set({ config });
  },

  setSyncIntervalMins: async (minutes) => {
    const state = get();
    if (!state.config || state.config.type === "lan") return;

    const clampedMinutes = Math.max(5, Math.min(720, Math.round(minutes || DEFAULT_SYNC_CONFIG.syncIntervalMins)));
    const config = { ...state.config, syncIntervalMins: clampedMinutes };
    const platform = getPlatformService();
    await platform.kvSetItem(SYNC_CONFIG_KEY, JSON.stringify(config));
    set({ config });
  },

  setWifiOnly: async (enabled) => {
    const state = get();
    if (!state.config) return;
    const config = { ...state.config, wifiOnly: enabled };
    const platform = getPlatformService();
    await platform.kvSetItem(SYNC_CONFIG_KEY, JSON.stringify(config));
    set({ config });
  },

  setNotifyOnComplete: async (enabled) => {
    const state = get();
    if (!state.config) return;
    const config = { ...state.config, notifyOnComplete: enabled };
    const platform = getPlatformService();
    await platform.kvSetItem(SYNC_CONFIG_KEY, JSON.stringify(config));
    set({ config });
  },

  resetSync: async () => {
    const platform = getPlatformService();
    await platform.kvRemoveItem(SYNC_CONFIG_KEY);
    await platform.kvRemoveItem(SYNC_SECRET_KEYS.webdav);
    await platform.kvRemoveItem(SYNC_SECRET_KEYS.s3);
    await platform.kvRemoveItem(SYNC_RUNTIME_STATE_KEY);
    set({
      config: null,
      isConfigured: false,
      backendType: null,
      status: "idle",
      lastSyncAt: null,
      lastResult: null,
      error: null,
      progress: null,
      pendingDirection: null,
    });
  },
}));
