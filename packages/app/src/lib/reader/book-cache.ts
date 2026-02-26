/**
 * Book blob cache — two-level strategy:
 * 1. In-memory Map (fastest, for tab switching within session)
 * 2. Tauri disk read (via asset:// protocol or readFile plugin)
 *
 * IndexedDB is NOT used for blob caching because:
 * - Large blobs (10-50MB EPUBs) are slow to read/write in IDB
 * - The Tauri asset protocol is already fast for local files
 * - Memory cache handles the common case (tab switching)
 */

const MAX_MEMORY_CACHE = 5;
const memoryCache = new Map<string, Blob>();

function evictMemoryIfNeeded(): void {
  if (memoryCache.size >= MAX_MEMORY_CACHE) {
    const firstKey = memoryCache.keys().next().value;
    if (firstKey) memoryCache.delete(firstKey);
  }
}

async function loadFileFromDisk(filePath: string): Promise<Blob> {
  try {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    const assetUrl = convertFileSrc(filePath);
    const response = await fetch(assetUrl);
    if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
    return await response.blob();
  } catch {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const fileBytes = await readFile(filePath);
    return new Blob([fileBytes]);
  }
}

/**
 * Get a book blob with two-level caching: memory → disk.
 */
export async function getCachedBlob(filePath: string): Promise<Blob> {
  // Level 1: Memory
  const memHit = memoryCache.get(filePath);
  if (memHit) return memHit;

  // Level 2: Disk
  const blob = await loadFileFromDisk(filePath);

  evictMemoryIfNeeded();
  memoryCache.set(filePath, blob);
  return blob;
}
