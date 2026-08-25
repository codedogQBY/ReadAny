import type { IPlatformService } from "../services/platform";
import { generateId } from "../utils/generate-id";
import { classifyOpdsUrl } from "./opds-security";
import type { OpdsCredentials } from "./opds-types";

export const OPDS_CATALOG_STORAGE_KEY = "opds.catalogs.v1";

export type OpdsCatalogAuth = "anonymous" | "basic";
export type OpdsPasswordStorage = "none" | "persistent" | "session-only";

export interface OpdsCatalog {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly enabled: boolean;
  readonly builtIn: boolean;
  readonly hidden: boolean;
  readonly auth: OpdsCatalogAuth;
  readonly username?: string;
  readonly passwordStorage: OpdsPasswordStorage;
}

export interface OpdsCatalogInput {
  name: string;
  url: string;
  enabled?: boolean;
  auth: OpdsCatalogAuth;
  username?: string;
  password?: string;
}

export interface OpdsCatalogUpdate {
  name?: string;
  url?: string;
  enabled?: boolean;
  auth?: OpdsCatalogAuth;
  username?: string;
  password?: string;
}

export type OpdsCatalogStorage = Pick<
  IPlatformService,
  "kvGetItem" | "kvSetItem" | "secretGetItem" | "secretSetItem" | "secretRemoveItem"
>;

interface BuiltInCatalogDefinition {
  readonly id: "gutenberg" | "gutenberg-zh";
  readonly name: string;
  readonly url: string;
}

export const OPDS_BUILT_IN_CATALOGS: readonly BuiltInCatalogDefinition[] = Object.freeze([
  Object.freeze({
    id: "gutenberg",
    name: "Project Gutenberg",
    url: "https://www.gutenberg.org/ebooks/search.opds/",
  }),
  Object.freeze({
    id: "gutenberg-zh",
    name: "Project Gutenberg — Chinese Books",
    url: "https://www.gutenberg.org/ebooks/search.opds/?query=l.zh",
  }),
]);

interface CustomCatalogDefinition {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  auth: OpdsCatalogAuth;
  username?: string;
}

interface PersistedCatalogsV1 {
  version: 1;
  customCatalogs: CustomCatalogDefinition[];
  hiddenBuiltInIds: string[];
  pendingSecretCleanups?: PendingSecretCleanup[];
}

interface PendingSecretCleanup {
  id: string;
  revision: number;
  action: "remove-secret";
}

const CUSTOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const builtInIds = new Set<string>(OPDS_BUILT_IN_CATALOGS.map(({ id }) => id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return name.length > 0 ? name : undefined;
}

function normalizeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const classification = classifyOpdsUrl(value);
  if (!classification.allowed) return undefined;
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}

function urlOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

export function canPreserveOpdsCatalogPassword(
  current: Pick<OpdsCatalog, "url" | "auth" | "username" | "passwordStorage">,
  next: Pick<OpdsCatalogInput, "url" | "auth" | "username">,
): boolean {
  return (
    current.passwordStorage !== "none" &&
    current.auth === "basic" &&
    next.auth === "basic" &&
    current.username === next.username &&
    urlOrigin(current.url) !== undefined &&
    urlOrigin(current.url) === urlOrigin(next.url)
  );
}

function normalizeCustomCatalog(value: unknown): CustomCatalogDefinition | undefined {
  if (!isRecord(value)) return undefined;
  const id = typeof value.id === "string" ? value.id : "";
  const name = normalizeName(value.name);
  const url = normalizeUrl(value.url);
  const auth = value.auth;
  if (
    !CUSTOM_ID_PATTERN.test(id) ||
    builtInIds.has(id) ||
    !name ||
    !url ||
    typeof value.enabled !== "boolean" ||
    (auth !== "anonymous" && auth !== "basic")
  ) {
    return undefined;
  }

  const username = typeof value.username === "string" ? value.username : undefined;
  return {
    id,
    name,
    url,
    enabled: value.enabled,
    auth,
    ...(auth === "basic" && username !== undefined ? { username } : {}),
  };
}

function normalizePendingSecretCleanup(value: unknown): PendingSecretCleanup | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== "string" || !CUSTOM_ID_PATTERN.test(value.id)) {
    return undefined;
  }
  const validMarker =
    Number.isSafeInteger(value.revision) &&
    (value.revision as number) >= 0 &&
    value.action === "remove-secret";
  return {
    id: value.id,
    revision: validMarker ? (value.revision as number) : 0,
    action: "remove-secret",
  };
}

function assertCatalogInputShape(
  value: unknown,
  options: { requireDefinition: boolean },
): asserts value is OpdsCatalogInput | OpdsCatalogUpdate {
  if (!isRecord(value)) throw new Error("Catalog input is invalid");
  if (
    (options.requireDefinition &&
      (typeof value.name !== "string" ||
        typeof value.url !== "string" ||
        (value.auth !== "anonymous" && value.auth !== "basic"))) ||
    (!options.requireDefinition && value.name !== undefined && typeof value.name !== "string") ||
    (!options.requireDefinition && value.url !== undefined && typeof value.url !== "string") ||
    (!options.requireDefinition &&
      value.auth !== undefined &&
      value.auth !== "anonymous" &&
      value.auth !== "basic") ||
    (value.enabled !== undefined && typeof value.enabled !== "boolean") ||
    (value.username !== undefined && typeof value.username !== "string") ||
    (value.password !== undefined && typeof value.password !== "string")
  ) {
    throw new Error("Catalog input is invalid");
  }
}

export function opdsCatalogSecretKey(catalogId: string): string {
  if (!CUSTOM_ID_PATTERN.test(catalogId)) {
    throw new Error("Invalid custom catalog id");
  }
  return `opds.catalog.${catalogId}.password`;
}

export class OpdsCatalogStore {
  private customCatalogs = new Map<string, CustomCatalogDefinition>();
  private hiddenBuiltInIds = new Set<string>();
  private readonly sessionPasswords = new Map<string, string>();
  private readonly passwordStorage = new Map<string, Exclude<OpdsPasswordStorage, "none">>();
  private readonly blockedPersistentPasswords = new Set<string>();
  private pendingSecretCleanups = new Map<string, PendingSecretCleanup>();
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: OpdsCatalogStorage,
    private readonly createId: () => string = generateId,
  ) {}

  async load(): Promise<void> {
    return this.enqueueMutation(() => this.loadInternal());
  }

  private async loadInternal(): Promise<void> {
    const raw = await this.storage.kvGetItem(OPDS_CATALOG_STORAGE_KEY);
    if (!raw) {
      this.replaceState(new Map(), new Set(), new Map(), { clearPasswords: true });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Catalog storage is invalid");
    }
    if (!isRecord(parsed) || parsed.version !== 1) {
      throw new Error("Catalog storage is invalid");
    }

    const nextCustomCatalogs = new Map<string, CustomCatalogDefinition>();
    const nextHiddenBuiltInIds = new Set<string>();
    const nextPendingSecretCleanups = new Map<string, PendingSecretCleanup>();

    if (Array.isArray(parsed.hiddenBuiltInIds)) {
      for (const id of parsed.hiddenBuiltInIds) {
        if (typeof id === "string" && builtInIds.has(id)) nextHiddenBuiltInIds.add(id);
      }
    }

    if (Array.isArray(parsed.customCatalogs)) {
      for (const value of parsed.customCatalogs) {
        const catalog = normalizeCustomCatalog(value);
        if (catalog && !nextCustomCatalogs.has(catalog.id)) {
          nextCustomCatalogs.set(catalog.id, catalog);
        }
      }
    }
    if (
      parsed.pendingSecretCleanups !== undefined &&
      !Array.isArray(parsed.pendingSecretCleanups)
    ) {
      throw new Error("Catalog cleanup storage is invalid");
    }
    if (Array.isArray(parsed.pendingSecretCleanups)) {
      for (const value of parsed.pendingSecretCleanups) {
        const cleanup = normalizePendingSecretCleanup(value);
        const existing = cleanup ? nextPendingSecretCleanups.get(cleanup.id) : undefined;
        if (cleanup && (!existing || cleanup.revision > existing.revision)) {
          nextPendingSecretCleanups.set(cleanup.id, cleanup);
        }
      }
    }
    // Rewrite the validated projection so unknown or malicious fields do not remain in general KV.
    await this.persistState(nextCustomCatalogs, nextHiddenBuiltInIds, nextPendingSecretCleanups);
    this.replaceState(nextCustomCatalogs, nextHiddenBuiltInIds, nextPendingSecretCleanups, {
      clearPasswords: true,
    });
    for (const id of [...nextPendingSecretCleanups.keys()]) {
      await this.retryPendingSecretCleanup(id);
    }
  }

  listCatalogs(options: { includeHidden?: boolean } = {}): OpdsCatalog[] {
    const builtIns = OPDS_BUILT_IN_CATALOGS.map((definition) =>
      this.toBuiltInCatalog(definition),
    ).filter((catalog) => options.includeHidden || !catalog.hidden);
    const custom = Array.from(this.customCatalogs.values(), (definition) =>
      this.toCustomCatalog(definition),
    );
    return [...builtIns, ...custom];
  }

  getCatalog(id: string): OpdsCatalog | undefined {
    const builtIn = OPDS_BUILT_IN_CATALOGS.find((catalog) => catalog.id === id);
    if (builtIn) return this.toBuiltInCatalog(builtIn);
    const custom = this.customCatalogs.get(id);
    return custom ? this.toCustomCatalog(custom) : undefined;
  }

  async addCatalog(input: OpdsCatalogInput): Promise<OpdsCatalog> {
    assertCatalogInputShape(input, { requireDefinition: true });
    if (input.auth === "anonymous" && input.password !== undefined) {
      throw new Error("Anonymous catalogs cannot have a password");
    }
    return this.enqueueMutation(async () => {
      const id = this.createId();
      if (this.pendingSecretCleanups.has(id)) {
        await this.retryPendingSecretCleanup(id);
      }
      if (!CUSTOM_ID_PATTERN.test(id) || builtInIds.has(id) || this.customCatalogs.has(id)) {
        throw new Error("Could not generate a unique catalog id");
      }
      if (this.pendingSecretCleanups.has(id)) {
        throw new Error("Could not generate a unique catalog id");
      }
      const catalog = this.catalogFromInput(id, input);
      const nextCatalogs = new Map(this.customCatalogs).set(id, catalog);
      await this.persistState(nextCatalogs, this.hiddenBuiltInIds, this.pendingSecretCleanups);
      if (input.password) await this.storePassword(id, input.password);
      this.customCatalogs = nextCatalogs;
      return this.toCustomCatalog(catalog);
    });
  }

  async updateCatalog(id: string, update: OpdsCatalogUpdate): Promise<OpdsCatalog> {
    assertCatalogInputShape(update, { requireDefinition: false });
    return this.enqueueMutation(async () => {
      if (builtInIds.has(id)) throw new Error("Built-in catalogs cannot be edited");
      if (this.pendingSecretCleanups.has(id) && this.hasCompleteSecretStorage()) {
        await this.requirePendingSecretCleanupResolved(id);
      }
      const current = this.customCatalogs.get(id);
      if (!current) throw new Error("Catalog not found");

      const next = this.catalogFromInput(id, {
        name: update.name ?? current.name,
        url: update.url ?? current.url,
        enabled: update.enabled ?? current.enabled,
        auth: update.auth ?? current.auth,
        username: update.username ?? current.username,
      });
      if (next.auth === "anonymous" && update.password !== undefined) {
        throw new Error("Anonymous catalogs cannot have a password");
      }
      const preservesPassword = canPreserveOpdsCatalogPassword(this.toCustomCatalog(current), next);
      const originChanged = urlOrigin(next.url) !== urlOrigin(current.url);
      const identityChanged =
        originChanged || next.auth !== current.auth || next.username !== current.username;
      if (next.auth === "basic" && identityChanged && !update.password && !preservesPassword) {
        throw new Error("A password is required when changing catalog credentials");
      }
      const credentialChanged = identityChanged || update.password !== undefined;
      const cleanupAlreadyPending = this.pendingSecretCleanups.has(id);
      const previousPersistentPassword =
        credentialChanged && !cleanupAlreadyPending
          ? await this.readPersistentPassword(id)
          : undefined;
      const previousCatalogs = this.customCatalogs;
      const nextCatalogs = new Map(previousCatalogs).set(id, next);
      const previousPendingSecretCleanups = this.pendingSecretCleanups;
      const nextPendingSecretCleanups =
        credentialChanged && !cleanupAlreadyPending
          ? this.withPendingSecretCleanup(id)
          : previousPendingSecretCleanups;
      await this.persistState(nextCatalogs, this.hiddenBuiltInIds, nextPendingSecretCleanups);
      this.customCatalogs = nextCatalogs;
      this.pendingSecretCleanups = nextPendingSecretCleanups;

      if (credentialChanged) {
        if (cleanupAlreadyPending || !this.hasCompleteSecretStorage()) {
          this.clearPasswordState(id);
          if (next.auth === "basic" && update.password) {
            this.storeSessionPassword(id, update.password);
          }
          return this.toCustomCatalog(next);
        }
        try {
          await this.removePersistentPassword(id);
        } catch (error) {
          await this.compensateSecretMutationFailure(
            id,
            previousPersistentPassword,
            previousCatalogs,
            this.hiddenBuiltInIds,
            previousPendingSecretCleanups,
            nextCatalogs,
            nextPendingSecretCleanups,
            error,
            "Catalog update",
            () => {
              this.clearPasswordState(id);
              if (next.auth === "basic" && update.password) {
                this.sessionPasswords.set(id, update.password);
                this.passwordStorage.set(id, "session-only");
              } else {
                this.blockedPersistentPasswords.add(id);
              }
            },
          );
        }
        await this.clearPendingSecretCleanup(id, nextCatalogs);
        this.clearPasswordState(id);
        if (next.auth === "basic" && update.password) {
          await this.storePassword(id, update.password);
        }
      }

      return this.toCustomCatalog(next);
    });
  }

  async setCatalogEnabled(id: string, enabled: boolean): Promise<OpdsCatalog> {
    return this.updateCatalog(id, { enabled });
  }

  async removeCatalog(id: string): Promise<boolean> {
    return this.enqueueMutation(async () => {
      if (builtInIds.has(id)) throw new Error("Built-in catalogs cannot be deleted");
      if (this.pendingSecretCleanups.has(id) && this.hasCompleteSecretStorage()) {
        await this.requirePendingSecretCleanupResolved(id);
      }
      if (!this.customCatalogs.has(id)) return false;
      const cleanupAlreadyPending = this.pendingSecretCleanups.has(id);
      const previousPersistentPassword = cleanupAlreadyPending
        ? undefined
        : await this.readPersistentPassword(id);
      const previousCatalogs = this.customCatalogs;
      const nextCatalogs = new Map(previousCatalogs);
      nextCatalogs.delete(id);
      const previousPendingSecretCleanups = this.pendingSecretCleanups;
      const nextPendingSecretCleanups = cleanupAlreadyPending
        ? previousPendingSecretCleanups
        : this.withPendingSecretCleanup(id);
      await this.persistState(nextCatalogs, this.hiddenBuiltInIds, nextPendingSecretCleanups);
      this.customCatalogs = nextCatalogs;
      this.pendingSecretCleanups = nextPendingSecretCleanups;
      if (cleanupAlreadyPending || !this.hasCompleteSecretStorage()) {
        this.clearPasswordState(id);
        return true;
      }
      try {
        await this.removePersistentPassword(id);
      } catch (error) {
        await this.compensateSecretMutationFailure(
          id,
          previousPersistentPassword,
          previousCatalogs,
          this.hiddenBuiltInIds,
          previousPendingSecretCleanups,
          nextCatalogs,
          nextPendingSecretCleanups,
          error,
          "Catalog removal",
          () => {
            this.clearPasswordState(id);
          },
        );
      }
      await this.clearPendingSecretCleanup(id, nextCatalogs);
      this.clearPasswordState(id);
      return true;
    });
  }

  async hideBuiltIn(id: string): Promise<void> {
    return this.enqueueMutation(async () => {
      this.requireBuiltIn(id);
      const nextHiddenBuiltInIds = new Set(this.hiddenBuiltInIds).add(id);
      await this.persistState(
        this.customCatalogs,
        nextHiddenBuiltInIds,
        this.pendingSecretCleanups,
      );
      this.hiddenBuiltInIds = nextHiddenBuiltInIds;
    });
  }

  async restoreBuiltIn(id: string): Promise<void> {
    return this.enqueueMutation(async () => {
      this.requireBuiltIn(id);
      const nextHiddenBuiltInIds = new Set(this.hiddenBuiltInIds);
      nextHiddenBuiltInIds.delete(id);
      await this.persistState(
        this.customCatalogs,
        nextHiddenBuiltInIds,
        this.pendingSecretCleanups,
      );
      this.hiddenBuiltInIds = nextHiddenBuiltInIds;
    });
  }

  async getCredentials(id: string): Promise<OpdsCredentials | undefined> {
    const catalog = this.customCatalogs.get(id);
    if (!catalog || catalog.auth !== "basic") return undefined;

    let password = this.sessionPasswords.get(id);
    const { secretGetItem, secretSetItem, secretRemoveItem } = this.storage;
    if (
      !password &&
      !this.pendingSecretCleanups.has(id) &&
      !this.blockedPersistentPasswords.has(id) &&
      secretGetItem &&
      secretSetItem &&
      secretRemoveItem
    ) {
      try {
        password = (await secretGetItem(opdsCatalogSecretKey(id))) ?? undefined;
        if (
          this.customCatalogs.get(id) !== catalog ||
          this.pendingSecretCleanups.has(id) ||
          this.blockedPersistentPasswords.has(id)
        ) {
          return undefined;
        }
        if (password) this.passwordStorage.set(id, "persistent");
      } catch {
        password = undefined;
      }
    }
    if (!password) return undefined;
    return {
      username: catalog.username ?? "",
      password,
      catalogOrigin: new URL(catalog.url).origin,
    };
  }

  private catalogFromInput(
    id: string,
    input: Omit<OpdsCatalogInput, "password">,
  ): CustomCatalogDefinition {
    const name = normalizeName(input.name);
    const url = normalizeUrl(input.url);
    if (!name) throw new Error("Catalog name is required");
    if (!url) throw new Error("Catalog URL is not allowed");
    if (input.auth !== "anonymous" && input.auth !== "basic") {
      throw new Error("Catalog authentication type is invalid");
    }
    return {
      id,
      name,
      url,
      enabled: input.enabled ?? true,
      auth: input.auth,
      ...(input.auth === "basic" ? { username: input.username ?? "" } : {}),
    };
  }

  private async storePassword(id: string, password: string): Promise<void> {
    const { secretGetItem, secretSetItem, secretRemoveItem } = this.storage;
    if (secretGetItem && secretSetItem && secretRemoveItem) {
      try {
        await secretSetItem(opdsCatalogSecretKey(id), password);
        this.sessionPasswords.delete(id);
        this.passwordStorage.set(id, "persistent");
        this.blockedPersistentPasswords.delete(id);
        return;
      } catch {
        // A secret backend failure intentionally degrades to an explicit in-memory session secret.
      }
    }
    this.storeSessionPassword(id, password);
  }

  private storeSessionPassword(id: string, password: string): void {
    this.sessionPasswords.set(id, password);
    this.passwordStorage.set(id, "session-only");
    this.blockedPersistentPasswords.delete(id);
  }

  private async removePersistentPassword(id: string): Promise<void> {
    if (this.storage.secretRemoveItem) {
      await this.storage.secretRemoveItem(opdsCatalogSecretKey(id));
    }
  }

  private async readPersistentPassword(id: string): Promise<string | null | undefined> {
    const { secretGetItem, secretSetItem, secretRemoveItem } = this.storage;
    if (
      this.blockedPersistentPasswords.has(id) ||
      !secretGetItem ||
      !secretSetItem ||
      !secretRemoveItem
    ) {
      return undefined;
    }
    return secretGetItem(opdsCatalogSecretKey(id));
  }

  private clearPasswordState(id: string): void {
    this.sessionPasswords.delete(id);
    this.passwordStorage.delete(id);
    this.blockedPersistentPasswords.delete(id);
  }

  private async compensateSecretMutationFailure(
    id: string,
    previousPersistentPassword: string | null | undefined,
    customCatalogs: ReadonlyMap<string, CustomCatalogDefinition>,
    hiddenBuiltInIds: ReadonlySet<string>,
    previousPendingSecretCleanups: ReadonlyMap<string, PendingSecretCleanup>,
    nextCatalogs: ReadonlyMap<string, CustomCatalogDefinition>,
    nextPendingSecretCleanups: ReadonlyMap<string, PendingSecretCleanup>,
    originalError: unknown,
    operation: string,
    onRollbackFailure: () => void,
  ): Promise<never> {
    let compensationFailed = false;
    if (previousPersistentPassword !== undefined && previousPersistentPassword !== null) {
      try {
        await this.storage.secretSetItem?.(opdsCatalogSecretKey(id), previousPersistentPassword);
      } catch {
        compensationFailed = true;
      }
    }
    try {
      await this.persistState(customCatalogs, hiddenBuiltInIds, previousPendingSecretCleanups);
    } catch {
      try {
        await this.removePersistentPassword(id);
        await this.clearPendingSecretCleanup(id, nextCatalogs);
      } catch {
        this.pendingSecretCleanups = new Map(nextPendingSecretCleanups);
      }
      onRollbackFailure();
      throw new Error(`${operation} failed and rollback failed`);
    }
    this.customCatalogs = new Map(customCatalogs);
    this.pendingSecretCleanups = new Map(previousPendingSecretCleanups);
    if (compensationFailed) {
      this.sessionPasswords.set(id, previousPersistentPassword ?? "");
      this.passwordStorage.set(id, "session-only");
      this.blockedPersistentPasswords.add(id);
      throw new Error(`${operation} failed and secret compensation failed`);
    }
    throw originalError;
  }

  private async persistState(
    customCatalogs: ReadonlyMap<string, CustomCatalogDefinition>,
    hiddenBuiltInIds: ReadonlySet<string>,
    pendingSecretCleanups: ReadonlyMap<string, PendingSecretCleanup>,
  ): Promise<void> {
    const value: PersistedCatalogsV1 = {
      version: 1,
      customCatalogs: Array.from(customCatalogs.values(), (catalog) => ({ ...catalog })),
      hiddenBuiltInIds: Array.from(hiddenBuiltInIds),
      ...(pendingSecretCleanups.size > 0
        ? { pendingSecretCleanups: Array.from(pendingSecretCleanups.values()) }
        : {}),
    };
    await this.storage.kvSetItem(OPDS_CATALOG_STORAGE_KEY, JSON.stringify(value));
  }

  private replaceState(
    customCatalogs: ReadonlyMap<string, CustomCatalogDefinition>,
    hiddenBuiltInIds: ReadonlySet<string>,
    pendingSecretCleanups: ReadonlyMap<string, PendingSecretCleanup>,
    options: { clearPasswords: boolean },
  ): void {
    this.customCatalogs = new Map(customCatalogs);
    this.hiddenBuiltInIds = new Set(hiddenBuiltInIds);
    this.pendingSecretCleanups = new Map(pendingSecretCleanups);
    if (options.clearPasswords) {
      this.sessionPasswords.clear();
      this.passwordStorage.clear();
      this.blockedPersistentPasswords.clear();
    }
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private hasCompleteSecretStorage(): boolean {
    return Boolean(
      this.storage.secretGetItem && this.storage.secretSetItem && this.storage.secretRemoveItem,
    );
  }

  private withPendingSecretCleanup(id: string): Map<string, PendingSecretCleanup> {
    const currentRevision = Math.max(
      0,
      ...Array.from(this.pendingSecretCleanups.values(), ({ revision }) => revision),
    );
    if (currentRevision >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Catalog cleanup revision is exhausted");
    }
    const pending = new Map(this.pendingSecretCleanups);
    pending.set(id, {
      id,
      revision: currentRevision + 1,
      action: "remove-secret",
    });
    return pending;
  }

  private async clearPendingSecretCleanup(
    id: string,
    customCatalogs: ReadonlyMap<string, CustomCatalogDefinition>,
  ): Promise<void> {
    if (!this.pendingSecretCleanups.has(id)) return;
    const pending = new Map(this.pendingSecretCleanups);
    pending.delete(id);
    await this.persistState(customCatalogs, this.hiddenBuiltInIds, pending);
    this.pendingSecretCleanups = pending;
    this.blockedPersistentPasswords.delete(id);
  }

  private async retryPendingSecretCleanup(id: string): Promise<boolean> {
    if (!this.pendingSecretCleanups.has(id)) return true;
    if (!this.hasCompleteSecretStorage()) return false;
    try {
      await this.removePersistentPassword(id);
    } catch {
      return false;
    }
    await this.clearPendingSecretCleanup(id, this.customCatalogs);
    return true;
  }

  private async requirePendingSecretCleanupResolved(id: string): Promise<void> {
    if (!this.pendingSecretCleanups.has(id)) return;
    const resolved = await this.retryPendingSecretCleanup(id);
    if (!resolved) throw new Error("Pending catalog secret cleanup failed");
  }

  private requireBuiltIn(id: string): void {
    if (!builtInIds.has(id)) throw new Error("Built-in catalog not found");
  }

  private toBuiltInCatalog(definition: BuiltInCatalogDefinition): OpdsCatalog {
    return {
      ...definition,
      enabled: true,
      builtIn: true,
      hidden: this.hiddenBuiltInIds.has(definition.id),
      auth: "anonymous",
      passwordStorage: "none",
    };
  }

  private toCustomCatalog(definition: CustomCatalogDefinition): OpdsCatalog {
    const storage = this.passwordStorage.get(definition.id);
    return {
      ...definition,
      builtIn: false,
      hidden: false,
      passwordStorage:
        this.pendingSecretCleanups.has(definition.id) && storage !== "session-only"
          ? "none"
          : (storage ?? "none"),
    };
  }
}
