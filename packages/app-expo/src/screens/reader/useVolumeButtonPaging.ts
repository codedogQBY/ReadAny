import { useEffect, useRef } from "react";
/**
 * useVolumeButtonPaging — intercepts hardware volume buttons for page turning.
 * When active, suppresses the system volume UI and restores volume after each press.
 */
import { NativeModules } from "react-native";
import { getVolumeManager } from "./reader-constants";

export interface UseVolumeButtonPagingOptions {
  active: boolean;
  settingViewMode: string;
  onPrev: () => void;
  onNext: () => void;
}

export function useVolumeButtonPaging({
  active,
  settingViewMode,
  onPrev,
  onNext,
}: UseVolumeButtonPagingOptions) {
  const lastKnownHardwareVolumeRef = useRef<number | null>(null);
  const pendingVolumeRestoreRef = useRef<number | null>(null);
  const lastVolumeButtonHandledAtRef = useRef(0);

  // DEV: log config changes
  useEffect(() => {
    if (__DEV__) {
      console.log("[ReaderScreen][VolumeNav] config", {
        hasNativeModule: !!NativeModules.VolumeManager,
        hasVolumeManagerBridge: !!getVolumeManager(),
        volumeButtonPagingActive: active,
      });
    }
  }, [active]);

  useEffect(() => {
    const volumeManager = getVolumeManager();
    if (!active) {
      pendingVolumeRestoreRef.current = null;
      return;
    }

    let cancelled = false;
    let volumeListener: { remove: () => void } | null = null;

    const restoreSystemVolume = async (targetVolume: number) => {
      if (!volumeManager) return;
      pendingVolumeRestoreRef.current = targetVolume;
      try {
        await volumeManager.setVolume(targetVolume, {
          showUI: false,
          playSound: false,
          type: "music",
        });
      } catch (error) {
        pendingVolumeRestoreRef.current = null;
        console.warn("[ReaderScreen][VolumeNav] restore-volume failed", error);
      }
    };

    const enableVolumeButtonPaging = async () => {
      if (!volumeManager) return;
      try {
        await volumeManager.showNativeVolumeUI({ enabled: false });
        const initialVolume = await volumeManager.getVolume();
        if (cancelled) return;

        lastKnownHardwareVolumeRef.current =
          typeof initialVolume.volume === "number" ? initialVolume.volume : null;

        if (__DEV__) {
          console.log("[ReaderScreen][VolumeNav] enabled", {
            initialVolume: lastKnownHardwareVolumeRef.current,
            viewMode: settingViewMode,
          });
        }

        volumeListener = volumeManager.addVolumeListener((result) => {
          const nextVolume =
            typeof result.volume === "number" && Number.isFinite(result.volume)
              ? result.volume
              : null;
          if (cancelled || nextVolume == null) return;

          const pendingRestore = pendingVolumeRestoreRef.current;
          if (pendingRestore != null && Math.abs(nextVolume - pendingRestore) < 0.0001) {
            pendingVolumeRestoreRef.current = null;
            lastKnownHardwareVolumeRef.current = nextVolume;
            if (__DEV__) {
              console.log("[ReaderScreen][VolumeNav] restore-event", { volume: nextVolume });
            }
            return;
          }

          const previousVolume = lastKnownHardwareVolumeRef.current;
          lastKnownHardwareVolumeRef.current = nextVolume;
          if (previousVolume == null) return;

          const delta = nextVolume - previousVolume;
          if (Math.abs(delta) < 0.0001) return;

          const now = Date.now();
          if (now - lastVolumeButtonHandledAtRef.current < 120) return;
          lastVolumeButtonHandledAtRef.current = now;

          const direction = delta > 0 ? "prev" : "next";
          if (__DEV__) {
            console.log("[ReaderScreen][VolumeNav] hardware-press", {
              direction,
              previousVolume,
              nextVolume,
              delta,
            });
          }

          if (direction === "prev") {
            onPrev();
          } else {
            onNext();
          }

          void restoreSystemVolume(previousVolume);
        });
      } catch (error) {
        console.warn("[ReaderScreen][VolumeNav] unavailable", error);
      }
    };

    void enableVolumeButtonPaging();

    return () => {
      cancelled = true;
      volumeListener?.remove();
      pendingVolumeRestoreRef.current = null;
      const vm = getVolumeManager();
      if (vm) {
        void vm.showNativeVolumeUI({ enabled: true }).catch((error) => {
          console.warn("[ReaderScreen][VolumeNav] restore-native-ui failed", error);
        });
      }
    };
  }, [active, settingViewMode, onPrev, onNext]);
}
