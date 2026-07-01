import i18n from "@readany/core/i18n";
import { isTauriRuntimeAvailable } from "./platform/tauri-platform-service";

export interface UpdateInfo {
  version: string;
  notes?: string;
  date?: string;
}

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

let updateStatus: UpdateStatus = "idle";
let availableUpdate: UpdateInfo | null = null;
let downloadProgress = 0;
let errorMessage = "";
let statusListeners: Array<
  (status: UpdateStatus, info: UpdateInfo | null, progress: number, error: string) => void
> = [];

export function getUpdateStatus(): UpdateStatus {
  return updateStatus;
}

export function getAvailableUpdate(): UpdateInfo | null {
  return availableUpdate;
}

export function getDownloadProgress(): number {
  return downloadProgress;
}

export function getErrorMessage(): string {
  return errorMessage;
}

export function subscribeToUpdates(
  listener: (
    status: UpdateStatus,
    info: UpdateInfo | null,
    progress: number,
    error: string,
  ) => void,
): () => void {
  statusListeners.push(listener);
  return () => {
    statusListeners = statusListeners.filter((l) => l !== listener);
  };
}

function notifyListeners() {
  for (const listener of statusListeners) {
    listener(updateStatus, availableUpdate, downloadProgress, errorMessage);
  }
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauriRuntimeAvailable()) {
    return null;
  }

  updateStatus = "checking";
  errorMessage = "";
  notifyListeners();

  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();

    if (update) {
      availableUpdate = {
        version: update.version,
        notes: update.body || undefined,
        date: update.date || undefined,
      };
      updateStatus = "available";
      notifyListeners();
      return availableUpdate;
    } else {
      availableUpdate = null;
      updateStatus = "idle";
      notifyListeners();
      return null;
    }
  } catch (error) {
    console.error("[Updater] Check failed:", error);
    updateStatus = "error";

    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes("Could not fetch") || errorMsg.includes("network")) {
      errorMessage = i18n.t("settings.updaterNetworkError");
    } else if (errorMsg.includes("release") || errorMsg.includes("JSON")) {
      errorMessage = i18n.t("settings.updaterNoUpdate");
    } else {
      errorMessage = i18n.t("settings.updaterCheckFailed");
    }

    notifyListeners();
    return null;
  }
}

export async function downloadAndInstall(): Promise<boolean> {
  if (!isTauriRuntimeAvailable()) {
    return false;
  }

  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();

  if (!update) {
    updateStatus = "error";
    errorMessage = i18n.t("settings.updaterNoAvailable");
    notifyListeners();
    return false;
  }

  updateStatus = "downloading";
  downloadProgress = 0;
  errorMessage = "";
  notifyListeners();

  try {
    let downloaded = 0;
    let contentLength = 0;

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          contentLength = event.data.contentLength || 0;
          console.log(`[Updater] Started downloading, content length: ${contentLength}`);
          break;

        case "Progress":
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            downloadProgress = Math.round((downloaded / contentLength) * 100);
            notifyListeners();
          }
          console.log(`[Updater] Progress: ${downloaded}/${contentLength} (${downloadProgress}%)`);
          break;

        case "Finished":
          console.log("[Updater] Download finished");
          break;
      }
    });

    updateStatus = "ready";
    downloadProgress = 100;
    notifyListeners();

    return true;
  } catch (error) {
    console.error("[Updater] Download/install failed:", error);
    updateStatus = "error";
    errorMessage = i18n.t("settings.updaterDownloadFailed");
    notifyListeners();
    return false;
  }
}

export async function installUpdate(): Promise<void> {
  await downloadAndInstall();
}

export async function relaunchApp(): Promise<void> {
  if (!isTauriRuntimeAvailable()) {
    return;
  }

  try {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (error) {
    console.error("[Updater] Relaunch failed:", error);
    throw error instanceof Error ? error : new Error(i18n.t("settings.updaterRelaunchFailed"));
  }
}

export function resetStatus(): void {
  updateStatus = "idle";
  errorMessage = "";
  notifyListeners();
}
