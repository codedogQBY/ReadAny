import type { StatsChartDatum } from "@readany/core/stats";
import { cn } from "@readany/core/utils";
import { useMemo, useRef, useState } from "react";
import { formatCompactMinutes } from "./stats-utils";

interface HeatmapChartProps {
  data: StatsChartDatum[];
  emptyMessage?: string;
  isZh?: boolean;
  lowLabel: string;
  highLabel: string;
  activeDaysLabel: (count: number) => string;
}

type MonthCell = {
  dateKey: string;
  dayOfMonth: number;
  value: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  intensity: 0 | 1 | 2 | 3 | 4;
};

type TooltipState = {
  dateKey: string;
  value: number;
  left: number;
  top: number;
  pinned: boolean;
} | null;

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toMonthDayLabel(dateKey: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
  }).format(new Date(`${dateKey}T00:00:00`));
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

function getIntensityClass(cell: MonthCell) {
  if (!cell.inCurrentMonth) return "bg-muted/[0.10] border-border/12";
  if (cell.intensity === 0) return "bg-muted/[0.18] border-border/18";
  if (cell.intensity === 1) return "bg-primary/[0.16] border-primary/[0.12]";
  if (cell.intensity === 2) return "bg-primary/[0.28] border-primary/[0.18]";
  if (cell.intensity === 3) return "bg-primary/[0.45] border-primary/[0.24]";
  return "bg-primary/[0.68] border-primary/[0.30]";
}

export function HeatmapChart({
  data,
  emptyMessage,
  isZh = false,
  lowLabel,
  highLabel,
  activeDaysLabel,
}: HeatmapChartProps) {
  const locale = isZh ? "zh-CN" : "en-US";
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  const valueMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of data) map.set(item.key, item.value);
    return map;
  }, [data]);

  const maxValue = useMemo(() => Math.max(...data.map((item) => item.value), 1), [data]);
  const firstDateKey = data[0]?.key;
  const year = firstDateKey ? Number(firstDateKey.slice(0, 4)) : new Date().getFullYear();
  const month = firstDateKey ? Number(firstDateKey.slice(5, 7)) - 1 : new Date().getMonth();
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

  const activeDays = useMemo(() => data.filter((item) => item.value > 0).length, [data]);

  const setTooltipFromCell = (cell: MonthCell, pinned: boolean, target: HTMLElement) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const tooltipWidth = 150;
    const tooltipHeight = 36;

    const centerX = targetRect.left - wrapperRect.left + targetRect.width / 2;
    const cellTop = targetRect.top - wrapperRect.top;
    let left = centerX - tooltipWidth / 2;
    let top = cellTop - tooltipHeight - 8;

    if (left < 8) left = 8;
    if (left + tooltipWidth > wrapperRect.width - 8) left = wrapperRect.width - tooltipWidth - 8;
    if (top < 8) top = cellTop + targetRect.height + 8;

    setTooltip({
      dateKey: cell.dateKey,
      value: cell.value,
      left,
      top,
      pinned,
    });
  };

  if (data.length === 0) {
    return (
      <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        ref={wrapperRef}
        className="relative rounded-[24px] border border-border/20 bg-gradient-to-b from-primary/[0.04] via-transparent to-transparent p-4 sm:p-5"
        onMouseLeave={() => setTooltip((current) => (current?.pinned ? current : null))}
      >
        <div className="grid grid-cols-7 gap-2.5">
          {weekLabels.map((label) => (
            <div
              key={label}
              className="flex h-6 items-center justify-center text-[11px] font-medium text-muted-foreground/56"
            >
              {label}
            </div>
          ))}
        </div>

        <div className="mt-2.5 space-y-2.5">
          {weeks.map((week, rowIndex) => (
            <div key={`${year}-${month}-${rowIndex}`} className="grid grid-cols-7 gap-2.5">
              {week.map((cell) => {
                const active = tooltip?.dateKey === cell.dateKey;
                return (
                  <button
                    key={cell.dateKey}
                    type="button"
                    onMouseEnter={(event) => setTooltipFromCell(cell, false, event.currentTarget)}
                    onFocus={(event) => setTooltipFromCell(cell, false, event.currentTarget)}
                    onBlur={() => setTooltip((current) => (current?.pinned ? current : null))}
                    onClick={(event) => {
                      if (tooltip?.dateKey === cell.dateKey && tooltip.pinned) {
                        setTooltip(null);
                        return;
                      }
                      setTooltipFromCell(cell, true, event.currentTarget);
                    }}
                    aria-label={`${toMonthDayLabel(cell.dateKey, locale)} · ${formatCompactMinutes(
                      cell.value,
                      isZh,
                    )}`}
                    className={cn(
                      "group flex aspect-square flex-col justify-between rounded-[18px] border p-2.5 text-left transition-all duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
                      "hover:-translate-y-0.5",
                      getIntensityClass(cell),
                      cell.isToday &&
                        "ring-1.5 ring-primary/45 ring-offset-1 ring-offset-background",
                      active && "scale-[1.02] shadow-[0_12px_28px_rgba(0,0,0,0.08)]",
                    )}
                  >
                    <span
                      className={cn(
                        "text-[13px] font-semibold tabular-nums",
                        cell.inCurrentMonth
                          ? cell.intensity >= 3
                            ? "text-primary-foreground"
                            : "text-foreground/82"
                          : "text-muted-foreground/34",
                      )}
                    >
                      {cell.dayOfMonth}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {tooltip ? (
          <div
            className="pointer-events-none absolute z-20 rounded-full border border-border/40 bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-[0_12px_28px_rgba(0,0,0,0.10)] backdrop-blur-sm"
            style={{
              left: `${tooltip.left}px`,
              top: `${tooltip.top}px`,
              minWidth: "150px",
              height: "36px",
            }}
          >
            <div className="flex h-full items-center justify-center whitespace-nowrap">
              {toMonthDayLabel(tooltip.dateKey, locale)} ·{" "}
              {formatCompactMinutes(tooltip.value, isZh)}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground/65">
          <span>{lowLabel}</span>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2, 3, 4].map((level) => (
              <span
                key={level}
                className={cn(
                  "h-3 w-3 rounded-[4px]",
                  level === 0
                    ? "bg-muted/[0.18]"
                    : level === 1
                      ? "bg-primary/[0.16]"
                      : level === 2
                        ? "bg-primary/[0.28]"
                        : level === 3
                          ? "bg-primary/[0.45]"
                          : "bg-primary/[0.68]",
                )}
              />
            ))}
          </div>
          <span>{highLabel}</span>
        </div>

        <div className="text-xs text-muted-foreground/65">{activeDaysLabel(activeDays)}</div>
      </div>
    </div>
  );
}
