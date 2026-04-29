import { Trash2Icon } from "@/components/ui/Icon";
import { useColors } from "@/styles/theme";
import type { HighlightWithBook } from "@readany/core/db/database";
import { HIGHLIGHT_COLOR_HEX } from "@readany/core/types";
import { Text, TouchableOpacity, View } from "react-native";
import { makeStyles } from "./notes-styles";

export function HighlightCard({
  highlight,
  onDelete,
  onNavigate,
}: {
  highlight: HighlightWithBook;
  onDelete: () => void;
  onNavigate: () => void;
}) {
  const colors = useColors();
  const s = makeStyles(colors);
  return (
    <View style={s.highlightCard}>
      <TouchableOpacity
        style={[
          s.colorDot,
          { backgroundColor: HIGHLIGHT_COLOR_HEX[highlight.color] || colors.amber, marginTop: 4 },
        ]}
        onPress={onNavigate}
      />
      <View style={s.highlightBody}>
        <TouchableOpacity onPress={onNavigate}>
          <Text style={s.highlightText} numberOfLines={2}>
            "{highlight.text}"
          </Text>
        </TouchableOpacity>
        {highlight.chapterTitle && <Text style={s.highlightChapter}>{highlight.chapterTitle}</Text>}
      </View>
      <TouchableOpacity style={s.highlightDeleteBtn} onPress={onDelete}>
        <Trash2Icon size={14} color={colors.mutedForeground} />
      </TouchableOpacity>
    </View>
  );
}
