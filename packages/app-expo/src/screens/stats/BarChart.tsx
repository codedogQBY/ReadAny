import { useColors } from "@/styles/theme";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type LayoutChangeEvent, Text, TouchableOpacity, View } from "react-native";
import { makeStyles } from "./stats-styles";
import { formatTime } from "./stats-utils";

export function BarChart({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  const colors = useColors();
  const s = makeStyles(colors);
  const { t } = useTranslation();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [plotWidth, setPlotWidth] = useState(0);
  const maxVal = Math.max(1, ...data.map((d) => d.value));
  const BAR_HEIGHT = 140;
  const Y_AXIS_WIDTH = 34;

  const yTicks = [maxVal, maxVal * 0.5, 0].map((v) => ({
    value: v,
    label: v < 60 ? `${Math.round(v)}m` : `${(v / 60).toFixed(1)}h`,
  }));

  const handlePlotLayout = (event: LayoutChangeEvent) => {
    setPlotWidth(event.nativeEvent.layout.width);
  };

  const columnWidth = data.length > 0 && plotWidth > 0 ? plotWidth / data.length : 28;
  const barWidth = Math.max(14, Math.min(24, columnWidth * 0.42));

  if (data.length === 0) {
    return (
      <View style={s.barChartEmpty}>
        <Text style={s.barChartEmptyText}>{t("stats.noData")}</Text>
      </View>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={() => setSelectedIdx(null)}
      style={[s.barChartWrap, { flexDirection: "row" }]}
    >
      <View
        style={{
          width: Y_AXIS_WIDTH,
          height: BAR_HEIGHT + 20,
          justifyContent: "space-between",
          paddingRight: 4,
        }}
      >
        {yTicks.map((tick, i) => (
          <Text key={i} style={{ fontSize: 8, color: colors.mutedForeground, textAlign: "right" }}>
            {tick.label}
          </Text>
        ))}
      </View>

      <View style={[s.barChartContent, { flex: 1 }]} onLayout={handlePlotLayout}>
        {data.map((item, idx) => (
          <TouchableOpacity
            key={`${item.label}-${idx}`}
            style={[s.barCol, { flex: 1, width: undefined }]}
            onPress={() => setSelectedIdx(selectedIdx === idx ? null : idx)}
            activeOpacity={0.7}
          >
            <View style={[s.barTrack, { height: BAR_HEIGHT }]}>
              <View
                style={[
                  s.barFill,
                  {
                    height: Math.max(2, (item.value / maxVal) * BAR_HEIGHT),
                    width: barWidth,
                    backgroundColor: item.value > 0 ? colors.primary : colors.muted,
                    opacity: item.value > 0 ? 0.72 : 0.45,
                  },
                ]}
              />
            </View>
            <Text style={s.barLabel}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {selectedIdx !== null && data[selectedIdx] && data[selectedIdx].value > 0 && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: Y_AXIS_WIDTH + selectedIdx * columnWidth + columnWidth / 2 - 28,
            top: BAR_HEIGHT - (data[selectedIdx].value / maxVal) * BAR_HEIGHT - 24,
            backgroundColor: colors.card,
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 4,
            borderWidth: 0.5,
            borderColor: colors.border,
            minWidth: 50,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.15,
            shadowRadius: 2,
            elevation: 3,
          }}
        >
          <Text
            style={{
              fontSize: 12,
              color: colors.cardForeground,
              fontWeight: "500",
              textAlign: "center",
            }}
          >
            {formatTime(data[selectedIdx].value)}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}
