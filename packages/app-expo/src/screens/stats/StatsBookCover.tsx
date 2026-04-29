/**
 * StatsBookCover.tsx — Shared BookCover component with library-style spine + highlights.
 * Extracted from StatsSections.tsx.
 */
import { useColors, withOpacity } from "@/styles/theme";
import { Image, Text, View } from "react-native";

export function StatsBookCover({
  coverUrl,
  title,
  width: w,
}: {
  coverUrl?: string;
  title: string;
  width: number;
}) {
  const colors = useColors();
  const h = w * (41 / 28);

  return (
    <View
      style={{
        width: w,
        height: h,
        borderRadius: 4,
        overflow: "hidden",
        position: "relative",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 3,
      }}
    >
      {/* Cover image or fallback */}
      {coverUrl ? (
        <Image
          source={{ uri: coverUrl }}
          style={{ width: "100%", height: "100%", borderRadius: 4 }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 4,
            backgroundColor: withOpacity(colors.muted, 0.5),
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 2,
          }}
        >
          <Text
            style={{
              fontSize: Math.max(8, w * 0.2),
              fontWeight: "600",
              color: withOpacity(colors.mutedForeground, 0.4),
              textAlign: "center",
            }}
          >
            {title.slice(0, 3)}
          </Text>
        </View>
      )}

      {/* Spine overlay — 7 strips matching library BookCard */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: "8%",
          flexDirection: "row",
          zIndex: 2,
        }}
      >
        <View style={{ width: "6%", height: "100%", backgroundColor: "rgba(0,0,0,0.10)" }} />
        <View style={{ width: "8%", height: "100%", backgroundColor: "rgba(20,20,20,0.20)" }} />
        <View style={{ width: "5%", height: "100%", backgroundColor: "rgba(240,240,240,0.40)" }} />
        <View style={{ width: "18%", height: "100%", backgroundColor: "rgba(215,215,215,0.35)" }} />
        <View style={{ width: "12%", height: "100%", backgroundColor: "rgba(150,150,150,0.25)" }} />
        <View style={{ width: "20%", height: "100%", backgroundColor: "rgba(100,100,100,0.18)" }} />
        <View style={{ width: "31%", height: "100%", backgroundColor: "rgba(175,175,175,0.12)" }} />
      </View>

      {/* Top highlight */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "3%",
          backgroundColor: "rgba(240,240,240,0.15)",
          zIndex: 3,
        }}
      />

      {/* Bottom shadow */}
      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "8%",
          backgroundColor: "rgba(15,15,15,0.15)",
          zIndex: 3,
        }}
      />
    </View>
  );
}
