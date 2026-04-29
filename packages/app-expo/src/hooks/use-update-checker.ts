import { useUpdateStore } from "@/stores/update-store";
import { getPlatformService } from "@readany/core/services";
import { checkForUpdate } from "@readany/core/update";
import { useEffect } from "react";
import { Platform } from "react-native";

/**
 * Background update checker — runs once on mount.
 * Only active on Android for now.
 */
export function useUpdateChecker() {
  const dismissedVersion = useUpdateStore((s) => s.dismissedVersion);
  const setCheckResult = useUpdateStore((s) => s.setCheckResult);
  const showDialog = useUpdateStore((s) => s.showDialog);

  useEffect(() => {
    if (Platform.OS !== "android") return;

    let cancelled = false;

    async function check() {
      try {
        const platform = getPlatformService();
        const version = await platform.getAppVersion();
        const result = await checkForUpdate(version, platform);

        if (cancelled) return;

        setCheckResult(result);

        if (result.hasUpdate && result.latestVersion && result.latestVersion !== dismissedVersion) {
          showDialog();
        }
      } catch (err) {
        console.warn("[UpdateChecker] Background check failed:", err);
      }
    }

    // Delay to let the app finish initial rendering
    const timer = setTimeout(check, 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
