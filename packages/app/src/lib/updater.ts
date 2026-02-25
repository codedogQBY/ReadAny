/**
 * Auto-updater — wraps Tauri updater plugin
 */

export interface UpdateInfo {
  version: string;
  notes: string;
  date: string;
}

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

/** Check for available updates */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  // TODO: Use @tauri-apps/plugin-updater
  return null;
}

/** Download and install update */
export async function installUpdate(): Promise<void> {
  // TODO: Use @tauri-apps/plugin-updater
}
