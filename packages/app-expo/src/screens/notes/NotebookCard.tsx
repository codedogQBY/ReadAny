import { BookOpenIcon, HighlighterIcon, NotebookPenIcon } from "@/components/ui/Icon";
import { useColors } from "@/styles/theme";
import type { HighlightWithBook } from "@readany/core/db/database";
import { Image, Text, TouchableOpacity, View } from "react-native";
import { makeStyles } from "./notes-styles";

export function NotebookCard({
  book,
  onPress,
  resolvedCoverUrl,
}: {
  book: {
    bookId: string;
    title: string;
    author: string;
    coverUrl: string | null;
    highlights: HighlightWithBook[];
    notesCount: number;
    highlightsOnlyCount: number;
  };
  onPress: () => void;
  resolvedCoverUrl?: string;
}) {
  const colors = useColors();
  const s = makeStyles(colors);

  return (
    <TouchableOpacity style={s.notebookCard} activeOpacity={0.7} onPress={onPress}>
      {resolvedCoverUrl || book.coverUrl ? (
        <Image
          source={{ uri: resolvedCoverUrl || book.coverUrl || "" }}
          style={s.notebookCover}
          resizeMode="cover"
        />
      ) : (
        <View style={s.notebookCoverFallback}>
          <BookOpenIcon size={20} color={colors.mutedForeground} />
        </View>
      )}
      <View style={s.notebookInfo}>
        <Text style={s.notebookTitle} numberOfLines={1}>
          {book.title}
        </Text>
        <Text style={s.notebookAuthor} numberOfLines={1}>
          {book.author}
        </Text>
        <View style={s.notebookStats}>
          <View style={s.notebookStatItem}>
            <NotebookPenIcon size={12} color={colors.mutedForeground} />
            <Text style={s.notebookStatText}>{book.notesCount}</Text>
          </View>
          <View style={s.notebookStatItem}>
            <HighlighterIcon size={12} color={colors.mutedForeground} />
            <Text style={s.notebookStatText}>{book.highlightsOnlyCount}</Text>
          </View>
        </View>
      </View>
      <View style={s.notebookBadge}>
        <Text style={s.notebookBadgeText}>{book.highlights.length}</Text>
      </View>
    </TouchableOpacity>
  );
}
