/**
 * CalendarSection.tsx — Month calendar section with day cells.
 * Extracted from StatsSections.tsx.
 */
import { useColors, withOpacity } from "@/styles/theme";
import type { MonthReport, StatsCalendarCell } from "@readany/core/stats";
import { useMemo, useState } from "react";
import { Image, Text, TouchableOpacity, View } from "react-native";
import { makeStyles } from "./stats-styles";
import { formatCompactMinutes } from "./stats-utils";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Month Calendar
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function MonthCalendarSection({
  calendar,
  isZh,
  resolvedCovers,
}: {
  calendar: NonNullable<MonthReport["readingCalendar"]>;
  isZh: boolean;
  resolvedCovers: Map<string, string>;
}) {
  const colors = useColors();
  const s = makeStyles(colors);
  const locale = isZh ? "zh-CN" : "en-US";

  const weekLabels = useMemo(() => {
    const monday = new Date(2024, 0, 1); // Monday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d);
    });
  }, [locale]);

  return (
    <View style={{ gap: 4 }}>
      {/* Weekday header */}
      <View style={s.calendarRow}>
        {weekLabels.map((label) => (
          <View key={label} style={s.calendarHeaderCell}>
            <Text style={s.calendarHeaderText}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Week rows */}
      {calendar.weeks.map((week, wIdx) => (
        <View key={`${calendar.monthKey}-${wIdx}`} style={s.calendarRow}>
          {week.map((cell) => (
            <CalendarDayCell
              key={cell.date}
              cell={cell}
              isZh={isZh}
              resolvedCovers={resolvedCovers}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Calendar Day Cell
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function CalendarDayCell({
  cell,
  isZh,
  resolvedCovers,
}: {
  cell: StatsCalendarCell;
  isZh: boolean;
  resolvedCovers: Map<string, string>;
}) {
  const colors = useColors();
  const s = makeStyles(colors);
  const [coverIdx, setCoverIdx] = useState(0);

  const hasCovers = cell.covers.length > 0;
  const multipleCovers = cell.covers.length > 1;
  const currentCover = hasCovers ? cell.covers[coverIdx % cell.covers.length] : null;
  const currentCoverUrl = currentCover
    ? resolvedCovers.get(currentCover.bookId) || currentCover.coverUrl
    : undefined;

  const handlePress = () => {
    if (multipleCovers) {
      setCoverIdx((prev) => (prev + 1) % cell.covers.length);
    }
  };

  // Intensity-based background (only for cells without covers)
  const intensityBg =
    !cell.inCurrentMonth && cell.intensity === 0
      ? withOpacity(colors.muted, 0.15)
      : cell.intensity === 0
        ? colors.card
        : cell.intensity === 1
          ? withOpacity(colors.primary, 0.04)
          : cell.intensity === 2
            ? withOpacity(colors.primary, 0.08)
            : cell.intensity === 3
              ? withOpacity(colors.primary, 0.14)
              : withOpacity(colors.primary, 0.22);

  const intensityBorder =
    !cell.inCurrentMonth && cell.intensity === 0
      ? "transparent"
      : cell.intensity === 0
        ? withOpacity(colors.border, 0.3)
        : withOpacity(colors.primary, 0.08 + cell.intensity * 0.04);

  /* ── Cell WITH cover: StatsBookCover fills entire cell ── */
  if (currentCover) {
    const inner = (
      <View
        style={[
          s.calCoverCell,
          cell.isToday && s.calCoverCellToday,
          { opacity: cell.inCurrentMonth ? 1 : 0.55 },
        ]}
      >
        {/* Cover — using shared library-style component */}
        {currentCoverUrl ? (
          <Image source={{ uri: currentCoverUrl }} style={s.calCoverImage} resizeMode="cover" />
        ) : (
          <View style={s.calCoverFallback}>
            <View style={s.calCoverFallbackTop} />
            <View style={s.calCoverFallbackBottom} />
            <View style={s.calCoverFallbackOverlay}>
              <Text style={s.calCoverFallbackText} numberOfLines={2}>
                {currentCover.title.slice(0, 6)}
              </Text>
            </View>
          </View>
        )}

        {/* Spine overlay */}
        <View style={s.calSpineOverlay}>
          <View style={{ width: "6%", height: "100%", backgroundColor: "rgba(0,0,0,0.10)" }} />
          <View style={{ width: "8%", height: "100%", backgroundColor: "rgba(20,20,20,0.20)" }} />
          <View
            style={{ width: "5%", height: "100%", backgroundColor: "rgba(240,240,240,0.40)" }}
          />
          <View
            style={{ width: "18%", height: "100%", backgroundColor: "rgba(215,215,215,0.35)" }}
          />
          <View
            style={{ width: "12%", height: "100%", backgroundColor: "rgba(150,150,150,0.25)" }}
          />
          <View
            style={{ width: "20%", height: "100%", backgroundColor: "rgba(100,100,100,0.18)" }}
          />
          <View
            style={{ width: "31%", height: "100%", backgroundColor: "rgba(175,175,175,0.12)" }}
          />
        </View>
        <View style={s.calSpineEdgeRight} />
        <View style={s.calSpineTopHighlight} />
        <View style={s.calSpineBottomShadow} />

        {/* Top scrim — gradient for date readability */}
        <View style={s.calCoverTopScrim} />

        {/* Overlaid info */}
        <View style={s.calCoverOverlay}>
          <View style={s.calCoverTopRow}>
            <Text style={s.calCoverDay}>{cell.dayOfMonth}</Text>
            {cell.totalTime > 0 && (
              <Text style={s.calCoverTime}>{formatCompactMinutes(cell.totalTime, isZh)}</Text>
            )}
          </View>
          {multipleCovers && (
            <View style={s.calCoverPageBadge}>
              <Text style={s.calCoverPageText}>
                {(coverIdx % cell.covers.length) + 1}/{cell.covers.length}
              </Text>
            </View>
          )}
        </View>
      </View>
    );

    if (multipleCovers) {
      return (
        <TouchableOpacity activeOpacity={0.8} onPress={handlePress} style={{ flex: 1 }}>
          {inner}
        </TouchableOpacity>
      );
    }
    return <View style={{ flex: 1 }}>{inner}</View>;
  }

  /* ── Cell WITHOUT cover: plain intensity cell ── */
  return (
    <View style={{ flex: 1 }}>
      <View
        style={[
          s.calPlainCell,
          {
            backgroundColor: intensityBg,
            borderColor: intensityBorder,
            opacity: cell.inCurrentMonth ? 1 : 0.55,
          },
          cell.isToday && s.calPlainCellToday,
        ]}
      >
        <Text
          style={[
            s.calPlainDay,
            cell.isToday && { color: withOpacity(colors.primary, 0.7) },
            !cell.inCurrentMonth && { color: withOpacity(colors.mutedForeground, 0.25) },
          ]}
        >
          {cell.dayOfMonth}
        </Text>
        {cell.totalTime > 0 && (
          <Text style={s.calPlainTime}>{formatCompactMinutes(cell.totalTime, isZh)}</Text>
        )}
      </View>
    </View>
  );
}
