import { useColors } from "@/styles/theme";
import type { TrendPoint } from "@readany/core/stats";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, TouchableOpacity, View } from "react-native";
import Svg, {
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { makeStyles } from "./stats-styles";
import { formatDate, formatTime } from "./stats-utils";

export function TrendChart({ data }: { data: TrendPoint[] }) {
  const { t } = useTranslation();
  const colors = useColors();
  const s = makeStyles(colors);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const CHART_HEIGHT = 120;
  const MARGIN_LEFT = 36;
  const MARGIN_BOTTOM = 24;
  const MARGIN_TOP = 8;

  if (data.length === 0) {
    return (
      <View style={s.barChartEmpty}>
        <Text style={s.barChartEmptyText}>{t("stats.noData")}</Text>
      </View>
    );
  }

  const maxVal = Math.max(1, ...data.map((d) => d.dailyTime));
  const innerWidth = containerWidth > 0 ? containerWidth - MARGIN_LEFT - 8 : 0;
  const innerHeight = CHART_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;

  const xScale = (idx: number) => {
    if (data.length <= 1) return MARGIN_LEFT + innerWidth / 2;
    return MARGIN_LEFT + (idx / (data.length - 1)) * innerWidth;
  };
  const yScale = (val: number) => MARGIN_TOP + innerHeight - (val / maxVal) * innerHeight;

  const yTicks = [0, maxVal * 0.5, maxVal].map((v) => ({ value: v, y: yScale(v) }));

  const linePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yScale(d.dailyTime)}`)
    .join(" ");

  const areaPath =
    `M ${MARGIN_LEFT} ${MARGIN_TOP + innerHeight} ` +
    linePath.replace("M", "L") +
    ` L ${xScale(data.length - 1)} ${MARGIN_TOP + innerHeight} Z`;

  const xTickInterval = Math.max(1, Math.ceil(data.length / 6));
  const xTicks = data.filter((_, i) => i === 0 || i === data.length - 1 || i % xTickInterval === 0);

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={() => setSelectedIdx(null)}
      style={{ height: CHART_HEIGHT + 40 }}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
    >
      {containerWidth > 0 && (
        <>
          <Svg width={containerWidth} height={CHART_HEIGHT + 40}>
            <Defs>
              <LinearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.emerald} stopOpacity={0.3} />
                <Stop offset="1" stopColor={colors.emerald} stopOpacity={0.02} />
              </LinearGradient>
            </Defs>
            <G>
              {yTicks.map((tick) => (
                <G key={tick.value}>
                  <Line
                    x1={MARGIN_LEFT}
                    y1={tick.y}
                    x2={containerWidth - 8}
                    y2={tick.y}
                    stroke={colors.border}
                    strokeWidth={1}
                  />
                  <SvgText
                    x={MARGIN_LEFT - 4}
                    y={tick.y}
                    fontSize={9}
                    fill={colors.mutedForeground}
                    textAnchor="end"
                    alignmentBaseline="middle"
                  >
                    {tick.value < 60
                      ? `${Math.round(tick.value)}m`
                      : `${(tick.value / 60).toFixed(1)}h`}
                  </SvgText>
                </G>
              ))}
              <Path d={areaPath} fill="url(#trendGradient)" />
              <Path d={linePath} fill="none" stroke={colors.emerald} strokeWidth={2} />
              <Line
                x1={MARGIN_LEFT}
                y1={MARGIN_TOP + innerHeight}
                x2={containerWidth - 8}
                y2={MARGIN_TOP + innerHeight}
                stroke={colors.border}
                strokeWidth={1}
              />
              {xTicks.map((d) => {
                const idx = data.findIndex((dd) => dd.date === d.date);
                return (
                  <SvgText
                    key={d.date}
                    x={xScale(idx)}
                    y={CHART_HEIGHT + 14}
                    fontSize={9}
                    fill={colors.mutedForeground}
                    textAnchor="middle"
                  >
                    {formatDate(d.date)}
                  </SvgText>
                );
              })}
              {data.map((d, i) => (
                <Rect
                  key={d.date}
                  x={xScale(i) - 12}
                  y={0}
                  width={24}
                  height={CHART_HEIGHT}
                  fill="transparent"
                />
              ))}
            </G>
          </Svg>

          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
            {data.map((d, i) => (
              <TouchableOpacity
                key={d.date}
                style={{
                  position: "absolute",
                  left: xScale(i) - 12,
                  top: 0,
                  width: 24,
                  height: CHART_HEIGHT,
                }}
                onPress={() => setSelectedIdx(selectedIdx === i ? null : i)}
                activeOpacity={0.7}
              />
            ))}
          </View>

          {selectedIdx !== null && data[selectedIdx] && (
            <View
              style={{
                position: "absolute",
                left: Math.min(Math.max(xScale(selectedIdx) - 40, 4), containerWidth - 84),
                top: Math.max(yScale(data[selectedIdx].dailyTime) - 36, 4),
                backgroundColor: colors.card,
                borderRadius: 6,
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderWidth: 0.5,
                borderColor: colors.border,
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.15,
                shadowRadius: 2,
                elevation: 3,
              }}
              pointerEvents="none"
            >
              <Text style={{ fontSize: 12, color: colors.cardForeground, fontWeight: "500" }}>
                {formatDate(data[selectedIdx].date)} {formatTime(data[selectedIdx].dailyTime)}
              </Text>
            </View>
          )}
        </>
      )}
    </TouchableOpacity>
  );
}
