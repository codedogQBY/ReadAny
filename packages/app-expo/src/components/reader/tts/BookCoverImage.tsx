/**
 * BookCoverImage — pure render helper for TTS cover display.
 * Renders a book cover with realistic spine shadow, or a styled fallback.
 */
import { fontWeight } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";
import { Image, StyleSheet, Text, View } from "react-native";

export interface BookCoverImageProps {
  coverUri?: string;
  bookTitle: string;
  chapterTitle: string;
  width: number;
  height: number;
  borderRadius: number;
  pct: number;
  colors: ThemeColors;
  t: (key: string) => string;
}

export function BookCoverImage({
  coverUri,
  bookTitle,
  chapterTitle,
  width,
  height,
  borderRadius,
  pct,
  colors,
  t,
}: BookCoverImageProps) {
  const showStrip = pct > 0 && pct < 100;
  const fontSize = Math.max(8, Math.round(width * 0.055));
  const subFontSize = Math.max(7, Math.round(width * 0.042));

  return (
    <View
      style={{ width, height, borderRadius, overflow: "hidden", backgroundColor: colors.muted }}
    >
      {coverUri ? (
        <>
          <Image
            source={{ uri: coverUri }}
            style={StyleSheet.absoluteFillObject}
            resizeMode="cover"
          />
          <View
            style={[StyleSheet.absoluteFillObject, { flexDirection: "row" }]}
            pointerEvents="none"
          >
            <View style={{ width: "6%", height: "100%", backgroundColor: "rgba(0,0,0,0.10)" }} />
            <View style={{ width: "8%", height: "100%", backgroundColor: "rgba(20,20,20,0.20)" }} />
            <View
              style={{ width: "5%", height: "100%", backgroundColor: "rgba(240,240,240,0.40)" }}
            />
            <View
              style={{ width: "18%", height: "100%", backgroundColor: "rgba(215,215,215,0.35)" }}
            />
            <View style={{ flex: 1, height: "100%", backgroundColor: "rgba(100,100,100,0.10)" }} />
          </View>
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: "3%",
              backgroundColor: "rgba(240,240,240,0.15)",
            }}
            pointerEvents="none"
          />
          <View
            style={{
              position: "absolute",
              bottom: showStrip ? 2 : 0,
              left: 0,
              right: 0,
              height: "8%",
              backgroundColor: "rgba(15,15,15,0.15)",
            }}
            pointerEvents="none"
          />
        </>
      ) : (
        <View style={{ flex: 1, overflow: "hidden" }}>
          <View
            style={{
              position: "absolute",
              inset: 0,
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: colors.stone100,
            }}
          />
          <View
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: "50%",
              backgroundColor: colors.stone200,
            }}
          />
          <View
            style={{
              flex: 1,
              padding: Math.max(6, width * 0.07),
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1,
            }}
          >
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text
                style={{
                  textAlign: "center",
                  fontSize,
                  fontWeight: fontWeight.medium,
                  fontFamily: "serif",
                  color: colors.stone500,
                  lineHeight: Math.round(fontSize * 1.45),
                }}
                numberOfLines={4}
              >
                {bookTitle || t("reader.untitled")}
              </Text>
            </View>
            <View
              style={{
                width: Math.round(width * 0.28),
                height: 1,
                backgroundColor: `${colors.stone300}99`,
                marginVertical: 5,
              }}
            />
            <View style={{ height: "22%", alignItems: "center", justifyContent: "center" }}>
              <Text
                style={{
                  textAlign: "center",
                  fontSize: subFontSize,
                  fontFamily: "serif",
                  color: colors.stone400,
                }}
                numberOfLines={1}
              >
                {chapterTitle}
              </Text>
            </View>
          </View>
        </View>
      )}

      {showStrip && (
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 2,
            backgroundColor: "rgba(0,0,0,0.1)",
          }}
        >
          <View
            style={{
              height: "100%" as unknown as number,
              width: `${pct}%` as unknown as number,
              backgroundColor: colors.primary,
              opacity: 0.9,
            }}
          />
        </View>
      )}
    </View>
  );
}
