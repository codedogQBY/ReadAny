import { ChevronDownIcon, ChevronUpIcon } from "@/components/ui/Icon";
/**
 * TopBooksSection.tsx — Top books section with expand/collapse.
 * Extracted from StatsSections.tsx.
 */
import { useColors, withOpacity } from "@/styles/theme";
import type { DailyReadingFact, TopBookEntry } from "@readany/core/stats";
import { computeBookETA } from "@readany/core/stats";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, TouchableOpacity, View } from "react-native";
import { StatsBookCover } from "./StatsBookCover";
import type { StatsCopy } from "./StatsSections";
import { makeStyles } from "./stats-styles";
import {
  formatCharacterCount,
  formatCharactersPerMinute,
  formatTimeLocalized,
} from "./stats-utils";

const TOP_BOOKS_COLLAPSED = 3;

export function TopBooksSection({
  books,
  resolvedCovers,
  isZh,
  copy,
  allFacts,
}: {
  books: TopBookEntry[];
  resolvedCovers: Map<string, string>;
  isZh: boolean;
  copy: StatsCopy;
  allFacts?: DailyReadingFact[];
}) {
  const colors = useColors();
  const s = makeStyles(colors);
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (books.length === 0) {
    return (
      <Text
        style={{
          fontSize: 13,
          color: withOpacity(colors.mutedForeground, 0.45),
          textAlign: "center",
          paddingVertical: 20,
        }}
      >
        {copy.noTopBooks}
      </Text>
    );
  }

  const canExpand = books.length > TOP_BOOKS_COLLAPSED;
  const visibleBooks = expanded ? books : books.slice(0, TOP_BOOKS_COLLAPSED);

  return (
    <View>
      {visibleBooks.map((book, index) => {
        const isFirst = index === 0;
        const coverUrl = resolvedCovers.get(book.bookId) || book.coverUrl;
        const eta =
          allFacts && book.progress !== undefined && book.progress < 1
            ? computeBookETA(book.bookId, book.progress, book.totalPages, allFacts)
            : null;
        const readingAmountLabel =
          (book.charactersRead ?? 0) > 0
            ? formatCharacterCount(book.charactersRead ?? 0, isZh)
            : null;
        const readingSpeedLabel =
          (book.avgCharactersPerMinute ?? 0) > 0
            ? formatCharactersPerMinute(book.avgCharactersPerMinute ?? 0, isZh)
            : null;
        return (
          <View key={book.bookId} style={[s.bookItem, isFirst && s.bookItemFirst]}>
            {/* Rank */}
            <View style={[s.bookRank, isFirst ? s.bookRankFirst : s.bookRankDefault]}>
              <Text style={[s.bookRankText, isFirst ? s.bookRankTextFirst : s.bookRankTextDefault]}>
                {index + 1}
              </Text>
            </View>

            {/* Cover — library-style */}
            <StatsBookCover coverUrl={coverUrl} title={book.title} width={isFirst ? 52 : 36} />

            {/* Info */}
            <View style={s.bookInfo}>
              {isFirst && <Text style={s.bookLeadBadge}>{copy.topBookLead}</Text>}
              <Text style={[s.bookTitle, isFirst && s.bookTitleFirst]} numberOfLines={1}>
                {book.title}
              </Text>
              <Text style={s.bookAuthor} numberOfLines={1}>
                {book.author || copy.unknownAuthor}
              </Text>
              <View style={s.bookStatsRow}>
                <Text style={[s.bookTime, isFirst ? s.bookTimeFirst : s.bookTimeDefault]}>
                  {formatTimeLocalized(book.totalTime, isZh)}
                </Text>
                <Text style={s.bookMeta}>
                  {readingAmountLabel ? `${readingAmountLabel} · ` : ""}
                  {readingSpeedLabel ? `${readingSpeedLabel} · ` : ""}
                  {book.sessionsCount} {copy.sessionsSuffix}
                </Text>
              </View>
              {eta && (
                <Text
                  style={{
                    marginTop: 2,
                    fontSize: 11,
                    fontWeight: "500",
                    color: withOpacity(colors.primary, 0.7),
                  }}
                >
                  {t("stats.desktop.etaFinishDays", { days: eta.etaDays })}
                </Text>
              )}
            </View>
          </View>
        );
      })}

      {canExpand && (
        <TouchableOpacity
          onPress={() => setExpanded((v) => !v)}
          style={s.expandBtn}
          activeOpacity={0.6}
        >
          <Text style={s.expandBtnText}>
            {expanded ? copy.topBooksCollapse : copy.topBooksExpandCount(books.length)}
          </Text>
          {expanded ? (
            <ChevronUpIcon size={14} color={withOpacity(colors.mutedForeground, 0.5)} />
          ) : (
            <ChevronDownIcon size={14} color={withOpacity(colors.mutedForeground, 0.5)} />
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}
