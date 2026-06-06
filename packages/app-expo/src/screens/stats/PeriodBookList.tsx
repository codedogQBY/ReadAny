import { useColors } from "@/styles/theme";
import type { PeriodBookStats } from "@readany/core/stats";
import { getBookProgressPercent } from "@readany/core/utils";
import { useTranslation } from "react-i18next";
import { Image, Text, View } from "react-native";
import { makeStyles } from "./stats-styles";
import { formatTime } from "./stats-utils";

export function PeriodBookList({
  books,
  resolvedCovers,
}: {
  books: PeriodBookStats[];
  resolvedCovers: Map<string, string>;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const s = makeStyles(colors);

  if (books.length === 0) {
    return <Text style={s.periodBooksEmpty}>{t("stats.noBooksInPeriod")}</Text>;
  }

  return (
    <View style={{ gap: 6 }}>
      {books.map((book) => {
        const coverUrl = resolvedCovers.get(book.bookId) || book.coverUrl;
        const progressPct = getBookProgressPercent(book.progress);
        return (
          <View key={book.bookId} style={s.bookRow}>
            {coverUrl ? (
              <Image source={{ uri: coverUrl }} style={s.bookCover} resizeMode="cover" />
            ) : (
              <View style={s.bookCoverPlaceholder}>
                <Text style={s.bookCoverLetter}>{book.title.charAt(0)}</Text>
              </View>
            )}
            <View style={s.bookInfo}>
              <View style={s.bookTitleRow}>
                <Text style={s.bookTitle} numberOfLines={1}>
                  {book.title}
                </Text>
                <Text style={s.bookTime}>{formatTime(book.totalTime)}</Text>
              </View>
              {book.author && <Text style={s.bookAuthor}>{book.author}</Text>}
              <View style={s.progressRow}>
                <View style={s.progressTrack}>
                  <View style={[s.progressFill, { width: `${progressPct}%` }]} />
                </View>
                <Text style={s.progressPercent}>{progressPct}%</Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}
