import { closeDB, getBooks, getDatabaseFilePath, initDatabase } from "@readany/core/db";
import { invoke } from "@tauri-apps/api/core";

const STORAGE_KEY = "readany-desktop-library-root";
const CONFIG_FILE = "desktop-data-root.json";
const DATA_DB_FILES = ["readany.db", "readany_local.db", "vectors.db"];
const SQLITE_SIDECAR_SUFFIXES = ["", "-wal", "-shm", "-journal"];

function normalizeDir(path: string): string {
  const trimmed = path.replace(/^file:\/\//, "").trim();
  if (!trimmed) return "";
  if (/^[A-Za-z]:\\$/.test(trimmed)) return trimmed;
  return trimmed.replace(/[\\/]+$/, "");
}

function readLegacyStoredRoot(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const normalized = normalizeDir(raw);
  return normalized || null;
}

async function joinWithinRoot(root: string, relativePath: string): Promise<string> {
  const { join } = await import("@tauri-apps/api/path");
  return join(root, relativePath);
}

async function getConfigPath(): Promise<string> {
  const { appDataDir, join } = await import("@tauri-apps/api/path");
  return join(await appDataDir(), CONFIG_FILE);
}

async function readConfiguredRoot(): Promise<string | null> {
  const { exists, readTextFile } = await import("@tauri-apps/plugin-fs");
  const configPath = await getConfigPath();
  if (!(await exists(configPath))) {
    return null;
  }

  try {
    const raw = await readTextFile(configPath);
    const parsed = JSON.parse(raw) as { dataRoot?: string };
    const normalized = normalizeDir(parsed.dataRoot || "");
    return normalized || null;
  } catch {
    return null;
  }
}

async function persistDesktopLibraryRootConfig(path: string | null): Promise<void> {
  const { exists, mkdir, remove, writeTextFile } = await import("@tauri-apps/plugin-fs");
  const { appDataDir } = await import("@tauri-apps/api/path");

  const configPath = await getConfigPath();
  const defaultRoot = normalizeDir(await appDataDir());
  const normalized = path ? normalizeDir(path) : "";

  if (!normalized || normalized === defaultRoot) {
    if (await exists(configPath)) {
      await remove(configPath);
    }
    return;
  }

  await mkdir(defaultRoot, { recursive: true });
  await writeTextFile(configPath, JSON.stringify({ dataRoot: normalized }, null, 2));
}

const FONTS_DIR = "readany-fonts";

async function collectManagedRelativePaths(): Promise<string[]> {
  await initDatabase();
  const books = await getBooks();

  const assetPaths = books.flatMap((book) => {
    const paths: string[] = [];
    if (book.filePath) paths.push(book.filePath);
    if (book.meta.coverUrl) paths.push(book.meta.coverUrl);
    return paths;
  });

  const dbPaths = DATA_DB_FILES.flatMap((filename) =>
    SQLITE_SIDECAR_SUFFIXES.map((suffix) => `${filename}${suffix}`),
  );

  return Array.from(new Set([...assetPaths, ...dbPaths]));
}

async function collectDirRelativePaths(root: string, subDir: string): Promise<string[]> {
  const { exists, readDir } = await import("@tauri-apps/plugin-fs");
  const { join } = await import("@tauri-apps/api/path");
  const dir = await join(root, subDir);
  if (!(await exists(dir))) return [];
  const entries = await readDir(dir);
  return entries.filter((e) => e.isFile).map((e) => `${subDir}/${e.name}`);
}

async function ensureTargetDirs(root: string): Promise<void> {
  const { mkdir } = await import("@tauri-apps/plugin-fs");
  await mkdir(root, { recursive: true });
  await mkdir(await joinWithinRoot(root, "books"), { recursive: true });
  await mkdir(await joinWithinRoot(root, "covers"), { recursive: true });
  await mkdir(await joinWithinRoot(root, FONTS_DIR), { recursive: true });
}

export async function getDefaultDesktopLibraryRoot(): Promise<string> {
  const { appDataDir } = await import("@tauri-apps/api/path");
  return normalizeDir(await appDataDir());
}

export async function syncLegacyDesktopLibraryRootConfig(): Promise<void> {
  const legacyRoot = readLegacyStoredRoot();
  if (!legacyRoot) return;

  const configuredRoot = await readConfiguredRoot();
  if (configuredRoot) return;

  await persistDesktopLibraryRootConfig(legacyRoot);
}

export async function getDesktopLibraryRoot(): Promise<string> {
  await syncLegacyDesktopLibraryRootConfig();
  return (await readConfiguredRoot()) ?? (await getDefaultDesktopLibraryRoot());
}

export async function setDesktopLibraryRoot(path: string | null): Promise<void> {
  if (typeof window === "undefined") return;

  const normalized = path ? normalizeDir(path) : "";
  const defaultRoot = await getDefaultDesktopLibraryRoot();

  if (!normalized || normalized === defaultRoot) {
    window.localStorage.removeItem(STORAGE_KEY);
    await persistDesktopLibraryRootConfig(null);
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, normalized);
  await persistDesktopLibraryRootConfig(normalized);
}

export async function clearDesktopLibraryRoot(): Promise<void> {
  await setDesktopLibraryRoot(null);
}

export async function resolveDesktopDataPath(path: string): Promise<string> {
  if (!path) return "";
  if (
    path.startsWith("/") ||
    path.startsWith("file://") ||
    path.startsWith("asset://") ||
    path.startsWith("http")
  ) {
    return path;
  }

  return joinWithinRoot(await getDesktopLibraryRoot(), path);
}

type MigrationResult = {
  from: string;
  to: string;
  movedFiles: number;
  skippedFiles: number;
};

export async function migrateDesktopLibraryRoot(nextRoot: string): Promise<MigrationResult> {
  const { copyFile, exists, remove } = await import("@tauri-apps/plugin-fs");

  const targetRoot = normalizeDir(nextRoot);
  if (!targetRoot) {
    throw new Error("Invalid target directory");
  }

  const currentRoot = await getDesktopLibraryRoot();
  if (currentRoot === targetRoot) {
    return { from: currentRoot, to: targetRoot, movedFiles: 0, skippedFiles: 0 };
  }

  const relativePaths = await collectManagedRelativePaths();
  const fontPaths = await collectDirRelativePaths(currentRoot, FONTS_DIR);
  const allRelativePaths = Array.from(new Set([...relativePaths, ...fontPaths]));

  await closeDB();
  try {
    await invoke("vector_shutdown");
  } catch {
    // Ignore shutdown failures and fall back to best-effort file copy.
  }

  await ensureTargetDirs(targetRoot);

  const copiedSources: string[] = [];
  let movedFiles = 0;
  let skippedFiles = 0;

  for (const relativePath of allRelativePaths) {
    const sourcePath = await joinWithinRoot(currentRoot, relativePath);
    const targetPath = await joinWithinRoot(targetRoot, relativePath);

    if (sourcePath === targetPath) {
      skippedFiles += 1;
      continue;
    }

    if (!(await exists(sourcePath))) {
      skippedFiles += 1;
      continue;
    }

    if (await exists(targetPath)) {
      await remove(targetPath);
    }

    await copyFile(sourcePath, targetPath);
    copiedSources.push(sourcePath);
    movedFiles += 1;
  }

  for (const sourcePath of copiedSources) {
    try {
      await remove(sourcePath);
    } catch {
      // Keep copied targets even if source cleanup fails.
    }
  }

  await setDesktopLibraryRoot(targetRoot);

  // Update font store: rewrite filePath entries to point to new location
  // custom-fonts.json lives inside readany-fonts/ so it was already migrated above;
  // we just need to update in-memory state and write the updated index to the new path.
  try {
    const { useFontStore } = await import("@readany/core/stores");
    const { join } = await import("@tauri-apps/api/path");
    const { fonts, selectedFontId } = useFontStore.getState();
    const updatedFonts = await Promise.all(
      fonts.map(async (f) => {
        if (f.source !== "local" || !f.fileName) return f;
        return { ...f, filePath: await join(targetRoot, FONTS_DIR, f.fileName) };
      }),
    );
    useFontStore.setState({ fonts: updatedFonts });
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const indexPath = await join(targetRoot, FONTS_DIR, "custom-fonts.json");
    await writeFile(
      indexPath,
      new TextEncoder().encode(JSON.stringify({ fonts: updatedFonts, selectedFontId }, null, 2)),
    );
  } catch {
    // Non-fatal: font paths may need manual fix, but books are safe
  }

  return {
    from: currentRoot,
    to: targetRoot,
    movedFiles,
    skippedFiles,
  };
}

export async function resetDesktopLibraryRoot(): Promise<MigrationResult> {
  return migrateDesktopLibraryRoot(await getDefaultDesktopLibraryRoot());
}

export async function getDesktopDatabasePath(filename: string): Promise<string> {
  return getDatabaseFilePath(filename);
}
