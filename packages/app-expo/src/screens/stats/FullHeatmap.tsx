import { useColors, withOpacity } from "@/styles/theme";
import type { DailyStats } from "@readany/core/stats";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { formatTime } from "./stats-utils";

export function FullHeatmap({ dailyStats }: { dailyStats: DailyStats[] }) {
  const colors = useColors();
  const { t, i18n } = useTranslation();
  const [selectedDay, setSelectedDay] = useState<{
    date: string;
    time: number;
    weekIdx: number;
    dayIdx: number;
  } | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const CELL = 10;
  const GAP = 2;
  const UNIT = CELL + GAP;
  const WEEKS = 26;
  const TOOLTIP_WIDTH = 80;
  const TOOLTIP_HEIGHT = 24;

  const { weeks, monthLabels } = useMemo(() => {
    const statsMap = new Map<string, number>();
    for (const d of dailyStats) statsMap.set(d.date, d.totalTime);

    const today = new Date();
    const todayDay = today.getDay();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - (WEEKS * 7 + todayDay - 1));

    const weeksArr: Array<Array<{ date: string; time: number; dayOfWeek: number }>> = [];
    const mLabels: Array<{ label: string; col: number }> = [];
    let currentWeek: Array<{ date: string; time: number; dayOfWeek: number }> = [];
    let lastMonth = -1;
    let weekIdx = 0;
    const cursor = new Date(startDate);

    while (cursor <= today) {
      const dateStr = cursor.toISOString().split("T")[0];
      const dow = cursor.getDay();
      const month = cursor.getMonth();

      if (dow === 0 && currentWeek.length > 0) {
        weeksArr.push(currentWeek);
        currentWeek = [];
        weekIdx++;
      }

      if (month !== lastMonth) {
        mLabels.push({
          label: new Intl.DateTimeFormat(i18n.language, { month: "short" }).format(
            new Date(2024, month, 1),
          ),
          col: weekIdx,
        });
        lastMonth = month;
      }

      currentWeek.push({ date: dateStr, time: statsMap.get(dateStr) || 0, dayOfWeek: dow });
      cursor.setDate(cursor.getDate() + 1);
    }
    if (currentWeek.length > 0) weeksArr.push(currentWeek);

    return { weeks: weeksArr, monthLabels: mLabels };
  }, [dailyStats, i18n.language]);

  const getColor = (minutes: number) => {
    if (minutes <= 0) return colors.muted;
    if (minutes < 15) return withOpacity(colors.primary, 0.3);
    if (minutes < 30) return withOpacity(colors.primary, 0.5);
    if (minutes < 60) return withOpacity(colors.primary, 0.7);
    return withOpacity(colors.primary, 0.9);
  };

  const formatDisplayDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const handleCellPress = (
    day: { date: string; time: number },
    weekIdx: number,
    dayIdx: number,
  ) => {
    if (selectedDay?.date === day.date) {
      setSelectedDay(null);
    } else {
      setSelectedDay({ ...day, weekIdx, dayIdx });
      setTimeout(() => setSelectedDay(null), 1000);
    }
  };

  const getTooltipStyle = () => {
    if (!selectedDay || containerWidth === 0) return null;
    const { weekIdx, dayIdx } = selectedDay;
    const firstWeekPadding = weeks[0]?.[0]?.dayOfWeek || 0;
    const paddingOffset = weekIdx === 0 ? firstWeekPadding * UNIT : 0;
    const cellX = weekIdx * UNIT + CELL / 2;
    const cellY = paddingOffset + dayIdx * UNIT + CELL / 2;
    let left = cellX - TOOLTIP_WIDTH / 2;
    let top = cellY - TOOLTIP_HEIGHT - 8;
    if (left < 4) left = 4;
    if (left + TOOLTIP_WIDTH > containerWidth - 4) left = containerWidth - TOOLTIP_WIDTH - 4;
    if (top < 4) top = cellY + CELL + 4;
    return { left, top };
  };

  const tooltipStyle = getTooltipStyle();

  return (
    <View
      style={{ position: "relative" }}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", height: 14, marginBottom: 2 }}>
          {monthLabels.map((m, i) => {
            const nextCol = i + 1 < monthLabels.length ? monthLabels[i + 1].col : weeks.length;
            const span = nextCol - m.col;
            return (
              <View
                key={`${m.label}-${m.col}`}
                style={{ width: span * UNIT, minWidth: span * UNIT }}
              >
                {span >= 2 && (
                  <Text style={{ fontSize: 9, color: colors.mutedForeground }}>{m.label}</Text>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: GAP }}>
          {weeks.map((week, wi) => (
            <View key={wi} style={{ flexDirection: "column", gap: GAP }}>
              {wi === 0 &&
                week[0] &&
                week[0].dayOfWeek > 0 &&
                Array.from({ length: week[0].dayOfWeek }).map((_, i) => (
                  <View key={`pad-${i}`} style={{ width: CELL, height: CELL }} />
                ))}
              {week.map((day, di) => (
                <TouchableOpacity
                  key={day.date}
                  style={{
                    width: CELL,
                    height: CELL,
                    borderRadius: 2,
                    backgroundColor: getColor(day.time),
                  }}
                  onPress={() => handleCellPress(day, wi, di)}
                  activeOpacity={0.7}
                />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>

      {selectedDay && tooltipStyle && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            ...tooltipStyle,
            backgroundColor: colors.card,
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 4,
            borderWidth: 0.5,
            borderColor: colors.border,
            minWidth: TOOLTIP_WIDTH,
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
            {formatDisplayDate(selectedDay.date)}{" "}
            {selectedDay.time > 0 ? formatTime(selectedDay.time) : t("stats.noReading")}
          </Text>
        </View>
      )}
    </View>
  );
}
