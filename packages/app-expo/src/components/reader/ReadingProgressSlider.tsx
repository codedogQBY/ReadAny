/**
 * ReadingProgressSlider — A draggable progress slider for the reader.
 *
 * Uses pageX (absolute screen coordinates) for reliable tracking on iOS.
 * Debounces seek at 100ms, with cooldown to prevent snap-back.
 */
import { useCallback, useRef, useState } from "react";
import { Animated, PanResponder, StyleSheet, Text, View } from "react-native";

interface Props {
  /** Current reading progress 0-1 */
  progress: number;
  /** Called when user seeks to a new position (0-1) */
  onSeek: (fraction: number) => void;
  /** Called when user starts dragging */
  onDragStart?: () => void;
  /** Called when user releases the slider */
  onDragEnd?: () => void;
  /** Whether to seek while dragging. Reading navigation keeps the default; TTS seeks on release only. */
  seekWhileDragging?: boolean;
  /** Primary/accent color */
  accentColor?: string;
  /** Track background color */
  trackColor?: string;
  /** Text color for percentage label */
  textColor?: string;
}

const clamp = (val: number) => Math.max(0, Math.min(1, val));

export function ReadingProgressSlider({
  progress,
  onSeek,
  onDragStart,
  onDragEnd,
  seekWhileDragging = true,
  accentColor = "#3b82f6",
  trackColor = "rgba(255,255,255,0.15)",
  textColor = "rgba(255,255,255,0.7)",
}: Props) {
  const [localProgress, setLocalProgress] = useState<number | null>(null);
  const trackWidthRef = useRef(0);
  const trackPageXRef = useRef(0); // absolute X of track left edge on screen
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbScale = useRef(new Animated.Value(1)).current;
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackViewRef = useRef<View>(null);

  // Refs for callbacks to avoid stale closures in PanResponder
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;
  const seekWhileDraggingRef = useRef(seekWhileDragging);
  seekWhileDraggingRef.current = seekWhileDragging;

  // Use local progress while dragging/cooldown, otherwise external progress
  const displayProgress = localProgress != null ? localProgress : progress;
  const displayPercent = Math.round(displayProgress * 100);

  // Calculate fraction from absolute pageX
  const fractionFromPageX = (pageX: number) => {
    const width = trackWidthRef.current;
    if (width <= 0) return 0;
    return clamp((pageX - trackPageXRef.current) / width);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 3,
      onPanResponderGrant: (evt) => {
        if (cooldownRef.current) {
          clearTimeout(cooldownRef.current);
          cooldownRef.current = null;
        }
        // Measure track position right before using it
        trackViewRef.current?.measure((_x, _y, _w, _h, pageX) => {
          if (pageX != null) trackPageXRef.current = pageX;
        });
        const fraction = fractionFromPageX(evt.nativeEvent.pageX);
        setLocalProgress(fraction);
        onDragStartRef.current?.();
        Animated.spring(thumbScale, { toValue: 1.5, useNativeDriver: true, friction: 8 }).start();
        // Debounced seek for the initial tap
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (seekWhileDraggingRef.current) {
          debounceRef.current = setTimeout(() => {
            onSeekRef.current(fraction);
          }, 100);
        }
      },
      onPanResponderMove: (evt) => {
        const fraction = fractionFromPageX(evt.nativeEvent.pageX);
        setLocalProgress(fraction);
        if (seekWhileDraggingRef.current) {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            onSeekRef.current(fraction);
          }, 100);
        }
      },
      onPanResponderRelease: (evt) => {
        const fraction = fractionFromPageX(evt.nativeEvent.pageX);
        Animated.spring(thumbScale, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        setLocalProgress(fraction);
        onSeekRef.current(fraction);
        onDragEndRef.current?.();
        // Keep local progress for 600ms to avoid snap-back from WebView relocate
        cooldownRef.current = setTimeout(() => {
          cooldownRef.current = null;
          setLocalProgress(null);
        }, 600);
      },
      onPanResponderTerminate: () => {
        Animated.spring(thumbScale, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
        onDragEndRef.current?.();
        cooldownRef.current = setTimeout(() => {
          cooldownRef.current = null;
          setLocalProgress(null);
        }, 600);
      },
    }),
  ).current;

  const handleLayout = useCallback(() => {
    trackViewRef.current?.measure((_x, _y, width, _h, pageX) => {
      if (width != null) trackWidthRef.current = width;
      if (pageX != null) trackPageXRef.current = pageX;
    });
  }, []);

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: textColor }]}>{displayPercent}%</Text>
      <View
        ref={trackViewRef}
        style={styles.trackWrap}
        onLayout={handleLayout}
        {...panResponder.panHandlers}
      >
        <View style={[styles.track, { backgroundColor: trackColor }]}>
          <View
            style={[
              styles.fill,
              { backgroundColor: accentColor, width: `${displayProgress * 100}%` },
            ]}
          />
        </View>
        <Animated.View
          style={[
            styles.thumb,
            {
              backgroundColor: accentColor,
              left: `${displayProgress * 100}%`,
              transform: [{ scale: thumbScale }, { translateX: -7 }, { translateY: -7 }],
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 2,
    gap: 10,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    minWidth: 36,
    textAlign: "center",
  },
  trackWrap: {
    flex: 1,
    height: 32,
    justifyContent: "center",
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 2,
  },
  thumb: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    top: "50%",
  },
});
