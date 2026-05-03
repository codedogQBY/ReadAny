import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IPlatformService } from "../services/platform";
import type { ISyncBackend, SyncConfig } from "../sync/sync-backend";
import type { SyncResult } from "../sync/sync-types";

const mockPlatformService = vi.hoisted(() => ({
  platformType: "desktop" as const,
  isMobile: false,
  isDesktop: true,
  kvGetItem: vi.fn(),
  kvSetItem: vi.fn(),
  kvRemoveItem: vi.fn(),
  kvGetAllKeys: vi.fn(),
  isOnWifi: vi.fn(),
}));

const mockBackend = vi.hoisted(() => ({
  type: "webdav" as const,
  testConnection: vi.fn<() => Promise<boolean>>(),
  getJSON: vi.fn<() => Promise<unknown>>(),
}));

const mockLanBackend = vi.hoisted(() => ({
  type: "lan" as const,
  getJSON: vi.fn<() => Promise<unknown>>(),
}));

const factoryMocks = vi.hoisted(() => ({
  createSyncBackend: vi.fn(() => mockBackend),
  getSecretKeyForBackend: vi.fn((type: "webdav" | "s3") =>
    type === "webdav" ? "sync_webdav_password" : "sync_s3_secret_key",
  ),
}));

const syncMocks = vi.hoisted(() => ({
  runSimpleSync: vi.fn(),
  syncFiles: vi.fn(),
}));

const libraryEventMocks = vi.hoisted(() => ({
  emitLibraryChanged: vi.fn(),
}));

const readingSessionMocks = vi.hoisted(() => ({
  useReadingSessionStore: {
    getState: vi.fn(() => ({
      saveCurrentSession: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

vi.mock("../services/platform", () => ({
  getPlatformService: () => mockPlatformService as unknown as IPlatformService,
}));

vi.mock("../sync/sync-backend-factory", () => factoryMocks);
vi.mock("../sync/simple-sync", () => syncMocks);
vi.mock("../sync/sync-files", () => syncMocks);
vi.mock("../events/library-events", () => libraryEventMocks);
vi.mock("./reading-session-store", () => readingSessionMocks);

const { useSyncStore } = await import("./sync-store");
const { eventBus } = await import("../utils/event-bus");

const baseConfig: SyncConfig = {
  type: "webdav",
  url: "http://example.com",
  username: "alice",
  remoteRoot: "readany",
  autoSync: false,
  syncIntervalMins: 30,
  wifiOnly: false,
  notifyOnComplete: true,
};

function resetSyncStore() {
  useSyncStore.setState({
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
}

function getWebDavConfigFromState() {
  const config = useSyncStore.getState().config;
  expect(config?.type).toBe("webdav");
  if (!config || config.type !== "webdav") {
    throw new Error("Expected a WebDAV sync config in store state");
  }
  return config;
}

describe("useSyncStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSyncStore();
    mockPlatformService.kvGetItem.mockResolvedValue(null);
    mockPlatformService.kvSetItem.mockResolvedValue(undefined);
    mockPlatformService.kvRemoveItem.mockResolvedValue(undefined);
    mockPlatformService.kvGetAllKeys.mockResolvedValue([]);
    mockPlatformService.isOnWifi.mockResolvedValue(true);
    factoryMocks.createSyncBackend.mockReturnValue(mockBackend);
    mockBackend.testConnection.mockResolvedValue(true);
    mockBackend.getJSON.mockResolvedValue(null);
    mockLanBackend.getJSON.mockResolvedValue({
      lastModifiedAt: 123,
      uploadedBy: "ReadAny Desktop",
      appVersion: "1.0.0",
      schemaVersion: 1,
    });
    syncMocks.runSimpleSync.mockResolvedValue({
      success: true,
      filesUploaded: 2,
      filesDownloaded: 1,
    });
    syncMocks.syncFiles.mockResolvedValue({
      filesUploaded: 0,
      filesDownloaded: 0,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads config and restores persisted runtime state", async () => {
    mockPlatformService.kvGetItem.mockImplementation(async (key: string) => {
      if (key === "sync_config") {
        return JSON.stringify(baseConfig);
      }
      if (key === "sync_webdav_password") {
        return "secret";
      }
      if (key === "sync_runtime_state") {
        return JSON.stringify({
          lastSyncAt: 1234,
          lastResult: {
            success: true,
            direction: "upload",
            filesUploaded: 1,
            filesDownloaded: 0,
            durationMs: 5,
          },
        });
      }
      return null;
    });

    await useSyncStore.getState().loadConfig();

    expect(useSyncStore.getState()).toMatchObject({
      config: baseConfig,
      isConfigured: true,
      backendType: "webdav",
      lastSyncAt: 1234,
      lastResult: {
        success: true,
        direction: "upload",
        filesUploaded: 1,
        filesDownloaded: 0,
        durationMs: 5,
      },
    });
  });

  it("saves WebDAV config and secret", async () => {
    mockPlatformService.kvGetItem.mockResolvedValue("saved-secret");

    await useSyncStore
      .getState()
      .saveWebDavConfig("http://example.com///", "alice", "password", true);

    const savedConfigCall = mockPlatformService.kvSetItem.mock.calls.find(
      ([key]) => key === "sync_config",
    );
    expect(savedConfigCall).toBeTruthy();
    expect(JSON.parse(savedConfigCall?.[1] as string)).toEqual({
      ...baseConfig,
      allowInsecure: true,
    });
    expect(mockPlatformService.kvSetItem).toHaveBeenCalledWith("sync_webdav_password", "password");
    expect(useSyncStore.getState()).toMatchObject({
      isConfigured: true,
      backendType: "webdav",
      config: {
        ...baseConfig,
        allowInsecure: true,
      },
    });
  });

  it("sanitizes WebDAV URL control characters when saving config", async () => {
    mockPlatformService.kvGetItem.mockResolvedValue("saved-secret");

    await useSyncStore
      .getState()
      .saveWebDavConfig("https://dav.example.com/root/\n", "alice", "password", false);

    const savedConfigCall = mockPlatformService.kvSetItem.mock.calls.find(
      ([key]) => key === "sync_config",
    );
    expect(savedConfigCall).toBeTruthy();
    expect(JSON.parse(savedConfigCall?.[1] as string)).toMatchObject({
      type: "webdav",
      url: "https://dav.example.com/root",
      username: "alice",
      remoteRoot: "readany",
    });
  });

  it("saves custom WebDAV remote root and trims nested path", async () => {
    mockPlatformService.kvGetItem.mockResolvedValue("saved-secret");

    await useSyncStore
      .getState()
      .saveWebDavConfig(
        "https://dav.example.com/root/",
        "alice",
        "password",
        false,
        " /apps//readany-sync/ ",
      );

    const savedConfigCall = mockPlatformService.kvSetItem.mock.calls.find(
      ([key]) => key === "sync_config",
    );
    expect(savedConfigCall).toBeTruthy();
    expect(JSON.parse(savedConfigCall?.[1] as string)).toMatchObject({
      type: "webdav",
      url: "https://dav.example.com/root",
      username: "alice",
      remoteRoot: "apps/readany-sync",
    });
  });

  it("sanitizes persisted WebDAV URL when loading config", async () => {
    mockPlatformService.kvGetItem.mockImplementation(async (key: string) => {
      if (key === "sync_config") {
        return JSON.stringify({
          ...baseConfig,
          url: "https://dav.example.com/root/\n",
        } satisfies SyncConfig);
      }
      if (key === "sync_webdav_password") {
        return "password";
      }
      return null;
    });

    await useSyncStore.getState().loadConfig();

    expect(getWebDavConfigFromState().url).toBe("https://dav.example.com/root");
    expect(useSyncStore.getState().isConfigured).toBe(true);
  });

  it("clamps sync interval updates to the supported range", async () => {
    useSyncStore.setState({
      config: baseConfig,
      isConfigured: true,
      backendType: "webdav",
    });

    await useSyncStore.getState().setSyncIntervalMins(1);
    expect(getWebDavConfigFromState().syncIntervalMins).toBe(5);

    await useSyncStore.getState().setSyncIntervalMins(999);
    expect(getWebDavConfigFromState().syncIntervalMins).toBe(720);
  });

  it("syncSimple success updates runtime state and emits completion", async () => {
    const emitSpy = vi.spyOn(eventBus, "emit");

    const result = await useSyncStore.getState().syncSimple(mockBackend as unknown as ISyncBackend);

    expect(result).toMatchObject({
      success: true,
      direction: "upload",
      filesUploaded: 2,
      filesDownloaded: 1,
    });
    expect(useSyncStore.getState().status).toBe("idle");
    expect(useSyncStore.getState().lastSyncAt).toEqual(expect.any(Number));
    expect(useSyncStore.getState().lastResult).toMatchObject({
      success: true,
      direction: "upload",
      filesUploaded: 2,
      filesDownloaded: 1,
    });
    expect(libraryEventMocks.emitLibraryChanged).toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith(
      "sync:completed",
      expect.objectContaining({ timestamp: expect.any(Number) }),
    );
    expect(mockPlatformService.kvSetItem).toHaveBeenCalledWith(
      "sync_runtime_state",
      expect.any(String),
    );
  });

  it("syncWithBackend uses incremental receive-only flow for LAN import", async () => {
    const emitSpy = vi.spyOn(eventBus, "emit");
    syncMocks.runSimpleSync.mockResolvedValue({
      success: true,
      changes: 5,
      filesUploaded: 0,
      filesDownloaded: 4,
    });

    const result = await useSyncStore
      .getState()
      .syncWithBackend(mockLanBackend as unknown as ISyncBackend);

    expect(syncMocks.runSimpleSync).toHaveBeenCalledWith(mockLanBackend, expect.any(Function), {
      receiveOnly: true,
    });
    expect(result).toMatchObject({
      success: true,
      direction: "download",
      filesDownloaded: 4,
    });
    expect(useSyncStore.getState().status).toBe("idle");
    expect(useSyncStore.getState().lastResult).toMatchObject({
      success: true,
      direction: "download",
      filesDownloaded: 4,
    });
    expect(libraryEventMocks.emitLibraryChanged).toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith(
      "sync:completed",
      expect.objectContaining({ timestamp: expect.any(Number) }),
    );
  });

  it("forceFullSync download keeps file transfer receive-only", async () => {
    useSyncStore.setState({
      config: baseConfig,
      isConfigured: true,
      backendType: "webdav",
    });
    mockPlatformService.kvGetItem.mockImplementation(async (key: string) =>
      key === "sync_webdav_password" ? "secret" : null,
    );
    syncMocks.runSimpleSync.mockResolvedValue({
      success: true,
      changes: 2,
      filesUploaded: 0,
      filesDownloaded: 3,
    });

    const result = await useSyncStore.getState().forceFullSync("download");

    expect(syncMocks.runSimpleSync).toHaveBeenCalledWith(mockBackend, expect.any(Function), {
      receiveOnly: true,
      forceApply: true,
      fileSyncOptions: {
        forceDownloadAll: true,
        downloadRemoteBooks: true,
        disableUploads: true,
        disableRemoteDeletes: true,
      },
    });
    expect(syncMocks.syncFiles).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      direction: "download",
      filesUploaded: 0,
      filesDownloaded: 3,
    });
  });

  it("syncNow returns a connection error when backend test fails", async () => {
    useSyncStore.setState({
      config: baseConfig,
      isConfigured: true,
      backendType: "webdav",
    });
    mockPlatformService.kvGetItem.mockImplementation(async (key: string) =>
      key === "sync_webdav_password" ? "secret" : null,
    );
    mockBackend.testConnection.mockResolvedValue(false);

    const result = await useSyncStore.getState().syncNow();

    expect(result).toEqual({
      success: false,
      direction: "none",
      filesUploaded: 0,
      filesDownloaded: 0,
      durationMs: 0,
      error: "无法连接到同步服务器，请检查网络和凭据",
    });
    expect(useSyncStore.getState().status).toBe("error");
    expect(useSyncStore.getState().error).toBe("无法连接到同步服务器，请检查网络和凭据");
  });

  it("syncNow preserves backend connection failure details", async () => {
    useSyncStore.setState({
      config: baseConfig,
      isConfigured: true,
      backendType: "webdav",
    });
    mockPlatformService.kvGetItem.mockImplementation(async (key: string) =>
      key === "sync_webdav_password" ? "secret" : null,
    );
    mockBackend.testConnection.mockRejectedValue(
      new Error("WebDAV 认证失败，请检查用户名和应用密码是否正确。"),
    );

    const result = await useSyncStore.getState().syncNow();

    expect(result).toEqual({
      success: false,
      direction: "none",
      filesUploaded: 0,
      filesDownloaded: 0,
      durationMs: 0,
      error: "WebDAV 认证失败，请检查用户名和应用密码是否正确。",
    });
    expect(useSyncStore.getState().status).toBe("error");
    expect(useSyncStore.getState().error).toBe("WebDAV 认证失败，请检查用户名和应用密码是否正确。");
  });

  it("returns the same promise when sync is already in progress", async () => {
    useSyncStore.setState({
      config: baseConfig,
      isConfigured: true,
      backendType: "webdav",
    });
    mockPlatformService.kvGetItem.mockImplementation(async (key: string) =>
      key === "sync_webdav_password" ? "secret" : null,
    );

    let resolveSync: (value: SyncResult | null) => void = () => undefined;
    syncMocks.runSimpleSync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve;
        }),
    );

    const first = useSyncStore.getState().syncNow();
    await vi.waitFor(() => {
      expect(syncMocks.runSimpleSync).toHaveBeenCalledTimes(1);
      expect(mockBackend.testConnection).toHaveBeenCalledTimes(1);
    });

    const second = useSyncStore.getState().syncNow();

    resolveSync({
      success: true,
      direction: "upload",
      filesUploaded: 2,
      filesDownloaded: 1,
      durationMs: 0,
    });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(syncMocks.runSimpleSync).toHaveBeenCalledTimes(1);
    expect(mockBackend.testConnection).toHaveBeenCalledTimes(1);
    expect(useSyncStore.getState().status).toBe("idle");
    expect(secondResult).toEqual(firstResult);
  });

  it("resets sync config, secrets, and runtime state", async () => {
    useSyncStore.setState({
      config: baseConfig,
      isConfigured: true,
      backendType: "webdav",
      lastSyncAt: 123,
      lastResult: {
        success: true,
        direction: "upload",
        filesUploaded: 1,
        filesDownloaded: 0,
        durationMs: 1,
      },
      error: "oops",
      progress: {
        phase: "files",
        operation: "upload",
        completedFiles: 1,
        totalFiles: 2,
        message: "syncing",
      },
      pendingDirection: "upload",
    });

    await useSyncStore.getState().resetSync();

    expect(mockPlatformService.kvRemoveItem).toHaveBeenCalledWith("sync_config");
    expect(mockPlatformService.kvRemoveItem).toHaveBeenCalledWith("sync_webdav_password");
    expect(mockPlatformService.kvRemoveItem).toHaveBeenCalledWith("sync_s3_secret_key");
    expect(mockPlatformService.kvRemoveItem).toHaveBeenCalledWith("sync_runtime_state");
    expect(useSyncStore.getState()).toMatchObject({
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
  });
});
