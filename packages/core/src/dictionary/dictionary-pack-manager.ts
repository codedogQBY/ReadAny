import type { DictionaryLanguage, DictionaryManifest, DictionaryPackDescriptor } from "./index";

const dictionaryLanguages = ["en", "zh"] as const;

export type DictionaryPackMetadata = Pick<
  DictionaryPackDescriptor,
  | "language"
  | "version"
  | "schemaVersion"
  | "sourceEdition"
  | "sourceDumpDate"
  | "sourceArchiveUrl"
  | "url"
  | "attributionUrl"
  | "license"
> & {
  licenseNotice: string;
  creatorAttribution: string;
};

export type InstalledDictionaryPack = DictionaryPackMetadata &
  Pick<DictionaryPackDescriptor, "sizeBytes" | "sha256">;

export interface DictionaryPackPlatform {
  ensureDirectory(path: string): Promise<void>;
  download(url: string, path: string, onProgress: (fraction: number) => void): Promise<void>;
  exists(path: string): Promise<boolean>;
  size(path: string): Promise<number>;
  sha256(path: string): Promise<string>;
  readMetadata(path: string): Promise<DictionaryPackMetadata>;
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export type DictionaryPackStatus =
  | { state: "not-installed" }
  | { state: "downloading"; progress: number }
  | { state: "verifying" }
  | { state: "installed"; version: string; sizeBytes: number }
  | {
      state: "update-available";
      installedVersion: string;
      availableVersion: string;
      sizeBytes: number;
    }
  | { state: "error"; message: string; hasActivePack: boolean };

export interface DictionaryHandleCloser {
  close(language?: DictionaryLanguage): Promise<void> | void;
}

type ErrorWithCleanup = Error & { cleanupErrors?: unknown[] };

interface InspectedArtifact {
  path: string;
  exists: boolean;
  installed?: InstalledDictionaryPack;
  error?: unknown;
}

interface InspectedArtifacts {
  active: InspectedArtifact;
  backup: InspectedArtifact;
}

export class DictionaryPackManager {
  private readonly installs = new Map<DictionaryLanguage, Promise<void>>();
  private readonly gates = new Map<DictionaryLanguage, Promise<void>>();
  private readonly validatedPacks = new Map<
    DictionaryLanguage,
    { path: string; installed: InstalledDictionaryPack } | null
  >();

  constructor(
    private readonly platform: DictionaryPackPlatform,
    private readonly directory: string,
    private readonly lookup: DictionaryHandleCloser,
  ) {}

  async refresh(
    manifest: DictionaryManifest,
  ): Promise<Record<DictionaryLanguage, DictionaryPackStatus>> {
    const entries = await Promise.all(
      dictionaryLanguages.map((language) =>
        this.runExclusive(language, async () => {
          try {
            const discovered = await this.discoverInstalledLocked(language);
            const installed = discovered?.installed;
            const available = manifest.packs[language];
            const status: DictionaryPackStatus = !installed
              ? { state: "not-installed" }
              : sameDescriptorIdentity(installed, available)
                ? { state: "installed", version: installed.version, sizeBytes: installed.sizeBytes }
                : {
                    state: "update-available",
                    installedVersion: installed.version,
                    availableVersion: available.version,
                    sizeBytes: installed.sizeBytes,
                  };
            return [language, status] as const;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const hasActivePack = await this.hasPackArtifacts(language);
            return [
              language,
              { state: "error", message, hasActivePack } satisfies DictionaryPackStatus,
            ] as const;
          }
        }),
      ),
    );
    return Object.fromEntries(entries) as Record<DictionaryLanguage, DictionaryPackStatus>;
  }

  install(
    descriptor: DictionaryPackDescriptor,
    onStatus: (status: DictionaryPackStatus) => void = () => {},
  ): Promise<void> {
    const language = descriptor.language;
    const existing = this.installs.get(language);
    if (existing) return existing;

    const operation = this.runExclusive(language, () =>
      this.installLocked(descriptor, onStatus),
    ).finally(() => {
      if (this.installs.get(language) === operation) this.installs.delete(language);
    });
    this.installs.set(language, operation);
    return operation;
  }

  remove(language: DictionaryLanguage): Promise<void> {
    return this.runExclusive(language, async () => {
      this.invalidate(language);
      await this.platform.ensureDirectory(this.directory);
      await this.lookup.close(language);
      await this.removeIfPresent(this.activePath(language));
      await this.removeIfPresent(this.stagedPath(language));
      await this.removeIfPresent(this.backupPath(language));
    });
  }

  getActivePath(language: DictionaryLanguage): Promise<string | null> {
    return this.runExclusive(language, async () => {
      const discovered = await this.discoverInstalledLocked(language);
      return discovered?.path ?? null;
    });
  }

  getInstalledDescriptor(language: DictionaryLanguage): Promise<InstalledDictionaryPack | null> {
    return this.runExclusive(language, async () => {
      return (await this.discoverInstalledLocked(language))?.installed ?? null;
    });
  }

  invalidate(language: DictionaryLanguage): void {
    this.validatedPacks.delete(language);
  }

  private async installLocked(
    descriptor: DictionaryPackDescriptor,
    onStatus: (status: DictionaryPackStatus) => void,
  ): Promise<void> {
    const language = descriptor.language;
    this.invalidate(language);
    const staged = this.stagedPath(language);
    const active = this.activePath(language);
    const backup = this.backupPath(language);
    try {
      await this.platform.ensureDirectory(this.directory);
      await this.removeIfPresent(staged);
      const artifacts = await this.inspectArtifactsLocked(language);
      onStatus({ state: "downloading", progress: 0 });
      await this.platform.download(descriptor.url, staged, (progress) =>
        onStatus({ state: "downloading", progress: clamp(progress) }),
      );
      onStatus({ state: "verifying" });
      const verificationStarted = Date.now();
      await this.verifyExpected(staged, descriptor);
      await this.lookup.close(language);

      let hasRollbackBackup = Boolean(artifacts.backup.installed);
      let activationStarted = false;
      try {
        if (artifacts.backup.installed) {
          activationStarted = true;
          await this.removeIfPresent(active);
        } else if (artifacts.active.installed) {
          await this.removeIfPresent(backup);
          await this.platform.move(active, backup);
          hasRollbackBackup = true;
          activationStarted = true;
        } else {
          await this.removeIfPresent(active);
          await this.removeIfPresent(backup);
          activationStarted = true;
        }
        await this.platform.move(staged, active);
        const installed = await this.verifyExpected(active, descriptor);
        await this.removeIfPresent(backup);
        this.validatedPacks.set(language, { path: active, installed });
      } catch (operationError) {
        const cleanupErrors: unknown[] = [];
        if (hasRollbackBackup) {
          await this.captureCleanupFailure(cleanupErrors, () =>
            this.rollbackLocked(active, backup),
          );
        } else if (activationStarted) {
          await this.captureCleanupFailure(cleanupErrors, () => this.removeIfPresent(active));
        }
        attachCleanupErrors(operationError, cleanupErrors);
        throw operationError;
      }

      console.info(
        `[Dictionary] Verified and installed ${language} pack in ${Date.now() - verificationStarted} ms`,
      );
      onStatus({
        state: "installed",
        version: descriptor.version,
        sizeBytes: descriptor.sizeBytes,
      });
    } catch (operationError) {
      const cleanupErrors: unknown[] = [];
      await this.captureCleanupFailure(cleanupErrors, () => this.removeIfPresent(staged));
      attachCleanupErrors(operationError, cleanupErrors);
      const message =
        operationError instanceof Error ? operationError.message : String(operationError);
      onStatus({
        state: "error",
        message,
        hasActivePack: await this.hasPackArtifacts(language),
      });
      throw operationError;
    }
  }

  private async verifyExpected(
    path: string,
    descriptor: DictionaryPackDescriptor,
  ): Promise<InstalledDictionaryPack> {
    const installed = await this.inspectPack(path);
    if (installed.sizeBytes !== descriptor.sizeBytes)
      throw new Error("Dictionary pack size did not match manifest");
    if (installed.sha256.toLowerCase() !== descriptor.sha256.toLowerCase())
      throw new Error("Dictionary pack checksum did not match manifest");
    assertMetadataMatches(installed, descriptor);
    return installed;
  }

  private async rollbackLocked(active: string, backup: string): Promise<void> {
    if (!(await this.platform.exists(backup))) return;
    const backupSnapshot = await this.inspectPack(backup);
    await this.removeIfPresent(active);
    await this.platform.move(backup, active);
    const restoredSnapshot = await this.inspectPack(active);
    assertSamePack(backupSnapshot, restoredSnapshot);
    this.validatedPacks.set(restoredSnapshot.language, {
      path: active,
      installed: restoredSnapshot,
    });
  }

  private async discoverInstalledLocked(
    language: DictionaryLanguage,
  ): Promise<{ path: string; installed: InstalledDictionaryPack } | null> {
    if (this.validatedPacks.has(language)) return this.validatedPacks.get(language) ?? null;
    await this.platform.ensureDirectory(this.directory);
    const artifacts = await this.inspectArtifactsLocked(language);
    if (artifacts.backup.installed) {
      const discovered = { path: artifacts.backup.path, installed: artifacts.backup.installed };
      this.validatedPacks.set(language, discovered);
      return discovered;
    }
    if (artifacts.active.installed) {
      const discovered = { path: artifacts.active.path, installed: artifacts.active.installed };
      this.validatedPacks.set(language, discovered);
      return discovered;
    }

    const errors = [artifacts.backup.error, artifacts.active.error].filter(
      (error): error is NonNullable<typeof error> => error !== undefined,
    );
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, `No valid ${language} dictionary recovery artifact exists`);
    }
    this.validatedPacks.set(language, null);
    return null;
  }

  private async inspectArtifactsLocked(language: DictionaryLanguage): Promise<InspectedArtifacts> {
    const [active, backup] = await Promise.all([
      this.inspectArtifact(this.activePath(language), language),
      this.inspectArtifact(this.backupPath(language), language),
    ]);
    return { active, backup };
  }

  private async inspectArtifact(
    path: string,
    language: DictionaryLanguage,
  ): Promise<InspectedArtifact> {
    if (!(await this.platform.exists(path))) return { path, exists: false };
    try {
      const installed = await this.inspectPack(path);
      if (installed.language !== language) {
        throw new Error(`Dictionary metadata language did not match ${language}`);
      }
      return { path, exists: true, installed };
    } catch (error) {
      return { path, exists: true, error };
    }
  }

  private async hasPackArtifacts(language: DictionaryLanguage): Promise<boolean> {
    return (
      (await this.platform.exists(this.activePath(language))) ||
      (await this.platform.exists(this.backupPath(language))) ||
      (await this.platform.exists(this.stagedPath(language)))
    );
  }

  private async inspectPack(path: string): Promise<InstalledDictionaryPack> {
    const [metadata, sizeBytes, sha256] = await Promise.all([
      this.platform.readMetadata(path),
      this.platform.size(path),
      this.platform.sha256(path),
    ]);
    return { ...metadata, sizeBytes, sha256: sha256.toLowerCase() };
  }

  private runExclusive<T>(language: DictionaryLanguage, action: () => Promise<T>): Promise<T> {
    const previous = this.gates.get(language) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(action);
    const tail = operation.then(
      () => undefined,
      () => undefined,
    );
    this.gates.set(language, tail);
    void tail.then(() => {
      if (this.gates.get(language) === tail) this.gates.delete(language);
    });
    return operation;
  }

  private async captureCleanupFailure(
    errors: unknown[],
    cleanup: () => Promise<void>,
  ): Promise<void> {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }

  private activePath(language: DictionaryLanguage): string {
    return `${this.directory}/readany-dictionary-${language}.sqlite`;
  }

  private stagedPath(language: DictionaryLanguage): string {
    return `${this.activePath(language)}.download`;
  }

  private backupPath(language: DictionaryLanguage): string {
    return `${this.activePath(language)}.backup`;
  }

  private async removeIfPresent(path: string): Promise<void> {
    if (await this.platform.exists(path)) await this.platform.remove(path);
  }
}

function assertMetadataMatches(
  installed: DictionaryPackMetadata,
  expected: DictionaryPackDescriptor,
): void {
  for (const key of [
    "language",
    "version",
    "schemaVersion",
    "sourceEdition",
    "sourceDumpDate",
    "sourceArchiveUrl",
    "url",
    "attributionUrl",
    "license",
  ] as const) {
    if (installed[key] !== expected[key])
      throw new Error(`Dictionary metadata ${key} did not match manifest`);
  }
}

function sameDescriptorIdentity(
  installed: InstalledDictionaryPack,
  available: DictionaryPackDescriptor,
): boolean {
  return (
    installed.sizeBytes === available.sizeBytes &&
    installed.sha256.toLowerCase() === available.sha256.toLowerCase() &&
    [
      "language",
      "version",
      "schemaVersion",
      "sourceEdition",
      "sourceDumpDate",
      "sourceArchiveUrl",
      "url",
      "attributionUrl",
      "license",
    ].every(
      (key) =>
        installed[key as keyof InstalledDictionaryPack] ===
        available[key as keyof DictionaryPackDescriptor],
    )
  );
}

function assertSamePack(expected: InstalledDictionaryPack, actual: InstalledDictionaryPack): void {
  if (
    expected.sizeBytes !== actual.sizeBytes ||
    expected.sha256 !== actual.sha256 ||
    JSON.stringify(expected) !== JSON.stringify(actual)
  ) {
    throw new Error("Restored dictionary pack did not match the validated backup");
  }
}

function attachCleanupErrors(operationError: unknown, cleanupErrors: unknown[]): void {
  if (cleanupErrors.length === 0 || !(operationError instanceof Error)) return;
  const error = operationError as ErrorWithCleanup;
  error.cleanupErrors = [...(error.cleanupErrors ?? []), ...cleanupErrors];
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
