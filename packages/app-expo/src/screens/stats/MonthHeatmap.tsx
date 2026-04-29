import { useColors, withOpacity } from "@/styles/theme";
import type { StatsChartBlock } from "@readany/core/stats";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import type { StatsCopy } from "./StatsSections";
import { makeStyles } from "./stats-styles";
import { formatCompactMinutes } from "./stats-utils";

type MonthCell = {
  dateKey: string;
  dayOfMonth: number;
  value: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  intensity: 0 | 1 | 2 | 3 | 4;
};

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getIntensityLevel(value: number, maxValue: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || maxValue <= 0) return 0;
  const ratio = value / maxValue;
  if (ratio < 0.2) return 1;
  if (ratio < 0.5) return 2;
  if (ratio < 0.75) return 3;
  return 4;
}

function buildMonthGrid(
  year: number,
  month: number,
  valueMap: Map<string, number>,
  maxValue: number,
  todayKey: string,
) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const totalDays = lastDay.getDate();
  const leadingDays = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((leadingDays + totalDays) / 7) * 7;
  const prevMonthLastDay = new Date(year, month, 0).getDate();

  const cells: MonthCell[] = [];
  for (let index = 0; index < totalCells; index += 1) {
    const offset = index - leadingDays + 1;
    let date: Date;
    let dayOfMonth: number;
    let inCurrentMonth = true;

    if (offset < 1) {
      inCurrentMonth = false;
      dayOfMonth = prevMonthLastDay + offset;
      date = new Date(year, month - 1, dayOfMonth);
    } else if (offset > totalDays) {
      inCurrentMonth = false;
      dayOfMonth = offset - totalDays;
      date = new Date(year, month + 1, dayOfMonth);
    } else {
      dayOfMonth = offset;
      date = new Date(year, month, dayOfMonth);
    }

    const dateKey = toDateKey(date);
    const value = inCurrentMonth ? (valueMap.get(dateKey) ?? 0) : 0;
    cells.push({
      dateKey,
      dayOfMonth,
      value,
      inCurrentMonth,
      isToday: dateKey === todayKey,
      intensity: getIntensityLevel(value, maxValue),
    });
  }

  return Array.from({ length: cells.length / 7 }, (_, rowIndex) =>
    cells.slice(rowIndex * 7, rowIndex * 7 + 7),
  );
}

export function MonthHeatmap({
  chart,
  isZh,
  copy,
}: {
  chart: StatsChartBlock;
  isZh: boolean;
  copy: StatsCopy;
}) {
  const colors = useColors();
  const s = makeStyles(colors);
  const locale = isZh ? "zh-CN" : "en-US";

  const valueMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const datum of chart.data) map.set(datum.key, datum.value);
    return map;
  }, [chart.data]);

  const maxValue = useMemo(
    () => Math.max(...chart.data.map((datum) => datum.value), 1),
    [chart.data],
  );

  const firstDate = chart.data[0]?.key;
  const year = firstDate ? Number(firstDate.slice(0, 4)) : new Date().getFullYear();
  const month = firstDate ? Number(firstDate.slice(5, 7)) - 1 : new Date().getMonth();
  const todayKey = useMemo(() => toDateKey(new Date()), []);

  const weeks = useMemo(
    () => buildMonthGrid(year, month, valueMap, maxValue, todayKey),
    [maxValue, month, todayKey, valueMap, year],
  );

  const weekLabels = useMemo(() => {
    const monday = new Date(2024, 0, 1);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
    });
  }, [locale]);

  const [containerWidth, setContainerWidth] = useState(0);
  const [selected, setSelected] = useState<{
    dateKey: string;
    value: number;
    left: number;
    top: number;
  } | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const gap = 6;
  const headerHeight = 24;
  const tooltipWidth = 136;
  const tooltipHeight = 28;
  const cellSize =
    containerWidth > 0
      ? Math.max(34, Math.min(48, Math.floor((containerWidth - gap * 6) / 7)))
      : 40;

  const showTooltip = (cell: MonthCell, rowIndex: number, columnIndex: number) => {
    const centerX = columnIndex * (cellSize + gap) + cellSize / 2;
    const cellTop = headerHeight + rowIndex * (cellSize + gap);
    let left = centerX - tooltipWidth / 2;
    let top = cellTop - tooltipHeight - 8;

    if (left < 0) left = 0;
    if (left + tooltipWidth > containerWidth) left = Math.max(0, containerWidth - tooltipWidth);
    if (top < headerHeight + 2) top = cellTop + cellSize + 8;

    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    setSelected({ dateKey: cell.dateKey, value: cell.value, left, top });
    clearTimerRef.current = setTimeout(() => {
      setSelected((current) => (current?.dateKey === cell.dateKey ? null : current));
    }, 1500);
  };

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  const getCellBackground = (cell: MonthCell) => {
    if (!cell.inCurrentMonth) return withOpacity(colors.muted, 0.12);
    if (cell.intensity === 0) return withOpacity(colors.muted, 0.18);
    if (cell.intensity === 1) return withOpacity(colors.primary, 0.18);
    if (cell.intensity === 2) return withOpacity(colors.primary, 0.32);
    if (cell.intensity === 3) return withOpacity(colors.primary, 0.5);
    return withOpacity(colors.primary, 0.72);
  };

  return (
    <View
      style={{ gap: 10, position: "relative" }}
      onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
    >
      <View style={{ gap: gap }}>
        <View style={{ flexDirection: "row", gap }}>
          {weekLabels.map((label) => (
            <View
              key={label}
              style={{
                width: cellSize,
                alignItems: "center",
                justifyContent: "center",
                height: 18,
              }}
            >
              <Text style={s.calendarHeaderText}>{label}</Text>
            </View>
          ))}
        </View>

        {weeks.map((week, rowIndex) => (
          <View key={`${year}-${month}-${rowIndex}`} style={{ flexDirection: "row", gap }}>
            {week.map((cell, columnIndex) => {
              const active = selected?.dateKey === cell.dateKey;
              return (
                <TouchableOpacity
                  key={cell.dateKey}
                  activeOpacity={0.82}
                  onPress={() => showTooltip(cell, rowIndex, columnIndex)}
                  style={[
                    {
                      width: cellSize,
                      height: cellSize,
                      borderRadius: 14,
                      paddingHorizontal: 7,
                      paddingVertical: 6,
                      backgroundColor: getCellBackground(cell),
                      borderWidth: active || cell.isToday ? 1.5 : 1,
                      borderColor: cell.isToday
                        ? withOpacity(colors.primary, 0.55)
                        : active
                          ? withOpacity(colors.foreground, 0.18)
                          : withOpacity(colors.border, 0.22),
                      justifyContent: "space-between",
                    },
                    active
                      ? {
                          transform: [{ scale: 1.03 }],
                        }
                      : null,
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: "700",
                      color: cell.inCurrentMonth
                        ? cell.intensity >= 3
                          ? colors.primaryForeground
                          : withOpacity(colors.foreground, 0.84)
                        : withOpacity(colors.mutedForeground, 0.34),
                    }}
                  >
                    {cell.dayOfMonth}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {selected ? (
        <View
          pointerEvents="none"
          style={[
            s.tooltip,
            {
              left: selected.left,
              top: selected.top,
              minWidth: tooltipWidth,
              minHeight: tooltipHeight,
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 5,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.12,
              shadowRadius: 12,
              elevation: 4,
            },
          ]}
        >
          <Text style={s.tooltipText}>
            {new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(
              new Date(`${selected.dateKey}T00:00:00`),
            )}{" "}
            · {formatCompactMinutes(selected.value, isZh)}
          </Text>
        </View>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <View style={s.heatmapLegend}>
          <Text style={s.legendText}>{copy.heatmapLegendLow}</Text>
          {[0, 1, 2, 3, 4].map((level) => (
            <View
              key={level}
              style={[
                s.legendCell,
                {
                  width: 12,
                  height: 12,
                  borderRadius: 4,
                  backgroundColor:
                    level === 0
                      ? withOpacity(colors.muted, 0.18)
                      : level === 1
                        ? withOpacity(colors.primary, 0.18)
                        : level === 2
                          ? withOpacity(colors.primary, 0.32)
                          : level === 3
                            ? withOpacity(colors.primary, 0.5)
                            : withOpacity(colors.primary, 0.72),
                },
              ]}
            />
          ))}
          <Text style={s.legendText}>{copy.heatmapLegendHigh}</Text>
        </View>

        <Text style={{ fontSize: 11, color: withOpacity(colors.foreground, 0.6) }}>
          {copy.activeDaysSummary(chart.data.filter((item) => item.value > 0).length)}
        </Text>
      </View>
    </View>
  );
}
