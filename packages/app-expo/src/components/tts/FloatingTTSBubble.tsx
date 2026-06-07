/**
 * FloatingTTSBubble — Global draggable mini-player shown when TTS is active.
 *
 * Rendered as a sibling to NavigationContainer in AppInner so it floats
 * above every screen. Tapping it expands a compact player modal.
 */
import { useTTSStore } from "@/stores";
import { HeadphonesIcon } from "@/components/ui/Icon";
import { useColors } from "@/styles/theme";
import { TTSMiniPlayer } from "./TTSMiniPlayer";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BUBBLE_SIZE = 56;

export function FloatingTTSBubble() {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

  const playState = useTTSStore((s) => s.playState);

  const [showPlayer, setShowPlayer] = useState(false);
  const [bubbleOffset, setBubbleOffset] = useState({ x: 0, y: 0 });
  const [anchorLayout, setAnchorLayout] = useState<{
    left: number;
    top: number;
    size: number;
    screenWidth: number;
    screenHeight: number;
  } | null>(null);

  const isActive = playState === "playing" || playState === "paused" || playState === "loading";

  useEffect(() => {
    if (!isActive) setShowPlayer(false);
  }, [isActive]);

  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const bubbleRight = useRef(20);
  const bubbleBottom = useRef(120);
  const bubbleRef = useRef<Animated.LegacyRef<typeof Animated.View>>(null);

  const panResponder = useRef(
    require("react-native").PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_: unknown, gs: { dx: number; dy: number }) =>
        Math.abs(gs.dx) > 5 || Math.abs(gs.dy) > 5,
      onPanResponderGrant: () => {
        pan.setOffset({ x: (pan.x as any)._value, y: (pan.y as any)._value });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => { pan.flattenOffset(); },
    }),
  ).current;

  useEffect(() => {
    const id = pan.addListener((value) => { setBubbleOffset({ x: value.x, y: value.y }); });
    return () => { pan.removeListener(id); };
  }, [pan]);

  // Ripple pulse rings — only when playing
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (playState === "playing") {
      const makeRipple = (anim: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(anim, { toValue: 1, duration: 1600, easing: Easing.out(Easing.ease), useNativeDriver: true }),
            Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
          ]),
        );
      const a1 = makeRipple(ring1, 0);
      const a2 = makeRipple(ring2, 700);
      a1.start();
      a2.start();
      return () => { a1.stop(); a2.stop(); };
    }
    ring1.setValue(0);
    ring2.setValue(0);
  }, [playState, ring1, ring2]);

  const makeRingStyle = (anim: Animated.Value) => ({
    transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.0] }) }],
    opacity: anim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.35, 0] }),
  });

  const handleBubbleTap = useCallback(() => { setShowPlayer((v) => !v); }, []);

  const measureBubble = useCallback(() => {
    requestAnimationFrame(() => {
      (bubbleRef.current as any)?.measureInWindow((left: number, top: number, width: number, height: number) => {
        if (width > 0 && height > 0) {
          setAnchorLayout({ left, top, size: Math.max(width, height), screenWidth, screenHeight });
        }
      });
    });
  }, [screenHeight, screenWidth]);

  useEffect(() => {
    if (!isActive) { setAnchorLayout(null); return; }
    measureBubble();
  }, [bubbleOffset.x, bubbleOffset.y, isActive, measureBubble, showPlayer]);

  return (
    <>
      {isActive && (
        <Animated.View
          ref={bubbleRef as any}
          collapsable={false}
          style={[
            styles.bubbleWrapper,
            {
              right: bubbleRight.current,
              bottom: bubbleBottom.current + (insets.bottom || 0),
              transform: pan.getTranslateTransform(),
            },
          ]}
          {...panResponder.panHandlers}
        >
          <Animated.View
            style={[styles.bubbleRing, { backgroundColor: colors.primary }, makeRingStyle(ring1)]}
            pointerEvents="none"
          />
          <Animated.View
            style={[styles.bubbleRing, { backgroundColor: colors.primary }, makeRingStyle(ring2)]}
            pointerEvents="none"
          />
          <TouchableOpacity
            style={[styles.bubble, { backgroundColor: colors.primary }]}
            onPress={handleBubbleTap}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t("tts.player")}
          >
            {playState === "loading" ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <HeadphonesIcon size={22} color={colors.primaryForeground} />
            )}
          </TouchableOpacity>
        </Animated.View>
      )}

      <TTSMiniPlayer
        visible={showPlayer && isActive}
        onClose={() => setShowPlayer(false)}
        anchorLayout={anchorLayout}
      />
    </>
  );
}

const styles = StyleSheet.create({
  bubbleWrapper: {
    position: "absolute",
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    zIndex: 9999,
  },
  bubbleRing: {
    position: "absolute",
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    top: 0,
    left: 0,
  },
  bubble: {
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 12,
  },
});
