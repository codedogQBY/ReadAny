import type { StatsDimension, StatsPeriodRef } from "./schema";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function toLocalDate(input: Date | number | string): Date {
  return input instanceof Date ? new Date(input) : new Date(input);
}

export function fromLocalDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function toLocalDateKey(input: Date | number | string): string {
  const date = toLocalDate(input);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function getWeekStartDate(input: Date | number | string): Date {
  const date = toLocalDate(input);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function getWeekEndDate(input: Date | number | string): Date {
  const start = getWeekStartDate(input);
  start.setDate(start.getDate() + 6);
  start.setHours(23, 59, 59, 999);
  return start;
}

export function getMonthStartDate(input: Date | number | string): Date {
  const date = toLocalDate(input);
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function getMonthEndDate(input: Date | number | string): Date {
  const date = toLocalDate(input);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function getYearStartDate(input: Date | number | string): Date {
  const date = toLocalDate(input);
  return new Date(date.getFullYear(), 0, 1);
}

export function getYearEndDate(input: Date | number | string): Date {
  const date = toLocalDate(input);
  return new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999);
}

function getIsoWeekNumber(date: Date): number {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  const weekNumber =
    1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return weekNumber;
}

export function getWeekKey(input: Date | number | string): string {
  const start = getWeekStartDate(input);
  return `${start.getFullYear()}-W${pad2(getIsoWeekNumber(start))}`;
}

export function getMonthKey(input: Date | number | string): string {
  const date = toLocalDate(input);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

export function getYearKey(input: Date | number | string): string {
  return String(toLocalDate(input).getFullYear());
}

export function buildPeriodRef(
  dimension: Exclude<StatsDimension, "lifetime">,
  input: Date | number | string,
): StatsPeriodRef {
  if (dimension === "day") {
    const dateKey = toLocalDateKey(input);
    return {
      dimension,
      key: dateKey,
      startDate: dateKey,
      endDate: dateKey,
      label: dateKey,
    };
  }

  if (dimension === "week") {
    const start = getWeekStartDate(input);
    const end = getWeekEndDate(input);
    return {
      dimension,
      key: getWeekKey(start),
      startDate: toLocalDateKey(start),
      endDate: toLocalDateKey(end),
      label: `${getWeekKey(start)} · ${toLocalDateKey(start)} - ${toLocalDateKey(end)}`,
    };
  }

  if (dimension === "month") {
    const start = getMonthStartDate(input);
    const end = getMonthEndDate(input);
    return {
      dimension,
      key: getMonthKey(start),
      startDate: toLocalDateKey(start),
      endDate: toLocalDateKey(end),
      label: getMonthKey(start),
    };
  }

  const start = getYearStartDate(input);
  const end = getYearEndDate(input);
  return {
    dimension,
    key: getYearKey(start),
    startDate: toLocalDateKey(start),
    endDate: toLocalDateKey(end),
    label: getYearKey(start),
  };
}

export function buildLifetimePeriodRef(joinedSince: Date | number | string): StatsPeriodRef {
  const startDate = toLocalDateKey(joinedSince);
  const endDate = toLocalDateKey(new Date());
  return {
    dimension: "lifetime",
    key: "lifetime",
    startDate,
    endDate,
    label: `Since ${startDate}`,
  };
}
