import { RefreshCwIcon } from "@/components/ui/Icon";
import { useSyncStore } from "@readany/core/stores";
import { useCallback, useEffect, useRef } from "react";
import { Animated, Easing, TouchableOpacity } from "react-native";

interface SyncButtonProps {
  size?: number;
  color?: string;
}

export function SyncButton({ size = 20, color }: SyncButtonProps) {
  const syncNow = useSyncStore((s) => s.syncNow);
  const status = useSyncStore((s) => s.status);
  const backendType = useSyncStore((s) => s.backendType);
  const loadConfig = useSyncStore((s) => s.loadConfig);

  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinRef = useRef<Animated.CompositeAnimation | null>(null);

  const isBusy = status !== "idle" && status !== "error";

  useEffect(() => {
    if (!backendType) {
      void loadConfig();
    }
  }, [backendType, loadConfig]);

  useEffect(() => {
    if (isBusy) {
      spinAnim.setValue(0);
      const anim = Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      spinRef.current = anim;
      anim.start();
    } else {
      spinRef.current?.stop();
      spinAnim.setValue(0);
    }
  }, [isBusy, spinAnim]);

  const handlePress = useCallback(() => {
    if (isBusy) return;
    void syncNow();
  }, [isBusy, syncNow]);

  if (!backendType) return null;

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.7} hitSlop={8}>
      <Animated.View style={{ transform: [{ rotate: spin }] }}>
        <RefreshCwIcon size={size} color={color} />
      </Animated.View>
    </TouchableOpacity>
  );
}
