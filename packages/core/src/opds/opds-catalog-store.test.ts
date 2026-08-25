import { describe, expect, it, vi } from "vitest";
import {
  OPDS_BUILT_IN_CATALOGS,
  OPDS_CATALOG_STORAGE_KEY,
  type OpdsCatalogInput,
  type OpdsCatalogStorage,
  OpdsCatalogStore,
  type OpdsCatalogUpdate,
  opdsCatalogSecretKey,
} from "./opds-catalog-store";

const CUSTOM_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createStorage(initial: string | null = null) {
  let persisted = initial;
  const secrets = new Map<string, string>();
  const storage = {
    kvGetItem: vi.fn(async () => persisted),
    kvSetItem: vi.fn(async (_key: string, value: string) => {
      persisted = value;
    }),
    secretGetItem: vi.fn(async (key: string) => secrets.get(key) ?? null),
    secretSetItem: vi.fn(async (key: string, value: string) => {
      secrets.set(key, value);
    }),
    secretRemoveItem: vi.fn(async (key: string) => {
      secrets.delete(key);
    }),
  } satisfies OpdsCatalogStorage;
  return {
    storage,
    secrets,
    persisted: () => persisted,
    setPersisted: (value: string | null) => {
      persisted = value;
    },
  };
}

describe("OpdsCatalogStore", () => {
  it.each(["persistent", "session-only"] as const)(
    "preserves a %s Basic password across same-origin path and display edits",
    async (mode) => {
      const { storage: fullStorage } = createStorage();
      const storage =
        mode === "persistent"
          ? fullStorage
          : { kvGetItem: fullStorage.kvGetItem, kvSetItem: fullStorage.kvSetItem };
      const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
      await store.load();
      await store.addCatalog({
        name: "Private",
        url: "https://catalog.test/opds",
        auth: "basic",
        username: "reader",
        password: "old-password",
      });

      const updated = await store.updateCatalog(CUSTOM_ID, {
        name: "Renamed",
        url: "https://catalog.test/opds/v2",
      });

      expect(updated.passwordStorage).toBe(mode);
      await expect(store.getCredentials(CUSTOM_ID)).resolves.toMatchObject({
        username: "reader",
        password: "old-password",
        catalogOrigin: "https://catalog.test",
      });
    },
  );

  it.each([
    ["origin", { url: "https://other.test/opds" }],
    ["username", { username: "other-reader" }],
    ["anonymous to Basic auth", { auth: "basic", username: "reader" }],
  ] as const)(
    "rejects a blank password before mutating a changed %s identity",
    async (_name, update) => {
      const { storage, persisted } = createStorage();
      const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
      await store.load();
      if (_name === "anonymous to Basic auth") {
        await store.addCatalog({
          name: "Catalog",
          url: "https://catalog.test/opds",
          auth: "anonymous",
        });
      } else {
        await store.addCatalog({
          name: "Private",
          url: "https://catalog.test/opds",
          auth: "basic",
          username: "reader",
          password: "old-password",
        });
      }
      const before = persisted();

      await expect(store.updateCatalog(CUSTOM_ID, update)).rejects.toThrow(
        "A password is required when changing catalog credentials",
      );
      expect(persisted()).toBe(before);
    },
  );

  it("provides the two stable Gutenberg catalogs with immutable URLs", async () => {
    const { storage } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();

    expect(OPDS_BUILT_IN_CATALOGS.map(({ id, url }) => ({ id, url }))).toEqual([
      { id: "gutenberg", url: "https://www.gutenberg.org/ebooks/search.opds/" },
      {
        id: "gutenberg-zh",
        url: "https://www.gutenberg.org/ebooks/search.opds/?query=l.zh",
      },
    ]);
    expect(store.getCatalog("gutenberg-zh")?.url).toBe(
      "https://www.gutenberg.org/ebooks/search.opds/?query=l.zh",
    );
    await expect(
      store.updateCatalog("gutenberg", { url: "https://attacker.test/catalog" }),
    ).rejects.toThrow("Built-in catalogs cannot be edited");
    expect(store.getCatalog("gutenberg")?.url).toBe(
      "https://www.gutenberg.org/ebooks/search.opds/",
    );
  });

  it("adds, edits, disables, enables, and deletes a custom catalog", async () => {
    const { storage } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();

    const catalog = await store.addCatalog({
      name: "My catalog",
      url: "https://catalog.test/opds",
      auth: "anonymous",
    });
    expect(catalog).toMatchObject({ id: CUSTOM_ID, enabled: true, builtIn: false });

    await store.updateCatalog(CUSTOM_ID, { name: "Renamed" });
    await store.setCatalogEnabled(CUSTOM_ID, false);
    expect(store.getCatalog(CUSTOM_ID)).toMatchObject({ name: "Renamed", enabled: false });
    await store.setCatalogEnabled(CUSTOM_ID, true);
    expect(store.getCatalog(CUSTOM_ID)?.enabled).toBe(true);

    await store.removeCatalog(CUSTOM_ID);
    expect(store.getCatalog(CUSTOM_ID)).toBeUndefined();
  });

  it("does not expose or secret-store an add rejected by KV persistence", async () => {
    const { storage, persisted, secrets } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    vi.mocked(storage.kvSetItem).mockRejectedValueOnce(new Error("write failed"));

    await expect(
      store.addCatalog({
        name: "Rejected",
        url: "https://catalog.test/opds",
        auth: "basic",
        username: "reader",
        password: "must-not-survive",
      }),
    ).rejects.toThrow("write failed");

    expect(store.getCatalog(CUSTOM_ID)).toBeUndefined();
    expect(persisted()).toBeNull();
    expect(secrets.size).toBe(0);
    expect(storage.secretSetItem).not.toHaveBeenCalled();
  });

  it("retains the full catalog and credential snapshot when update persistence fails", async () => {
    const { storage, persisted, secrets } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Original",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "original-password",
    });
    const before = persisted();
    vi.mocked(storage.kvSetItem).mockRejectedValueOnce(new Error("write failed"));
    vi.mocked(storage.secretRemoveItem).mockClear();

    await expect(
      store.updateCatalog(CUSTOM_ID, {
        name: "Rejected",
        url: "https://other.test/opds",
        username: "other-reader",
        password: "new-password",
      }),
    ).rejects.toThrow("write failed");

    expect(persisted()).toBe(before);
    expect(store.getCatalog(CUSTOM_ID)).toMatchObject({
      name: "Original",
      url: "https://catalog.test/opds",
      username: "reader",
      passwordStorage: "persistent",
    });
    expect(secrets.get(opdsCatalogSecretKey(CUSTOM_ID))).toBe("original-password");
    expect(storage.secretRemoveItem).not.toHaveBeenCalled();
  });

  it("rolls persisted update identity back when secret removal fails", async () => {
    const { storage, persisted, secrets } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Original",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "original-password",
    });
    const before = persisted();
    vi.mocked(storage.kvSetItem).mockClear();
    vi.mocked(storage.secretRemoveItem).mockRejectedValueOnce(new Error("remove failed"));
    vi.mocked(storage.secretSetItem).mockClear();

    await expect(
      store.updateCatalog(CUSTOM_ID, { url: "https://other.test/opds", password: "new-password" }),
    ).rejects.toThrow("remove failed");

    expect(storage.kvSetItem).toHaveBeenCalledTimes(2);
    expect(persisted()).toBe(before);
    expect(store.getCatalog(CUSTOM_ID)).toMatchObject({
      url: "https://catalog.test/opds",
      passwordStorage: "persistent",
    });
    expect(secrets.get(opdsCatalogSecretKey(CUSTOM_ID))).toBe("original-password");
    expect(storage.secretSetItem).toHaveBeenCalledWith(
      opdsCatalogSecretKey(CUSTOM_ID),
      "original-password",
    );
  });

  it("aborts identity update before side effects when the compensation secret cannot be read", async () => {
    const { storage, persisted, secrets } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Original",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "original-password",
    });
    const before = persisted();
    vi.mocked(storage.kvSetItem).mockClear();
    vi.mocked(storage.secretGetItem).mockRejectedValueOnce(new Error("secret read failed"));

    await expect(
      store.updateCatalog(CUSTOM_ID, { url: "https://other.test/opds", password: "new-password" }),
    ).rejects.toThrow("secret read failed");
    expect(storage.kvSetItem).not.toHaveBeenCalled();
    expect(persisted()).toBe(before);
    expect(store.getCatalog(CUSTOM_ID)).toMatchObject({
      url: "https://catalog.test/opds",
      passwordStorage: "persistent",
    });
    expect(secrets.get(opdsCatalogSecretKey(CUSTOM_ID))).toBe("original-password");
  });

  it("rolls KV back and retains a truthful session credential when secret compensation fails", async () => {
    const { storage, persisted, secrets } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Original",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "original-password",
    });
    const before = persisted();
    vi.mocked(storage.secretRemoveItem).mockRejectedValueOnce(new Error("remove failed"));
    vi.mocked(storage.secretSetItem).mockRejectedValueOnce(new Error("restore failed"));

    await expect(
      store.updateCatalog(CUSTOM_ID, { url: "https://other.test/opds", password: "new-password" }),
    ).rejects.toThrow("Catalog update failed and secret compensation failed");

    expect(persisted()).toBe(before);
    expect(store.getCatalog(CUSTOM_ID)).toMatchObject({
      url: "https://catalog.test/opds",
      passwordStorage: "session-only",
    });
    expect(secrets.get(opdsCatalogSecretKey(CUSTOM_ID))).toBe("original-password");
    await expect(store.getCredentials(CUSTOM_ID)).resolves.toEqual({
      username: "reader",
      password: "original-password",
      catalogOrigin: "https://catalog.test",
    });
  });

  it("blocks stale credentials and reports a compound error when update rollback also fails", async () => {
    const { storage, persisted, secrets, setPersisted } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Original",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "original-password",
    });
    vi.mocked(storage.kvSetItem)
      .mockImplementationOnce(async (_key, value) => setPersisted(value))
      .mockRejectedValueOnce(new Error("rollback write leaked a backend detail"));
    vi.mocked(storage.secretRemoveItem).mockRejectedValueOnce(new Error("remove failed"));

    await expect(
      store.updateCatalog(CUSTOM_ID, { url: "https://other.test/opds", password: "new-password" }),
    ).rejects.toThrow("Catalog update failed and rollback failed");

    expect(store.getCatalog(CUSTOM_ID)).toMatchObject({
      url: "https://other.test/opds",
      passwordStorage: "session-only",
    });
    expect(JSON.parse(persisted() ?? "{}").customCatalogs[0].url).toBe("https://other.test/opds");
    expect(storage.secretRemoveItem).toHaveBeenCalledTimes(2);
    expect(secrets.has(opdsCatalogSecretKey(CUSTOM_ID))).toBe(false);
    await expect(store.getCredentials(CUSTOM_ID)).resolves.toMatchObject({
      password: "new-password",
      catalogOrigin: "https://other.test",
    });
  });

  it("durably blocks a stale update secret across restart until cleanup succeeds", async () => {
    const { storage, persisted, secrets, setPersisted } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Original",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "original-password",
    });

    let writeAttempt = 0;
    vi.mocked(storage.kvSetItem).mockImplementation(async (_key, value) => {
      writeAttempt += 1;
      if (writeAttempt === 2) throw new Error("rollback failed");
      setPersisted(value);
    });
    let removeAttempt = 0;
    vi.mocked(storage.secretRemoveItem).mockImplementation(async (key) => {
      removeAttempt += 1;
      if (removeAttempt <= 3) throw new Error("remove failed");
      secrets.delete(key);
    });

    await expect(
      store.updateCatalog(CUSTOM_ID, { url: "https://other.test/opds", password: "new-password" }),
    ).rejects.toThrow("Catalog update failed and rollback failed");

    const failedState = JSON.parse(persisted() ?? "{}");
    expect(failedState.customCatalogs[0].url).toBe("https://other.test/opds");
    expect(failedState.pendingSecretCleanups).toEqual([
      { id: CUSTOM_ID, revision: 1, action: "remove-secret" },
    ]);
    expect(JSON.stringify(failedState)).not.toContain("original-password");

    vi.mocked(storage.secretGetItem).mockClear();
    const reloaded = new OpdsCatalogStore(storage, () => OTHER_ID);
    await reloaded.load();
    expect(removeAttempt).toBe(3);
    await expect(reloaded.getCredentials(CUSTOM_ID)).resolves.toBeUndefined();
    expect(storage.secretGetItem).not.toHaveBeenCalledWith(opdsCatalogSecretKey(CUSTOM_ID));

    await reloaded.updateCatalog(CUSTOM_ID, { name: "Cleanup retried" });
    expect(removeAttempt).toBe(4);
    expect(JSON.parse(persisted() ?? "{}").pendingSecretCleanups).toBeUndefined();
    expect(secrets.has(opdsCatalogSecretKey(CUSTOM_ID))).toBe(false);
    await expect(reloaded.getCredentials(CUSTOM_ID)).resolves.toBeUndefined();
  });

  it("uses only the new session password when identity replacement cannot persist its secret", async () => {
    const { storage, secrets } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Original",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "original-password",
    });
    vi.mocked(storage.secretSetItem).mockRejectedValueOnce(new Error("set failed"));

    const updated = await store.updateCatalog(CUSTOM_ID, {
      url: "https://other.test/opds",
      password: "new-session-password",
    });

    expect(updated.passwordStorage).toBe("session-only");
    expect(secrets.has(opdsCatalogSecretKey(CUSTOM_ID))).toBe(false);
    await expect(store.getCredentials(CUSTOM_ID)).resolves.toEqual({
      username: "reader",
      password: "new-session-password",
      catalogOrigin: "https://other.test",
    });
  });

  it("retains the full catalog and credential snapshot when delete persistence fails", async () => {
    const { storage, persisted, secrets } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Original",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "original-password",
    });
    const before = persisted();
    vi.mocked(storage.kvSetItem).mockRejectedValueOnce(new Error("write failed"));
    vi.mocked(storage.secretRemoveItem).mockClear();

    await expect(store.removeCatalog(CUSTOM_ID)).rejects.toThrow("write failed");
    expect(persisted()).toBe(before);
    expect(store.getCatalog(CUSTOM_ID)).toMatchObject({ passwordStorage: "persistent" });
    expect(secrets.get(opdsCatalogSecretKey(CUSTOM_ID))).toBe("original-password");
    expect(storage.secretRemoveItem).not.toHaveBeenCalled();
  });

  it("rolls persisted deletion back when secret removal fails", async () => {
    const { storage, persisted, secrets } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Original",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "original-password",
    });
    const before = persisted();
    vi.mocked(storage.kvSetItem).mockClear();
    vi.mocked(storage.secretRemoveItem).mockRejectedValueOnce(new Error("remove failed"));
    vi.mocked(storage.secretSetItem).mockClear();

    await expect(store.removeCatalog(CUSTOM_ID)).rejects.toThrow("remove failed");
    expect(storage.kvSetItem).toHaveBeenCalledTimes(2);
    expect(persisted()).toBe(before);
    expect(store.getCatalog(CUSTOM_ID)).toMatchObject({ passwordStorage: "persistent" });
    expect(secrets.get(opdsCatalogSecretKey(CUSTOM_ID))).toBe("original-password");
    expect(storage.secretSetItem).toHaveBeenCalledWith(
      opdsCatalogSecretKey(CUSTOM_ID),
      "original-password",
    );
  });

  it("aborts deletion before side effects when the compensation secret cannot be read", async () => {
    const { storage, persisted, secrets } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Original",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "original-password",
    });
    const before = persisted();
    vi.mocked(storage.kvSetItem).mockClear();
    vi.mocked(storage.secretGetItem).mockRejectedValueOnce(new Error("secret read failed"));

    await expect(store.removeCatalog(CUSTOM_ID)).rejects.toThrow("secret read failed");
    expect(storage.kvSetItem).not.toHaveBeenCalled();
    expect(persisted()).toBe(before);
    expect(store.getCatalog(CUSTOM_ID)).toMatchObject({ passwordStorage: "persistent" });
    expect(secrets.get(opdsCatalogSecretKey(CUSTOM_ID))).toBe("original-password");
  });

  it("persists a deletion cleanup tombstone and removes the orphan after restart", async () => {
    const { storage, persisted, secrets, setPersisted } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Original",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "orphan-password",
    });

    let writeAttempt = 0;
    vi.mocked(storage.kvSetItem).mockImplementation(async (_key, value) => {
      writeAttempt += 1;
      if (writeAttempt === 2) throw new Error("rollback failed");
      setPersisted(value);
    });
    let removeAttempt = 0;
    vi.mocked(storage.secretRemoveItem).mockImplementation(async (key) => {
      removeAttempt += 1;
      if (removeAttempt <= 2) throw new Error("remove failed");
      secrets.delete(key);
    });

    await expect(store.removeCatalog(CUSTOM_ID)).rejects.toThrow(
      "Catalog removal failed and rollback failed",
    );
    expect(JSON.parse(persisted() ?? "{}")).toMatchObject({
      customCatalogs: [],
      pendingSecretCleanups: [{ id: CUSTOM_ID, revision: 1, action: "remove-secret" }],
    });
    expect(secrets.get(opdsCatalogSecretKey(CUSTOM_ID))).toBe("orphan-password");

    const reloaded = new OpdsCatalogStore(storage, () => OTHER_ID);
    await reloaded.load();

    expect(removeAttempt).toBe(3);
    expect(secrets.has(opdsCatalogSecretKey(CUSTOM_ID))).toBe(false);
    expect(JSON.parse(persisted() ?? "{}").pendingSecretCleanups).toBeUndefined();
    expect(reloaded.getCatalog(CUSTOM_ID)).toBeUndefined();
  });

  it("stays fail-closed when clearing a completed cleanup tombstone cannot persist", async () => {
    const initial = JSON.stringify({
      version: 1,
      customCatalogs: [
        {
          id: CUSTOM_ID,
          name: "Changed",
          url: "https://other.test/opds",
          enabled: true,
          auth: "basic",
          username: "reader",
        },
      ],
      hiddenBuiltInIds: [],
      pendingSecretCleanups: [{ id: CUSTOM_ID, revision: 7, action: "remove-secret" }],
    });
    const { storage, persisted, secrets, setPersisted } = createStorage(initial);
    secrets.set(opdsCatalogSecretKey(CUSTOM_ID), "stale-password");
    vi.mocked(storage.kvSetItem)
      .mockImplementationOnce(async (_key, value) => setPersisted(value))
      .mockRejectedValueOnce(new Error("cleanup marker write failed"));
    const store = new OpdsCatalogStore(storage, () => OTHER_ID);

    await expect(store.load()).rejects.toThrow("cleanup marker write failed");

    expect(secrets.has(opdsCatalogSecretKey(CUSTOM_ID))).toBe(false);
    expect(JSON.parse(persisted() ?? "{}").pendingSecretCleanups).toHaveLength(1);
    await expect(store.getCredentials(CUSTOM_ID)).resolves.toBeUndefined();

    await expect(store.load()).resolves.toBeUndefined();
    expect(JSON.parse(persisted() ?? "{}").pendingSecretCleanups).toBeUndefined();
    await expect(
      store.updateCatalog(CUSTOM_ID, { name: "Queue recovered" }),
    ).resolves.toMatchObject({ name: "Queue recovered" });
  });

  it("sanitizes cleanup tombstones and prevents ID reuse while cleanup is pending", async () => {
    const initial = JSON.stringify({
      version: 1,
      customCatalogs: [],
      hiddenBuiltInIds: [],
      pendingSecretCleanups: [
        { id: CUSTOM_ID, revision: 2, action: "remove-secret" },
        { id: CUSTOM_ID, revision: 4, action: "remove-secret" },
        { id: "gutenberg", revision: 9, action: "remove-secret" },
        { id: OTHER_ID, revision: -1, action: "remove-secret" },
        { id: OTHER_ID, revision: 3, action: "restore-secret" },
        { id: "__proto__", revision: 5, action: "remove-secret" },
      ],
    });
    const { storage, persisted } = createStorage(initial);
    vi.mocked(storage.secretRemoveItem).mockRejectedValue(new Error("still unavailable"));
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);

    await store.load();

    expect(JSON.parse(persisted() ?? "{}").pendingSecretCleanups).toEqual([
      { id: CUSTOM_ID, revision: 4, action: "remove-secret" },
      { id: OTHER_ID, revision: 0, action: "remove-secret" },
    ]);
    await expect(
      store.addCatalog({
        name: "Must not reuse",
        url: "https://catalog.test/opds",
        auth: "anonymous",
      }),
    ).rejects.toThrow("Could not generate a unique catalog id");
    expect(store.getCatalog(CUSTOM_ID)).toBeUndefined();
  });

  it.each([
    { revision: "not-a-revision", action: "remove-secret" },
    { revision: 3, action: "restore-secret" },
  ])(
    "quarantines a valid catalog id when its cleanup marker is malformed: %o",
    async ({ revision, action }) => {
      const initial = JSON.stringify({
        version: 1,
        customCatalogs: [
          {
            id: CUSTOM_ID,
            name: "Changed identity",
            url: "https://other.test/opds",
            enabled: true,
            auth: "basic",
            username: "reader",
          },
        ],
        hiddenBuiltInIds: [],
        pendingSecretCleanups: [{ id: CUSTOM_ID, revision, action }],
      });
      const { storage, persisted, secrets } = createStorage(initial);
      secrets.set(opdsCatalogSecretKey(CUSTOM_ID), "old-identity-password");
      vi.mocked(storage.secretRemoveItem).mockRejectedValue(new Error("cleanup unavailable"));
      const store = new OpdsCatalogStore(storage, () => OTHER_ID);

      await store.load();

      expect(JSON.parse(persisted() ?? "{}").pendingSecretCleanups).toEqual([
        { id: CUSTOM_ID, revision: 0, action: "remove-secret" },
      ]);
      await expect(store.getCredentials(CUSTOM_ID)).resolves.toBeUndefined();
      expect(storage.secretGetItem).not.toHaveBeenCalled();

      const fresh = new OpdsCatalogStore(storage, () => OTHER_ID);
      await fresh.load();
      await expect(fresh.getCredentials(CUSTOM_ID)).resolves.toBeUndefined();
      expect(JSON.parse(persisted() ?? "{}").pendingSecretCleanups).toHaveLength(1);
    },
  );

  it("rejects a non-array cleanup field without adopting the possibly changed identity", async () => {
    const initial = JSON.stringify({
      version: 1,
      customCatalogs: [
        {
          id: CUSTOM_ID,
          name: "Changed identity",
          url: "https://other.test/opds",
          enabled: true,
          auth: "basic",
          username: "reader",
        },
      ],
      hiddenBuiltInIds: [],
      pendingSecretCleanups: { id: CUSTOM_ID },
    });
    const { storage, persisted, secrets } = createStorage(initial);
    secrets.set(opdsCatalogSecretKey(CUSTOM_ID), "old-identity-password");
    const store = new OpdsCatalogStore(storage, () => OTHER_ID);

    await expect(store.load()).rejects.toThrow("Catalog cleanup storage is invalid");

    expect(store.getCatalog(CUSTOM_ID)).toBeUndefined();
    await expect(store.getCredentials(CUSTOM_ID)).resolves.toBeUndefined();
    expect(storage.secretGetItem).not.toHaveBeenCalled();
    expect(persisted()).toBe(initial);
  });

  it("fails closed instead of overflowing a cleanup revision", async () => {
    const initial = JSON.stringify({
      version: 1,
      customCatalogs: [
        {
          id: CUSTOM_ID,
          name: "Original",
          url: "https://catalog.test/opds",
          enabled: true,
          auth: "basic",
          username: "reader",
        },
      ],
      hiddenBuiltInIds: [],
      pendingSecretCleanups: [
        {
          id: OTHER_ID,
          revision: Number.MAX_SAFE_INTEGER,
          action: "remove-secret",
        },
      ],
    });
    const { storage, persisted, secrets } = createStorage(initial);
    secrets.set(opdsCatalogSecretKey(CUSTOM_ID), "original-password");
    vi.mocked(storage.secretRemoveItem).mockRejectedValue(new Error("cleanup unavailable"));
    const store = new OpdsCatalogStore(storage, () => "33333333-3333-4333-8333-333333333333");
    await store.load();
    const before = persisted();
    vi.mocked(storage.kvSetItem).mockClear();

    await expect(
      store.updateCatalog(CUSTOM_ID, { url: "https://other.test/opds", password: "new-password" }),
    ).rejects.toThrow("Catalog cleanup revision is exhausted");

    expect(storage.kvSetItem).not.toHaveBeenCalled();
    expect(persisted()).toBe(before);
    expect(store.getCatalog(CUSTOM_ID)?.url).toBe("https://catalog.test/opds");
    await expect(store.getCredentials(CUSTOM_ID)).resolves.toMatchObject({
      password: "original-password",
      catalogOrigin: "https://catalog.test",
    });
  });

  it("serializes cleanup completion before a following edit", async () => {
    const initial = JSON.stringify({
      version: 1,
      customCatalogs: [
        {
          id: CUSTOM_ID,
          name: "Changed",
          url: "https://other.test/opds",
          enabled: true,
          auth: "basic",
          username: "reader",
        },
      ],
      hiddenBuiltInIds: [],
      pendingSecretCleanups: [{ id: CUSTOM_ID, revision: 3, action: "remove-secret" }],
    });
    const { storage, setPersisted } = createStorage(initial);
    const removal = deferred<void>();
    vi.mocked(storage.secretRemoveItem).mockImplementationOnce(() => removal.promise);
    vi.mocked(storage.kvSetItem).mockImplementation(async (_key, value) => setPersisted(value));
    const store = new OpdsCatalogStore(storage, () => OTHER_ID);

    const loading = store.load();
    await vi.waitFor(() => expect(storage.secretRemoveItem).toHaveBeenCalledTimes(1));
    const editing = store.updateCatalog(CUSTOM_ID, { name: "After cleanup" });
    await Promise.resolve();
    expect(storage.kvSetItem).toHaveBeenCalledTimes(1);

    removal.resolve();
    await loading;
    await editing;

    expect(store.getCatalog(CUSTOM_ID)?.name).toBe("After cleanup");
    expect(storage.kvSetItem).toHaveBeenCalledTimes(3);
  });

  it("keeps built-in visibility failure-atomic when KV persistence rejects", async () => {
    const { storage } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    vi.mocked(storage.kvSetItem).mockRejectedValueOnce(new Error("hide failed"));

    await expect(store.hideBuiltIn("gutenberg")).rejects.toThrow("hide failed");
    expect(store.getCatalog("gutenberg")?.hidden).toBe(false);

    await store.hideBuiltIn("gutenberg");
    vi.mocked(storage.kvSetItem).mockRejectedValueOnce(new Error("restore failed"));
    await expect(store.restoreBuiltIn("gutenberg")).rejects.toThrow("restore failed");
    expect(store.getCatalog("gutenberg")?.hidden).toBe(true);
  });

  it("serializes concurrent mutations so delayed writes cannot overwrite a newer snapshot", async () => {
    const { storage, persisted, setPersisted } = createStorage();
    const firstWrite = deferred<void>();
    let writes = 0;
    vi.mocked(storage.kvSetItem).mockImplementation(async (_key, value) => {
      writes += 1;
      if (writes === 1) await firstWrite.promise;
      setPersisted(value);
    });
    const ids = [CUSTOM_ID, OTHER_ID];
    const store = new OpdsCatalogStore(storage, () => ids.shift() ?? "missing");
    await store.load();

    const first = store.addCatalog({
      name: "First",
      url: "https://first.test/opds",
      auth: "anonymous",
    });
    await vi.waitFor(() => expect(storage.kvSetItem).toHaveBeenCalledTimes(1));
    const second = store.addCatalog({
      name: "Second",
      url: "https://second.test/opds",
      auth: "anonymous",
    });
    await Promise.resolve();
    expect(storage.kvSetItem).toHaveBeenCalledTimes(1);

    firstWrite.resolve();
    await Promise.all([first, second]);

    expect(store.listCatalogs({ includeHidden: true }).map(({ id }) => id)).toEqual([
      "gutenberg",
      "gutenberg-zh",
      CUSTOM_ID,
      OTHER_ID,
    ]);
    expect(
      JSON.parse(persisted() ?? "{}").customCatalogs.map(({ id }: { id: string }) => id),
    ).toEqual([CUSTOM_ID, OTHER_ID]);
  });

  it("serializes load with following mutations so an older load cannot overwrite an add", async () => {
    const initial = JSON.stringify({
      version: 1,
      customCatalogs: [
        {
          id: OTHER_ID,
          name: "Loaded",
          url: "https://loaded.test/opds",
          enabled: true,
          auth: "anonymous",
        },
      ],
      hiddenBuiltInIds: [],
    });
    const { storage, persisted, setPersisted } = createStorage(initial);
    const pendingRead = deferred<string | null>();
    vi.mocked(storage.kvGetItem).mockImplementationOnce(() => pendingRead.promise);
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);

    const loading = store.load();
    const adding = store.addCatalog({
      name: "Added",
      url: "https://added.test/opds",
      auth: "anonymous",
    });
    await Promise.resolve();
    expect(storage.kvSetItem).not.toHaveBeenCalled();
    pendingRead.resolve(initial);
    vi.mocked(storage.kvSetItem).mockImplementation(async (_key, value) => setPersisted(value));
    await Promise.all([loading, adding]);

    expect(
      JSON.parse(persisted() ?? "{}").customCatalogs.map(({ id }: { id: string }) => id),
    ).toEqual([OTHER_ID, CUSTOM_ID]);
  });

  it("persists only versioned definitions and built-in hidden state, never passwords", async () => {
    const { storage, persisted } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Private",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "secret-password",
    });
    await store.hideBuiltIn("gutenberg");

    const raw = persisted();
    expect(storage.kvSetItem).toHaveBeenCalledWith(OPDS_CATALOG_STORAGE_KEY, expect.any(String));
    expect(raw).not.toBeNull();
    expect(raw).not.toContain("secret-password");
    expect(raw).not.toContain("Authorization");
    expect(JSON.parse(raw ?? "{}")).toEqual({
      version: 1,
      customCatalogs: [
        {
          id: CUSTOM_ID,
          name: "Private",
          url: "https://catalog.test/opds",
          enabled: true,
          auth: "basic",
          username: "reader",
        },
      ],
      hiddenBuiltInIds: ["gutenberg"],
    });
  });

  it("hides and restores built-ins without deleting their definitions", async () => {
    const { storage } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();

    await store.hideBuiltIn("gutenberg-zh");
    expect(store.listCatalogs().map((catalog) => catalog.id)).not.toContain("gutenberg-zh");
    expect(store.getCatalog("gutenberg-zh")?.hidden).toBe(true);
    await store.restoreBuiltIn("gutenberg-zh");
    expect(store.listCatalogs().map((catalog) => catalog.id)).toContain("gutenberg-zh");
  });

  it("reload clears session credentials before accepting a changed catalog identity", async () => {
    const { storage: fullStorage, setPersisted } = createStorage();
    const storage: OpdsCatalogStorage = {
      kvGetItem: fullStorage.kvGetItem,
      kvSetItem: fullStorage.kvSetItem,
    };
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Session catalog",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "session-password",
    });
    setPersisted(
      JSON.stringify({
        version: 1,
        customCatalogs: [
          {
            id: CUSTOM_ID,
            name: "Changed elsewhere",
            url: "https://other.test/opds",
            enabled: true,
            auth: "basic",
            username: "other-reader",
          },
        ],
        hiddenBuiltInIds: [],
      }),
    );

    await store.load();

    expect(store.getCatalog(CUSTOM_ID)).toMatchObject({
      url: "https://other.test/opds",
      username: "other-reader",
      passwordStorage: "none",
    });
    await expect(store.getCredentials(CUSTOM_ID)).resolves.toBeUndefined();
  });

  it("retains the complete live snapshot when persisted catalog read fails", async () => {
    const { storage: fullStorage } = createStorage();
    const storage: OpdsCatalogStorage = {
      kvGetItem: fullStorage.kvGetItem,
      kvSetItem: fullStorage.kvSetItem,
    };
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Session catalog",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "session-password",
    });
    vi.mocked(fullStorage.kvGetItem).mockRejectedValueOnce(new Error("read failed"));

    await expect(store.load()).rejects.toThrow("read failed");
    expect(store.getCatalog(CUSTOM_ID)).toMatchObject({
      name: "Session catalog",
      passwordStorage: "session-only",
    });
    await expect(store.getCredentials(CUSTOM_ID)).resolves.toMatchObject({
      password: "session-password",
    });
  });

  it("retains the complete live snapshot when canonical persistence during reload fails", async () => {
    const { storage: fullStorage, setPersisted } = createStorage();
    const storage: OpdsCatalogStorage = {
      kvGetItem: fullStorage.kvGetItem,
      kvSetItem: fullStorage.kvSetItem,
    };
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Session catalog",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "session-password",
    });
    setPersisted(
      JSON.stringify({
        version: 1,
        customCatalogs: [
          {
            id: OTHER_ID,
            name: "Other catalog",
            url: "https://other.test/opds",
            enabled: true,
            auth: "anonymous",
          },
        ],
        hiddenBuiltInIds: ["gutenberg"],
      }),
    );
    vi.mocked(fullStorage.kvSetItem).mockRejectedValueOnce(new Error("write failed"));

    await expect(store.load()).rejects.toThrow("write failed");
    expect(store.getCatalog(CUSTOM_ID)).toMatchObject({
      name: "Session catalog",
      passwordStorage: "session-only",
    });
    expect(store.getCatalog(OTHER_ID)).toBeUndefined();
    expect(store.getCatalog("gutenberg")?.hidden).toBe(false);
    await expect(store.getCredentials(CUSTOM_ID)).resolves.toMatchObject({
      password: "session-password",
    });
  });

  it("removes a catalog secret on delete and treats a missing secret as idempotent", async () => {
    const { storage } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Private",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
    });

    await expect(store.removeCatalog(CUSTOM_ID)).resolves.toBe(true);
    expect(storage.secretRemoveItem).toHaveBeenCalledWith(`opds.catalog.${CUSTOM_ID}.password`);
    await expect(store.removeCatalog(CUSTOM_ID)).resolves.toBe(false);
  });

  it("clears the old secret when URL or auth identity changes but retains it for display edits", async () => {
    const { storage } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Private",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "secret-password",
    });
    vi.mocked(storage.secretRemoveItem).mockClear();

    await store.updateCatalog(CUSTOM_ID, { name: "Still private" });
    expect(storage.secretRemoveItem).not.toHaveBeenCalled();
    await store.updateCatalog(CUSTOM_ID, {
      url: "https://other.test/opds",
      password: "new-password",
    });
    expect(storage.secretRemoveItem).toHaveBeenCalledWith(opdsCatalogSecretKey(CUSTOM_ID));

    vi.mocked(storage.secretRemoveItem).mockClear();
    await store.updateCatalog(CUSTOM_ID, { auth: "anonymous" });
    expect(storage.secretRemoveItem).toHaveBeenCalledWith(opdsCatalogSecretKey(CUSTOM_ID));
  });

  it("uses a per-instance session password when secret persistence is unavailable", async () => {
    const { storage: persistentStorage } = createStorage();
    const storage: OpdsCatalogStorage = {
      kvGetItem: persistentStorage.kvGetItem,
      kvSetItem: persistentStorage.kvSetItem,
    };
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();

    const catalog = await store.addCatalog({
      name: "Session catalog",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "session-password",
    });
    expect(catalog.passwordStorage).toBe("session-only");
    await expect(store.getCredentials(CUSTOM_ID)).resolves.toEqual({
      username: "reader",
      password: "session-password",
      catalogOrigin: "https://catalog.test",
    });

    const reloaded = new OpdsCatalogStore(storage, () => OTHER_ID);
    await reloaded.load();
    expect(reloaded.getCatalog(CUSTOM_ID)?.passwordStorage).toBe("none");
    await expect(reloaded.getCredentials(CUSTOM_ID)).resolves.toBeUndefined();
  });

  it("falls back to session-only without leaking a password when secret storage fails", async () => {
    const { storage, persisted } = createStorage();
    vi.mocked(storage.secretSetItem).mockRejectedValue(new Error("backend included a secret"));
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();

    const catalog = await store.addCatalog({
      name: "Private",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "never-persist-me",
    });

    expect(catalog.passwordStorage).toBe("session-only");
    expect(persisted()).not.toContain("never-persist-me");
    expect(JSON.stringify(store.listCatalogs({ includeHidden: true }))).not.toContain(
      "never-persist-me",
    );
  });

  it.each([true, false])(
    "rejects an anonymous password before touching complete=%s secret storage",
    async (complete) => {
      const { storage: fullStorage } = createStorage();
      const storage: OpdsCatalogStorage = complete
        ? fullStorage
        : { kvGetItem: fullStorage.kvGetItem, kvSetItem: fullStorage.kvSetItem };
      const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
      await store.load();
      vi.mocked(fullStorage.kvSetItem).mockClear();

      await expect(
        store.addCatalog({
          name: "Anonymous",
          url: "https://catalog.test/opds",
          auth: "anonymous",
          password: "must-not-be-stored",
        }),
      ).rejects.toThrow("Anonymous catalogs cannot have a password");
      expect(fullStorage.kvSetItem).not.toHaveBeenCalled();
      expect(fullStorage.secretSetItem).not.toHaveBeenCalled();
      expect(store.getCatalog(CUSTOM_ID)).toBeUndefined();
    },
  );

  it.each([
    ["enabled", { enabled: "yes" }],
    ["username", { auth: "basic", username: 7 }],
    ["password", { auth: "basic", username: "reader", password: 7 }],
  ])("rejects a runtime-invalid add %s before side effects", async (_field, invalid) => {
    const { storage } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    vi.mocked(storage.kvSetItem).mockClear();

    await expect(
      store.addCatalog({
        name: "Invalid",
        url: "https://catalog.test/opds",
        auth: "anonymous",
        ...invalid,
      } as unknown as OpdsCatalogInput),
    ).rejects.toThrow("Catalog input is invalid");
    expect(storage.kvSetItem).not.toHaveBeenCalled();
    expect(storage.secretSetItem).not.toHaveBeenCalled();
    expect(store.getCatalog(CUSTOM_ID)).toBeUndefined();
  });

  it.each([
    ["enabled", { enabled: "yes" }],
    ["username", { username: 7 }],
    ["password", { password: 7 }],
  ])("rejects a runtime-invalid update %s before side effects", async (_field, invalid) => {
    const { storage } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Valid",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "current-password",
    });
    vi.mocked(storage.kvSetItem).mockClear();
    vi.mocked(storage.secretSetItem).mockClear();
    vi.mocked(storage.secretRemoveItem).mockClear();

    await expect(
      store.updateCatalog(CUSTOM_ID, invalid as unknown as OpdsCatalogUpdate),
    ).rejects.toThrow("Catalog input is invalid");
    expect(storage.kvSetItem).not.toHaveBeenCalled();
    expect(storage.secretSetItem).not.toHaveBeenCalled();
    expect(storage.secretRemoveItem).not.toHaveBeenCalled();
    expect(store.getCatalog(CUSTOM_ID)).toMatchObject({
      name: "Valid",
      enabled: true,
      username: "reader",
      passwordStorage: "persistent",
    });
  });

  it("treats a partial secret adapter as unavailable instead of reusing an unremovable secret", async () => {
    const persisted = JSON.stringify({
      version: 1,
      customCatalogs: [
        {
          id: CUSTOM_ID,
          name: "Private",
          url: "https://catalog.test/opds",
          enabled: true,
          auth: "basic",
          username: "reader",
        },
      ],
      hiddenBuiltInIds: [],
    });
    const { storage: completeStorage, secrets } = createStorage(persisted);
    secrets.set(opdsCatalogSecretKey(CUSTOM_ID), "stale-password");
    const partialStorage: OpdsCatalogStorage = {
      kvGetItem: completeStorage.kvGetItem,
      kvSetItem: completeStorage.kvSetItem,
      secretGetItem: completeStorage.secretGetItem,
      secretSetItem: completeStorage.secretSetItem,
    };
    const store = new OpdsCatalogStore(partialStorage, () => OTHER_ID);
    await store.load();

    await expect(store.getCredentials(CUSTOM_ID)).resolves.toBeUndefined();
    const added = await store.addCatalog({
      name: "Session only",
      url: "https://other.test/opds",
      auth: "basic",
      username: "reader",
      password: "session-password",
    });
    expect(added.passwordStorage).toBe("session-only");
  });

  it("rejects an unsafe blank identity change through a missing secret adapter", async () => {
    const { storage, secrets, persisted } = createStorage();
    const complete = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await complete.load();
    await complete.addCatalog({
      name: "Private",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "old-password",
    });
    const missingStorage: OpdsCatalogStorage = {
      kvGetItem: storage.kvGetItem,
      kvSetItem: storage.kvSetItem,
    };
    const missing = new OpdsCatalogStore(missingStorage, () => OTHER_ID);
    await missing.load();

    await expect(
      missing.updateCatalog(CUSTOM_ID, { url: "https://other.test/opds" }),
    ).rejects.toThrow("A password is required when changing catalog credentials");

    expect(secrets.get(opdsCatalogSecretKey(CUSTOM_ID))).toBe("old-password");
    expect(JSON.parse(persisted() ?? "{}").pendingSecretCleanups).toBeUndefined();
    await expect(missing.getCredentials(CUSTOM_ID)).resolves.toBeUndefined();
    await missing.hideBuiltIn("gutenberg");
    await missing.restoreBuiltIn("gutenberg");
    expect(JSON.parse(persisted() ?? "{}").pendingSecretCleanups).toBeUndefined();

    vi.mocked(storage.secretRemoveItem).mockClear();
    const restored = new OpdsCatalogStore(storage, () => OTHER_ID);
    await restored.load();

    expect(storage.secretRemoveItem).not.toHaveBeenCalled();
    expect(secrets.has(opdsCatalogSecretKey(CUSTOM_ID))).toBe(true);
    expect(JSON.parse(persisted() ?? "{}").pendingSecretCleanups).toBeUndefined();
    await expect(restored.getCredentials(CUSTOM_ID)).resolves.toMatchObject({
      password: "old-password",
    });
  });

  it("allows safe missing-backend edits and deletion while retaining cleanup", async () => {
    const { storage, secrets, persisted } = createStorage();
    const complete = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await complete.load();
    await complete.addCatalog({
      name: "Private",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "old-password",
    });
    const missingStorage: OpdsCatalogStorage = {
      kvGetItem: storage.kvGetItem,
      kvSetItem: storage.kvSetItem,
    };
    const missing = new OpdsCatalogStore(missingStorage, () => OTHER_ID);
    await missing.load();
    vi.mocked(storage.secretGetItem).mockClear();
    vi.mocked(storage.secretSetItem).mockClear();
    vi.mocked(storage.secretRemoveItem).mockClear();

    await expect(missing.updateCatalog(CUSTOM_ID, { auth: "anonymous" })).resolves.toMatchObject({
      auth: "anonymous",
    });
    await expect(missing.updateCatalog(CUSTOM_ID, { name: "Renamed" })).resolves.toMatchObject({
      name: "Renamed",
    });
    await expect(missing.setCatalogEnabled(CUSTOM_ID, false)).resolves.toMatchObject({
      enabled: false,
    });
    await expect(missing.removeCatalog(CUSTOM_ID)).resolves.toBe(true);

    expect(missing.getCatalog(CUSTOM_ID)).toBeUndefined();
    expect(JSON.parse(persisted() ?? "{}")).toMatchObject({
      customCatalogs: [],
      pendingSecretCleanups: [{ id: CUSTOM_ID, revision: 1, action: "remove-secret" }],
    });
    expect(secrets.get(opdsCatalogSecretKey(CUSTOM_ID))).toBe("old-password");
    expect(storage.secretGetItem).not.toHaveBeenCalled();
    expect(storage.secretSetItem).not.toHaveBeenCalled();
    expect(storage.secretRemoveItem).not.toHaveBeenCalled();

    const restored = new OpdsCatalogStore(storage, () => OTHER_ID);
    await restored.load();

    expect(storage.secretRemoveItem).toHaveBeenCalledWith(opdsCatalogSecretKey(CUSTOM_ID));
    expect(secrets.has(opdsCatalogSecretKey(CUSTOM_ID))).toBe(false);
    expect(JSON.parse(persisted() ?? "{}").pendingSecretCleanups).toBeUndefined();
    expect(restored.getCatalog(CUSTOM_ID)).toBeUndefined();
    await expect(restored.getCredentials(CUSTOM_ID)).resolves.toBeUndefined();
  });

  it("uses only a new session password for identity edits while cleanup is pending", async () => {
    const { storage, secrets, persisted } = createStorage();
    const complete = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await complete.load();
    await complete.addCatalog({
      name: "Private",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "old-password",
    });
    const missingStorage: OpdsCatalogStorage = {
      kvGetItem: storage.kvGetItem,
      kvSetItem: storage.kvSetItem,
    };
    const missing = new OpdsCatalogStore(missingStorage, () => OTHER_ID);
    await missing.load();
    await missing.updateCatalog(CUSTOM_ID, {
      url: "https://other.test/opds",
      password: "intermediate-password",
    });
    vi.mocked(storage.secretGetItem).mockClear();
    vi.mocked(storage.secretSetItem).mockClear();
    vi.mocked(storage.secretRemoveItem).mockClear();

    const updated = await missing.updateCatalog(CUSTOM_ID, {
      url: "https://third.test/opds",
      password: "new-session-password",
    });

    expect(updated).toMatchObject({
      url: "https://third.test/opds",
      passwordStorage: "session-only",
    });
    await expect(missing.getCredentials(CUSTOM_ID)).resolves.toEqual({
      username: "reader",
      password: "new-session-password",
      catalogOrigin: "https://third.test",
    });
    expect(secrets.get(opdsCatalogSecretKey(CUSTOM_ID))).toBe("old-password");
    expect(JSON.parse(persisted() ?? "{}").pendingSecretCleanups).toEqual([
      { id: CUSTOM_ID, revision: 1, action: "remove-secret" },
    ]);
    expect(storage.secretGetItem).not.toHaveBeenCalled();
    expect(storage.secretSetItem).not.toHaveBeenCalled();
    expect(storage.secretRemoveItem).not.toHaveBeenCalled();
  });

  it("retains an orphan cleanup marker when deletion uses a partial adapter", async () => {
    const { storage, secrets, persisted } = createStorage();
    const complete = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await complete.load();
    await complete.addCatalog({
      name: "Private",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "old-password",
    });
    const partialStorage: OpdsCatalogStorage = {
      kvGetItem: storage.kvGetItem,
      kvSetItem: storage.kvSetItem,
      secretGetItem: storage.secretGetItem,
      secretSetItem: storage.secretSetItem,
    };
    const partial = new OpdsCatalogStore(partialStorage, () => OTHER_ID);
    await partial.load();

    await expect(partial.removeCatalog(CUSTOM_ID)).resolves.toBe(true);

    expect(partial.getCatalog(CUSTOM_ID)).toBeUndefined();
    expect(secrets.get(opdsCatalogSecretKey(CUSTOM_ID))).toBe("old-password");
    expect(JSON.parse(persisted() ?? "{}").pendingSecretCleanups).toEqual([
      { id: CUSTOM_ID, revision: 1, action: "remove-secret" },
    ]);

    vi.mocked(storage.secretRemoveItem).mockClear();
    const restored = new OpdsCatalogStore(storage, () => OTHER_ID);
    await restored.load();

    expect(storage.secretRemoveItem).toHaveBeenCalledWith(opdsCatalogSecretKey(CUSTOM_ID));
    expect(secrets.has(opdsCatalogSecretKey(CUSTOM_ID))).toBe(false);
    expect(JSON.parse(persisted() ?? "{}").pendingSecretCleanups).toBeUndefined();
    expect(restored.getCatalog(CUSTOM_ID)).toBeUndefined();
  });

  it("loads valid records while discarding userinfo URLs, invalid IDs, pollution keys, and duplicates", async () => {
    const persisted = JSON.stringify({
      version: 1,
      customCatalogs: [
        {
          id: CUSTOM_ID,
          name: "Good",
          url: "https://catalog.test/opds?query=books",
          enabled: true,
          auth: "anonymous",
        },
        {
          id: OTHER_ID,
          name: "Malicious URL",
          url: "https://user:password@catalog.test/opds",
          enabled: true,
          auth: "anonymous",
        },
        {
          id: "__proto__",
          name: "Pollution",
          url: "https://pollution.test/opds",
          enabled: true,
          auth: "anonymous",
        },
        {
          id: "gutenberg",
          name: "Fake built-in",
          url: "https://attacker.test/opds",
          enabled: true,
          auth: "anonymous",
        },
        {
          id: CUSTOM_ID,
          name: "Duplicate",
          url: "https://duplicate.test/opds",
          enabled: true,
          auth: "anonymous",
        },
      ],
      hiddenBuiltInIds: ["gutenberg-zh", "gutenberg-zh", "__proto__"],
      password: "must-be-ignored",
    });
    const { storage, persisted: saved } = createStorage(persisted);
    const store = new OpdsCatalogStore(storage, () => OTHER_ID);

    await expect(store.load()).resolves.toBeUndefined();
    expect(store.listCatalogs({ includeHidden: true }).map((catalog) => catalog.id)).toEqual([
      "gutenberg",
      "gutenberg-zh",
      CUSTOM_ID,
    ]);
    expect(store.getCatalog(CUSTOM_ID)?.url).toBe("https://catalog.test/opds?query=books");
    expect(store.getCatalog("gutenberg-zh")?.hidden).toBe(true);
    expect(Object.prototype.polluted).toBeUndefined();
    expect(saved()).not.toContain("must-be-ignored");
    expect(saved()).not.toContain("user:password");
  });

  it("does not collide secret keys for distinct catalog IDs", () => {
    expect(opdsCatalogSecretKey(CUSTOM_ID)).toBe(`opds.catalog.${CUSTOM_ID}.password`);
    expect(opdsCatalogSecretKey(OTHER_ID)).toBe(`opds.catalog.${OTHER_ID}.password`);
    expect(opdsCatalogSecretKey(CUSTOM_ID)).not.toBe(opdsCatalogSecretKey(OTHER_ID));
  });

  it("does not change catalog or password state when secret retrieval fails", async () => {
    const persisted = JSON.stringify({
      version: 1,
      customCatalogs: [
        {
          id: CUSTOM_ID,
          name: "Private",
          url: "https://catalog.test/opds",
          enabled: true,
          auth: "basic",
          username: "reader",
        },
      ],
      hiddenBuiltInIds: [],
    });
    const { storage } = createStorage(persisted);
    vi.mocked(storage.secretGetItem).mockRejectedValueOnce(new Error("read failed"));
    const store = new OpdsCatalogStore(storage, () => OTHER_ID);
    await store.load();

    await expect(store.getCredentials(CUSTOM_ID)).resolves.toBeUndefined();
    expect(store.getCatalog(CUSTOM_ID)).toMatchObject({
      url: "https://catalog.test/opds",
      passwordStorage: "none",
    });
  });

  it("does not return or resurrect a secret read that loses a race with identity update", async () => {
    const { storage } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Private",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "old-password",
    });
    const pendingSecret = deferred<string | null>();
    vi.mocked(storage.secretGetItem).mockImplementationOnce(() => pendingSecret.promise);

    const reading = store.getCredentials(CUSTOM_ID);
    await vi.waitFor(() => expect(storage.secretGetItem).toHaveBeenCalled());
    await store.updateCatalog(CUSTOM_ID, {
      url: "https://other.test/opds",
      password: "new-password",
    });
    pendingSecret.resolve("old-password");

    await expect(reading).resolves.toBeUndefined();
    expect(store.getCatalog(CUSTOM_ID)?.passwordStorage).toBe("persistent");
    await expect(store.getCredentials(CUSTOM_ID)).resolves.toMatchObject({
      password: "new-password",
      catalogOrigin: "https://other.test",
    });
  });

  it("does not return or resurrect a secret read that loses a race with deletion", async () => {
    const { storage } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Private",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "old-password",
    });
    const pendingSecret = deferred<string | null>();
    vi.mocked(storage.secretGetItem).mockImplementationOnce(() => pendingSecret.promise);

    const reading = store.getCredentials(CUSTOM_ID);
    await vi.waitFor(() => expect(storage.secretGetItem).toHaveBeenCalled());
    await store.removeCatalog(CUSTOM_ID);
    pendingSecret.resolve("old-password");

    await expect(reading).resolves.toBeUndefined();
    expect(store.getCatalog(CUSTOM_ID)).toBeUndefined();
  });

  it("does not return or resurrect a secret read that loses a race with reload", async () => {
    const { storage, setPersisted } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Private",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "old-password",
    });
    const pendingSecret = deferred<string | null>();
    vi.mocked(storage.secretGetItem).mockImplementationOnce(() => pendingSecret.promise);
    setPersisted(
      JSON.stringify({
        version: 1,
        customCatalogs: [
          {
            id: CUSTOM_ID,
            name: "Reloaded",
            url: "https://other.test/opds",
            enabled: true,
            auth: "basic",
            username: "other-reader",
          },
        ],
        hiddenBuiltInIds: [],
      }),
    );

    const reading = store.getCredentials(CUSTOM_ID);
    await vi.waitFor(() => expect(storage.secretGetItem).toHaveBeenCalled());
    await store.load();
    pendingSecret.resolve("old-password");

    await expect(reading).resolves.toBeUndefined();
    expect(store.getCatalog(CUSTOM_ID)).toMatchObject({
      url: "https://other.test/opds",
      passwordStorage: "none",
    });
  });
});
