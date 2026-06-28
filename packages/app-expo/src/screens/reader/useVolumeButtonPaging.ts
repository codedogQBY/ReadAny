import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import VolumeKeyPaging from "../../../modules/volume-key-paging";

const THROTTLE_MS = 120;

type Params = {
  active: boolean;
  onPrev: () => void;
  onNext: () => void;
};

export function useVolumeButtonPaging({ active, onPrev, onNext }: Params) {
  const lastHandledAtRef = useRef(0);
  const onPrevRef = useRef(onPrev);
  const onNextRef = useRef(onNext);
  onPrevRef.current = onPrev;
  onNextRef.current = onNext;

  useEffect(() => {
    if (Platform.OS !== "android") return;
    VolumeKeyPaging.setEnabled(active);
    return () => VolumeKeyPaging.setEnabled(false);
  }, [active]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = VolumeKeyPaging.addListener("VolumeKeyPaging", ({ direction }) => {
      const now = Date.now();
      if (now - lastHandledAtRef.current < THROTTLE_MS) return;
      lastHandledAtRef.current = now;
      if (direction === "prev") onPrevRef.current();
      else onNextRef.current();
    });
    return () => sub.remove();
  }, []);
}
