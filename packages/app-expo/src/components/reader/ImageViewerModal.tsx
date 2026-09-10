import { useRef, useState } from "react";
import { Image, Modal, PanResponder, StyleSheet, View, useWindowDimensions } from "react-native";

interface Props {
  source: string | null;
  onClose: () => void;
}

export function ImageViewerModal({ source, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const startOffset = useRef({ x: 0, y: 0 });
  const startDistance = useRef(0);
  const startScale = useRef(1);
  const moved = useRef(false);
  const lastTap = useRef(0);
  // Reset zoom when a new image opens (or the viewer closes)
  const lastSource = useRef<string | null>(null);
  if (source !== lastSource.current) {
    lastSource.current = source;
    scaleRef.current = 1;
    offsetRef.current = { x: 0, y: 0 };
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }
  const updateScale = (next: number) => {
    scaleRef.current = next;
    setScale(next);
    if (next <= 1) {
      offsetRef.current = { x: 0, y: 0 };
      setOffset({ x: 0, y: 0 });
    }
  };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        moved.current = false;
        startOffset.current = offsetRef.current;
        const touches = event.nativeEvent.touches;
        if (touches.length >= 2) {
          startDistance.current = distance(touches[0], touches[1]);
          startScale.current = scaleRef.current;
        }
      },
      onPanResponderMove: (event) => {
        const touches = event.nativeEvent.touches;
        if (touches.length >= 2 && startDistance.current > 0) {
          moved.current = true;
          const next = Math.min(
            4,
            Math.max(
              1,
              (startScale.current * distance(touches[0], touches[1])) / startDistance.current,
            ),
          );
          updateScale(next);
        } else if (touches.length === 1 && scaleRef.current > 1) {
          moved.current = Math.abs(event.nativeEvent.dx) > 8 || Math.abs(event.nativeEvent.dy) > 8;
          const next = {
            x: startOffset.current.x + event.nativeEvent.dx,
            y: startOffset.current.y + event.nativeEvent.dy,
          };
          offsetRef.current = next;
          setOffset(next);
        } else if (touches.length === 1) {
          moved.current = Math.abs(event.nativeEvent.dx) > 8 || Math.abs(event.nativeEvent.dy) > 8;
        }
      },
      onPanResponderRelease: () => {
        startDistance.current = 0;
        if (moved.current) return;
        const now = Date.now();
        if (now - lastTap.current < 280) {
          updateScale(scaleRef.current < 2 ? 2 : 1);
          lastTap.current = 0;
          return;
        }
        lastTap.current = now;
        if (scaleRef.current <= 1.05) {
          setTimeout(() => {
            if (lastTap.current === now && !moved.current) onClose();
          }, 280);
        }
      },
    }),
  ).current;

  return (
    <Modal visible={!!source} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop} {...responder.panHandlers}>
        {source ? (
          <Image
            source={{ uri: source }}
            resizeMode="contain"
            style={{
              width,
              height,
              transform: [{ translateX: offset.x }, { translateY: offset.y }, { scale }],
            }}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function distance(a: { pageX: number; pageY: number }, b: { pageX: number; pageY: number }) {
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
});
