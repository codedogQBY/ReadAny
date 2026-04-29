/**
 * Sync direction detection — compares local and remote state to determine sync action.
 */

import { getSyncAdapter } from "./sync-adapter";
import type { ISyncBackend } from "./sync-backend";
import { getSyncMeta } from "./sync-meta";
import {
  REMOTE_MANIFEST,
  type RemoteSyncManifest,
  SYNC_META_KEYS,
  SYNC_SCHEMA_VERSION,
  type SyncDirection,
} from "./sync-types";

/**
 * Determine sync direction by comparing local and remote state.
 *
 * Logic:
 * - No remote manifest → "upload" (first sync)
 * - No local hash → "download" (first sync on this device, or after reset)
 * - Remote manifest.lastModifiedAt matches stored → "none" (no changes)
 * - Local hash changed AND remote unchanged → "upload"
 * - Remote changed AND local unchanged → "download"
 * - Both changed → "conflict" (user must pick)
 */
export async function determineSyncDirection(backend: ISyncBackend): Promise<{
  direction: SyncDirection;
  remoteManifest: RemoteSyncManifest | null;
}> {
  const adapter = getSyncAdapter();

  // Get remote manifest
  const remoteManifest = await backend.getJSON<RemoteSyncManifest>(REMOTE_MANIFEST);

  // Check schema version compatibility
  if (remoteManifest && remoteManifest.schemaVersion > SYNC_SCHEMA_VERSION) {
    throw new Error(
      `Remote sync schema version (${remoteManifest.schemaVersion}) is newer than local (${SYNC_SCHEMA_VERSION}). Please update the app.`,
    );
  }

  // No remote data → first sync, upload
  if (!remoteManifest) {
    return { direction: "upload", remoteManifest: null };
  }

  // Get local state
  const storedRemoteModifiedAt = await getSyncMeta(SYNC_META_KEYS.LAST_REMOTE_MODIFIED_AT);
  const storedDbHash = await getSyncMeta(SYNC_META_KEYS.LAST_SYNC_DB_HASH);
  const storedLastSyncAt = await getSyncMeta(SYNC_META_KEYS.LAST_SYNC_AT);

  // No local sync history → first sync on this device, download
  if (!storedDbHash) {
    return { direction: "download", remoteManifest };
  }

  // Check if remote changed
  const remoteChanged = storedRemoteModifiedAt !== String(remoteManifest.lastModifiedAt);

  // For incremental sync, also check lastSyncAt if available
  const remoteLastSyncAt = (remoteManifest as { lastSyncAt?: number }).lastSyncAt;
  const remoteSyncChanged =
    remoteLastSyncAt && storedLastSyncAt && String(remoteLastSyncAt) !== storedLastSyncAt;

  // Check if local DB changed (compare current hash with stored hash)
  const dbPath = await adapter.getDatabasePath();
  const currentDbHash = await adapter.hashFile(dbPath);
  const localChanged = currentDbHash !== storedDbHash;

  if (!remoteChanged && !remoteSyncChanged && !localChanged) {
    return { direction: "none", remoteManifest };
  }
  if (localChanged && !remoteChanged && !remoteSyncChanged) {
    return { direction: "upload", remoteManifest };
  }
  if ((remoteChanged || remoteSyncChanged) && !localChanged) {
    return { direction: "download", remoteManifest };
  }
  // Both changed
  return { direction: "conflict", remoteManifest };
}
