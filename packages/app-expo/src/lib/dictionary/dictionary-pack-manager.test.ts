import type {
  ChineseDictionaryPackDescriptor,
  DictionaryLanguage,
  DictionaryManifest,
  DictionaryPackDescriptor,
  EnglishDictionaryPackDescriptor,
} from "@readany/core/dictionary";
import { describe, expect, it, vi } from "vitest";
import {
  DictionaryPackManager,
  type DictionaryPackMetadata,
  type DictionaryPackPlatform,
  type DictionaryPackStatus,
} from "./dictionary-pack-manager";

const enV1 = descriptor("en", "2026.08", "a");
const enV2 = descriptor("en", "2026.09", "b");
const zhV1 = descriptor("zh", "2026.09", "c");

function descriptor(
  language: "en",
  version: string,
  hashCharacter: string,
): EnglishDictionaryPackDescriptor;
function descriptor(
  language: "zh",
  version: string,
  hashCharacter: string,
): ChineseDictionaryPackDescriptor;
function descriptor(
  language: DictionaryLanguage,
  version: string,
  hashCharacter: string,
): DictionaryPackDescriptor {
  const shared = {
    version,
    schemaVersion: 1 as const,
    sourceDumpDate: "2026-09-01",
    sha256: hashCharacter.repeat(64),
    license: "CC BY-SA 4.0" as const,
  };
  return language === "en"
    ? {
        ...shared,
        language,
        sourceEdition: "enwiktionary",
        sizeBytes: 123,
        url: `https://example.test/en-${version}.sqlite`,
        sourceArchiveUrl: `https://example.test/en-${version}.tar.gz`,
        attributionUrl: "https://en.wiktionary.org/wiki/Wiktionary:Copyrights",
      }
    : {
        ...shared,
        language,
        sourceEdition: "zhwiktionary",
        sizeBytes: 234,
        url: `https://example.test/zh-${version}.sqlite`,
        sourceArchiveUrl: `https://example.test/zh-${version}.xml.bz2`,
        attributionUrl: "https://zh.wiktionary.org/wiki/Wiktionary:Copyrights",
      };
}

function metadataOf(pack: DictionaryPackDescriptor): DictionaryPackMetadata {
  const {
    language,
    version,
    schemaVersion,
    sourceEdition,
    sourceDumpDate,
    sourceArchiveUrl,
    url,
    attributionUrl,
    license,
  } = pack;
  return {
    language,
    version,
    schemaVersion,
    sourceEdition,
    sourceDumpDate,
    sourceArchiveUrl,
    url,
    attributionUrl,
    license,
    licenseNotice: `Complete ${license} notice.`,
    creatorAttribution: `${sourceEdition} contributors.`,
  };
}

interface MemoryFile {
  id: string;
  content: string;
  size: number;
  hash: string;
  metadata: DictionaryPackMetadata;
  validSchema: boolean;
}

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class StatefulMemoryPlatform implements DictionaryPackPlatform {
  readonly root = "/docs/dictionaries";
  readonly files = new Map<string, MemoryFile>();
  readonly events: string[] = [];
  readonly downloads = new Map<string, DictionaryPackDescriptor>([
    [enV1.url, enV1],
    [enV2.url, enV2],
    [zhV1.url, zhV1],
  ]);
  readonly downloadBarriers = new Map<string, Deferred>();
  readonly removeFaults = new Map<string, Error[]>();
  readonly metadataFaults: Array<{ path: string; id?: string; error: Error }> = [];
  downloadCalls = 0;
  downloadMutation?: (file: MemoryFile) => void;
  downloadFailure?: Error;

  async ensureDirectory(): Promise<void> {
    this.events.push("ensure-directory");
  }

  async download(url: string, path: string, onProgress: (fraction: number) => void): Promise<void> {
    this.downloadCalls += 1;
    this.events.push(`download-start:${url}`);
    onProgress(0.25);
    await this.downloadBarriers.get(url)?.promise;
    const pack = this.downloads.get(url);
    if (!pack) throw new Error(`No test pack for ${url}`);
    const file = this.file(pack, `download-${this.downloadCalls}`, `content:${pack.version}`);
    this.downloadMutation?.(file);
    this.files.set(path, file);
    if (this.downloadFailure) throw this.downloadFailure;
    onProgress(1);
    this.events.push(`download-complete:${url}`);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async size(path: string): Promise<number> {
    return this.requiredFile(path).size;
  }

  async sha256(path: string): Promise<string> {
    return this.requiredFile(path).hash;
  }

  async readMetadata(path: string): Promise<DictionaryPackMetadata> {
    const file = this.requiredFile(path);
    this.events.push(`metadata:${path}:${file.id}`);
    const faultIndex = this.metadataFaults.findIndex(
      (fault) => fault.path === path && (!fault.id || fault.id === file.id),
    );
    if (faultIndex >= 0) throw this.metadataFaults.splice(faultIndex, 1)[0].error;
    if (!file.validSchema) throw new Error(`invalid schema: ${file.id}`);
    return { ...file.metadata };
  }

  async move(from: string, to: string): Promise<void> {
    this.events.push(`move:${from}->${to}`);
    if (this.files.has(to)) throw new Error(`destination exists: ${to}`);
    const file = this.requiredFile(from);
    this.files.delete(from);
    this.files.set(to, file);
  }

  async remove(path: string): Promise<void> {
    this.events.push(`remove:${path}`);
    const faults = this.removeFaults.get(path);
    const fault = faults?.shift();
    if (fault) throw fault;
    this.files.delete(path);
  }

  put(path: string, pack: DictionaryPackDescriptor, id: string, content = `content:${id}`): void {
    this.files.set(path, this.file(pack, id, content));
  }

  pauseDownload(url: string): () => void {
    const barrier = deferred();
    this.downloadBarriers.set(url, barrier);
    return barrier.resolve;
  }

  failMetadataOnce(path: string, error: Error, id?: string): void {
    this.metadataFaults.push({ path, id, error });
  }

  private file(pack: DictionaryPackDescriptor, id: string, content: string): MemoryFile {
    return {
      id,
      content,
      size: pack.sizeBytes,
      hash: pack.sha256,
      metadata: metadataOf(pack),
      validSchema: true,
    };
  }

  private requiredFile(path: string): MemoryFile {
    const file = this.files.get(path);
    if (!file) throw new Error(`missing ${path}`);
    return file;
  }
}

function paths(platform: StatefulMemoryPlatform, language: DictionaryLanguage = "en") {
  const active = `${platform.root}/readany-dictionary-${language}.sqlite`;
  return { active, staged: `${active}.download`, backup: `${active}.backup` };
}

function closer(platform: StatefulMemoryPlatform) {
  return {
    close: vi.fn(async (language?: DictionaryLanguage) => {
      platform.events.push(`close:${language ?? "all"}`);
    }),
  };
}

function manifest(en = enV2): DictionaryManifest {
  return { manifestVersion: 1, packs: { en, zh: zhV1 } };
}

describe("DictionaryPackManager", () => {
  it("activates the exact validated staged file", async () => {
    const platform = new StatefulMemoryPlatform();
    const manager = new DictionaryPackManager(platform, platform.root, closer(platform));

    await manager.install(enV2);

    const activeFile = platform.files.get(paths(platform).active);
    expect(activeFile).toMatchObject({ id: "download-1", content: "content:2026.09" });
    expect(await manager.getInstalledDescriptor("en")).toEqual({
      ...metadataOf(enV2),
      sizeBytes: enV2.sizeBytes,
      sha256: enV2.sha256,
    });
  });

  it.each([
    [
      "size",
      (file: MemoryFile): void => {
        file.size = 1;
      },
    ],
    [
      "hash",
      (file: MemoryFile): void => {
        file.hash = "d".repeat(64);
      },
    ],
    [
      "schema",
      (file: MemoryFile): void => {
        file.validSchema = false;
      },
    ],
  ] as const)("retains the exact active file on staged %s mismatch", async (_kind, mutate) => {
    const platform = new StatefulMemoryPlatform();
    const { active, staged } = paths(platform);
    platform.put(active, enV1, "old", "trusted old bytes");
    platform.downloadMutation = mutate;
    const manager = new DictionaryPackManager(platform, platform.root, closer(platform));

    await expect(manager.install(enV2)).rejects.toThrow();

    expect(platform.files.get(active)).toMatchObject({ id: "old", content: "trusted old bytes" });
    expect(platform.files.has(staged)).toBe(false);
  });

  it("removes a partial staged file after interrupted download and permits retry", async () => {
    const platform = new StatefulMemoryPlatform();
    const { active, staged } = paths(platform);
    platform.put(active, enV1, "old", "trusted old bytes");
    platform.downloadMutation = (file) => {
      file.id = "partial";
      file.content = "partial bytes";
    };
    platform.downloadFailure = new Error("interrupted");
    const manager = new DictionaryPackManager(platform, platform.root, closer(platform));

    await expect(manager.install(enV2)).rejects.toThrow("interrupted");
    expect(platform.files.has(staged)).toBe(false);
    expect(platform.files.get(active)?.content).toBe("trusted old bytes");

    platform.downloadMutation = undefined;
    platform.downloadFailure = undefined;
    await manager.install(enV2);
    expect(platform.files.get(active)?.content).toBe("content:2026.09");
  });

  it("uses but does not move or delete the last-known-good backup during read-only discovery", async () => {
    const platform = new StatefulMemoryPlatform();
    const { active, backup } = paths(platform);
    platform.put(active, enV2, "uncommitted-new", "new bytes");
    platform.put(backup, enV1, "trusted-backup", "trusted backup bytes");
    const manager = new DictionaryPackManager(platform, platform.root, closer(platform));

    expect(await manager.getActivePath("en")).toBe(backup);

    expect(platform.files.get(active)).toMatchObject({
      id: "uncommitted-new",
      content: "new bytes",
    });
    expect(platform.files.get(backup)).toMatchObject({
      id: "trusted-backup",
      content: "trusted backup bytes",
    });
    expect(platform.events).not.toContain(`remove:${active}`);
    expect(platform.events).not.toContain(`move:${backup}->${active}`);
  });

  it("preserves staged and corrupt backup artifacts during read-only discovery", async () => {
    const platform = new StatefulMemoryPlatform();
    const { active, staged, backup } = paths(platform);
    platform.put(active, enV1, "trusted-active");
    platform.put(staged, enV2, "interrupted-download");
    platform.put(backup, enV2, "corrupt-backup");
    const corruptBackup = platform.files.get(backup);
    if (corruptBackup) corruptBackup.validSchema = false;
    const manager = new DictionaryPackManager(platform, platform.root, closer(platform));

    await expect(manager.refresh(manifest())).resolves.toMatchObject({
      en: { state: "update-available", installedVersion: enV1.version },
    });

    expect(platform.files.get(active)?.id).toBe("trusted-active");
    expect(platform.files.get(staged)?.id).toBe("interrupted-download");
    expect(platform.files.get(backup)?.id).toBe("corrupt-backup");
    expect(platform.events.filter((event) => event.startsWith("remove:"))).toEqual([]);
  });

  it.each([
    ["a corrupt backup with no active", false],
    ["corrupt active and backup files", true],
  ])("repairs %s only during an explicit install", async (_name, includeActive) => {
    const platform = new StatefulMemoryPlatform();
    const { active, backup } = paths(platform);
    platform.put(backup, enV1, "corrupt-backup");
    const corruptBackup = platform.files.get(backup);
    if (corruptBackup) corruptBackup.validSchema = false;
    if (includeActive) {
      platform.put(active, enV1, "corrupt-active");
      const corruptActive = platform.files.get(active);
      if (corruptActive) corruptActive.validSchema = false;
    }
    const manager = new DictionaryPackManager(platform, platform.root, closer(platform));

    await expect(manager.refresh(manifest())).resolves.toMatchObject({
      en: { state: "error", hasActivePack: true },
    });
    expect(platform.files.get(backup)?.id).toBe("corrupt-backup");
    if (includeActive) expect(platform.files.get(active)?.id).toBe("corrupt-active");

    await expect(manager.install(enV2)).resolves.toBeUndefined();
    expect(platform.files.get(active)?.id).toBe("download-1");
    expect(platform.files.has(backup)).toBe(false);
  });

  it("keeps repair available when a retry fails with only a corrupt backup", async () => {
    const platform = new StatefulMemoryPlatform();
    const { backup } = paths(platform);
    platform.put(backup, enV1, "corrupt-backup");
    const corruptBackup = platform.files.get(backup);
    if (corruptBackup) corruptBackup.validSchema = false;
    platform.downloadFailure = new Error("offline");
    const manager = new DictionaryPackManager(platform, platform.root, closer(platform));
    const statuses: DictionaryPackStatus[] = [];

    await expect(manager.install(enV2, (status) => statuses.push(status))).rejects.toThrow(
      "offline",
    );

    expect(statuses.at(-1)).toEqual({
      state: "error",
      message: "offline",
      hasActivePack: true,
    });
    expect(platform.files.get(backup)?.id).toBe("corrupt-backup");
  });

  it("discovers installed metadata from SQLite after restart and detects updates", async () => {
    const platform = new StatefulMemoryPlatform();
    platform.put(paths(platform).active, enV1, "persisted", "persisted bytes");
    const restartedManager = new DictionaryPackManager(platform, platform.root, closer(platform));

    expect(await restartedManager.getInstalledDescriptor("en")).toEqual({
      ...metadataOf(enV1),
      sizeBytes: enV1.sizeBytes,
      sha256: enV1.sha256,
    });
    await expect(restartedManager.refresh(manifest())).resolves.toMatchObject({
      en: {
        state: "update-available",
        installedVersion: enV1.version,
        availableVersion: enV2.version,
        sizeBytes: enV1.sizeBytes,
      },
    });
  });

  it("offers repair when the manifest has the same version but a different full identity", async () => {
    const platform = new StatefulMemoryPlatform();
    platform.put(paths(platform).active, enV2, "old-same-version");
    const replacement = {
      ...enV2,
      sizeBytes: 124,
      sha256: "d".repeat(64),
      url: "https://example.test/en-2026.09-repacked.sqlite",
      sourceArchiveUrl: "https://example.test/en-2026.09-repacked.tar.gz",
      attributionUrl: "https://example.test/en-2026.09-attribution",
    };
    const manager = new DictionaryPackManager(platform, platform.root, closer(platform));

    await expect(manager.refresh(manifest(replacement))).resolves.toMatchObject({
      en: {
        state: "update-available",
        installedVersion: enV2.version,
        availableVersion: replacement.version,
      },
    });
  });

  it("keeps a valid manifest usable when one installed language is corrupt", async () => {
    const platform = new StatefulMemoryPlatform();
    const enPath = paths(platform, "en").active;
    const zhPath = paths(platform, "zh").active;
    platform.put(enPath, enV1, "corrupt-en");
    const corruptEnglish = platform.files.get(enPath);
    if (corruptEnglish) corruptEnglish.validSchema = false;
    platform.put(zhPath, zhV1, "healthy-zh");
    const manager = new DictionaryPackManager(platform, platform.root, closer(platform));

    await expect(manager.refresh(manifest())).resolves.toMatchObject({
      en: { state: "error", hasActivePack: true },
      zh: { state: "installed", version: zhV1.version },
    });
    expect(platform.files.get(enPath)?.id).toBe("corrupt-en");
    expect(await manager.getInstalledDescriptor("zh")).toMatchObject({ version: zhV1.version });
  });

  it("rolls back using the backup's own metadata after final validation fails", async () => {
    const platform = new StatefulMemoryPlatform();
    const { active, backup } = paths(platform);
    platform.put(active, enV1, "old", "trusted old bytes");
    const activationError = new Error("post-activation validation failed");
    platform.failMetadataOnce(active, activationError, "download-1");
    const manager = new DictionaryPackManager(platform, platform.root, closer(platform));

    await expect(manager.install(enV2)).rejects.toBe(activationError);

    expect(platform.events).toContain(`metadata:${backup}:old`);
    expect(platform.files.get(active)).toMatchObject({ id: "old", content: "trusted old bytes" });
    expect(await manager.getInstalledDescriptor("en")).toMatchObject({ version: enV1.version });
  });

  it("removes a broken active when final validation fails without a previous pack", async () => {
    const platform = new StatefulMemoryPlatform();
    const { active, staged } = paths(platform);
    platform.failMetadataOnce(active, new Error("post-activation validation failed"), "download-1");
    const manager = new DictionaryPackManager(platform, platform.root, closer(platform));

    await expect(manager.install(enV2)).rejects.toThrow("post-activation validation failed");

    expect(platform.files.has(active)).toBe(false);
    expect(platform.files.has(staged)).toBe(false);
  });

  it("preserves the operation error and records cleanup failure", async () => {
    const platform = new StatefulMemoryPlatform();
    const { active } = paths(platform);
    const operationError = new Error("post-activation validation failed");
    const cleanupError = new Error("cannot remove broken active");
    platform.failMetadataOnce(active, operationError, "download-1");
    platform.removeFaults.set(active, [cleanupError]);
    const manager = new DictionaryPackManager(platform, platform.root, closer(platform));

    let thrown: unknown;
    try {
      await manager.install(enV2);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(operationError);
    expect((thrown as Error & { cleanupErrors?: unknown[] }).cleanupErrors).toContain(cleanupError);
  });

  it("coalesces concurrent installs for the same language", async () => {
    const platform = new StatefulMemoryPlatform();
    const release = platform.pauseDownload(enV2.url);
    const manager = new DictionaryPackManager(platform, platform.root, closer(platform));

    const first = manager.install(enV2);
    const second = manager.install(enV2);
    await vi.waitFor(() => expect(platform.downloadCalls).toBe(1));
    release();
    await Promise.all([first, second]);

    expect(platform.downloadCalls).toBe(1);
  });

  it("allows different languages to install in parallel", async () => {
    const platform = new StatefulMemoryPlatform();
    const releaseEnglish = platform.pauseDownload(enV2.url);
    const manager = new DictionaryPackManager(platform, platform.root, closer(platform));
    let englishFinished = false;

    const english = manager.install(enV2).then(() => {
      englishFinished = true;
    });
    await vi.waitFor(() => expect(platform.downloadCalls).toBe(1));

    await manager.install(zhV1);
    expect(englishFinished).toBe(false);
    expect(platform.files.get(paths(platform, "zh").active)?.content).toBe("content:2026.09");

    releaseEnglish();
    await english;
  });

  it("serializes refresh behind an in-flight install for the same language", async () => {
    const platform = new StatefulMemoryPlatform();
    const release = platform.pauseDownload(enV2.url);
    const manager = new DictionaryPackManager(platform, platform.root, closer(platform));
    const install = manager.install(enV2);
    await vi.waitFor(() => expect(platform.downloadCalls).toBe(1));
    let refreshFinished = false;

    const refresh = manager.refresh(manifest()).then((status) => {
      refreshFinished = true;
      return status;
    });
    await Promise.resolve();
    expect(refreshFinished).toBe(false);

    release();
    await install;
    await expect(refresh).resolves.toMatchObject({
      en: { state: "installed", version: enV2.version },
    });
  });

  it("serializes removal behind an in-flight install and leaves no pack artifacts", async () => {
    const platform = new StatefulMemoryPlatform();
    const release = platform.pauseDownload(enV2.url);
    const manager = new DictionaryPackManager(platform, platform.root, closer(platform));
    const install = manager.install(enV2);
    await vi.waitFor(() => expect(platform.downloadCalls).toBe(1));
    let removeFinished = false;

    const remove = manager.remove("en").then(() => {
      removeFinished = true;
    });
    await Promise.resolve();
    expect(removeFinished).toBe(false);

    release();
    await install;
    await remove;
    expect(Object.values(paths(platform)).some((path) => platform.files.has(path))).toBe(false);
  });

  it("closes before moving an active pack or deleting one", async () => {
    const platform = new StatefulMemoryPlatform();
    const { active, backup } = paths(platform);
    platform.put(active, enV1, "old");
    const lookup = closer(platform);
    const manager = new DictionaryPackManager(platform, platform.root, lookup);

    await manager.install(enV2);
    const closeBeforeMove = platform.events.indexOf("close:en");
    expect(closeBeforeMove).toBeGreaterThanOrEqual(0);
    expect(closeBeforeMove).toBeLessThan(platform.events.indexOf(`move:${active}->${backup}`));

    platform.events.length = 0;
    await manager.remove("en");
    expect(platform.events.indexOf("close:en")).toBeLessThan(
      platform.events.indexOf(`remove:${active}`),
    );
  });

  it("removes only the requested language", async () => {
    const platform = new StatefulMemoryPlatform();
    const enPaths = paths(platform, "en");
    const zhPaths = paths(platform, "zh");
    platform.put(enPaths.active, enV1, "english", "english bytes");
    platform.put(zhPaths.active, zhV1, "chinese", "chinese bytes");
    const lookup = closer(platform);
    const manager = new DictionaryPackManager(platform, platform.root, lookup);

    await manager.remove("en");

    expect(lookup.close).toHaveBeenCalledWith("en");
    expect(platform.files.has(enPaths.active)).toBe(false);
    expect(platform.files.get(zhPaths.active)).toMatchObject({
      id: "chinese",
      content: "chinese bytes",
    });
  });
});
