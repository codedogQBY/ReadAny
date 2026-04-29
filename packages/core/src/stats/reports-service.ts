import { getAllReadingSessions, getBooks } from "../db";
import type { ReadingSession } from "../types";
import { buildDailyReadingFacts } from "./fact-builder";
import { mergeCurrentSessionIntoDailyFacts } from "./live-facts";
import {
  buildDayReport,
  buildLifetimeReport,
  buildMonthReport,
  buildWeekReport,
  buildYearReport,
} from "./report-builder";
import type {
  DailyReadingFact,
  DayReport,
  LifetimeReport,
  MonthReport,
  WeekReport,
  YearReport,
} from "./schema";

export class ReadingReportsService {
  async getAllDailyFacts(
    currentSession: ReadingSession | null = null,
  ): Promise<DailyReadingFact[]> {
    const [books, sessions] = await Promise.all([
      getBooks({ includeDeleted: true }),
      getAllReadingSessions(),
    ]);
    const facts = buildDailyReadingFacts(sessions, books);
    return mergeCurrentSessionIntoDailyFacts(facts, currentSession, books);
  }

  async getDayReport(date: Date, currentSession: ReadingSession | null = null): Promise<DayReport> {
    const facts = await this.getAllDailyFacts(currentSession);
    return buildDayReport(facts, date);
  }

  async getWeekReport(
    date: Date,
    currentSession: ReadingSession | null = null,
  ): Promise<WeekReport> {
    const facts = await this.getAllDailyFacts(currentSession);
    return buildWeekReport(facts, date);
  }

  async getMonthReport(
    date: Date,
    currentSession: ReadingSession | null = null,
  ): Promise<MonthReport> {
    const facts = await this.getAllDailyFacts(currentSession);
    return buildMonthReport(facts, date);
  }

  async getYearReport(
    date: Date,
    currentSession: ReadingSession | null = null,
  ): Promise<YearReport> {
    const facts = await this.getAllDailyFacts(currentSession);
    return buildYearReport(facts, date);
  }

  async getLifetimeReport(currentSession: ReadingSession | null = null): Promise<LifetimeReport> {
    const facts = await this.getAllDailyFacts(currentSession);
    return buildLifetimeReport(facts);
  }
}

export const readingReportsService = new ReadingReportsService();
