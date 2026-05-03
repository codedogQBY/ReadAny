import { FolderIcon, MoreVerticalIcon } from "@/components/ui/Icon";
import { type ThemeColors, radius, useColors } from "@/styles/theme";
import { getPlatformService } from "@readany/core/services";
import type { Book, BookGroup } from "@readany/core/types";
import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { makeStyles as makeBookCardStyles } from "./book-card-styles";

interface GroupCardProps {
  group: BookGroup;
  books: Book[];
  cardWidth: number;
  onOpen: (groupId: string) => void;
  onLongPress?: (group: BookGroup) => void;
}

function GroupCoverLayer({
  book,
  index,
  total,
  colors,
  bookStyles,
}: {
  book: Book;
  index: number;
  total: number;
  colors: ThemeColors;
  bookStyles: ReturnType<typeof makeBookCardStyles>;
}) {
  const [uri, setUri] = useState<string | undefined>();
  const [error, setError] = useState(false);

  useEffect(() => {
    const raw = book.meta.coverUrl;
    setError(false);
    if (!raw) {
      setUri(undefined);
      return;
    }
    if (raw.startsWith("http") || raw.startsWith("blob") || raw.startsWith("file")) {
      setUri(raw);
      return;
    }
    (async () => {
      try {
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        setUri(await platform.joinPath(appData, raw));
      } catch {
        setUri(undefined);
      }
    })();
  }, [book.meta.coverUrl]);

  // Covers overlap to fill the entire card
  const allConfigs = {
    1: [{ right: 1, bottom: 1, zIndex: 30, opacity: 1, width: "94%" as const }],
    2: [
      { right: 0, bottom: 0, zIndex: 10, opacity: 0.78, width: "88%" as const },
      { right: 12, bottom: 8, zIndex: 20, opacity: 1, width: "88%" as const },
    ],
    3: [
      { right: 0, bottom: 0, zIndex: 10, opacity: 0.62, width: "82%" as const },
      { right: 10, bottom: 6, zIndex: 20, opacity: 0.8, width: "82%" as const },
      { right: 20, bottom: 12, zIndex: 30, opacity: 1, width: "82%" as const },
    ],
    4: [
      { right: 0, bottom: 0, zIndex: 10, opacity: 0.5, width: "76%" as const },
      { right: 8, bottom: 5, zIndex: 20, opacity: 0.65, width: "76%" as const },
      { right: 16, bottom: 10, zIndex: 30, opacity: 0.82, width: "76%" as const },
      { right: 24, bottom: 15, zIndex: 40, opacity: 1, width: "76%" as const },
    ],
  };
  const configs = allConfigs[total as keyof typeof allConfigs] ?? allConfigs[4];
  const offset = configs[index] ?? configs[0];
  const style = {
    right: offset.right,
    bottom: offset.bottom,
    zIndex: offset.zIndex,
    opacity: offset.opacity,
    width: offset.width,
    aspectRatio: 28 / 41,
  };

  return (
    <View
      style={[
        styles.coverLayer,
        {
          ...style,
          backgroundColor: colors.muted,
        },
      ]}
    >
      {uri && !error ? (
        <>
          <Image
            source={{ uri }}
            style={styles.coverImage}
            resizeMode="cover"
            onError={() => setError(true)}
          />
          <View style={bookStyles.spineOverlay} pointerEvents="none">
            <View style={bookStyles.spineStrip1} />
            <View style={bookStyles.spineStrip2} />
            <View style={bookStyles.spineStrip3} />
            <View style={bookStyles.spineStrip4} />
            <View style={bookStyles.spineStrip5} />
            <View style={bookStyles.spineStrip6} />
            <View style={bookStyles.spineStrip7} />
          </View>
          <View style={bookStyles.spineTopHighlight} pointerEvents="none" />
          <View style={bookStyles.spineBottomShadow} pointerEvents="none" />
        </>
      ) : (
        <View style={bookStyles.fallbackCover}>
          <View style={bookStyles.fallbackGradientTop} />
          <View style={bookStyles.fallbackGradientBottom} />
          <View style={bookStyles.fallbackContentOverlay}>
            <View style={bookStyles.fallbackTitleWrap}>
              <Text style={bookStyles.fallbackTitle} numberOfLines={3}>
                {book.meta.title}
              </Text>
            </View>
            <View style={bookStyles.fallbackDivider} />
            {book.meta.author ? (
              <View style={bookStyles.fallbackAuthorWrap}>
                <Text style={bookStyles.fallbackAuthor} numberOfLines={1}>
                  {book.meta.author}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      )}
    </View>
  );
}

export const GroupCard = memo(function GroupCard({
  group,
  books,
  cardWidth,
  onOpen,
  onLongPress,
}: GroupCardProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const bookStyles = makeBookCardStyles(colors, cardWidth);
  const previewBooks = useMemo(
    () =>
      [...books]
        .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
        .slice(0, 4)
        .reverse(),
    [books],
  );

  return (
    <TouchableOpacity
      style={bookStyles.container}
      activeOpacity={0.76}
      onPress={() => onOpen(group.id)}
      onLongPress={() => onLongPress?.(group)}
      delayLongPress={450}
    >
      <View style={[bookStyles.coverWrap, { backgroundColor: colors.muted }]}>
        {previewBooks.length > 0 ? (
          previewBooks.map((book, index) => (
            <GroupCoverLayer
              key={book.id}
              book={book}
              index={index}
              total={previewBooks.length}
              colors={colors}
              bookStyles={bookStyles}
            />
          ))
        ) : (
          <View style={styles.emptyIcon}>
            <FolderIcon size={40} color={colors.mutedForeground} />
          </View>
        )}
        {onLongPress ? (
          <View style={[bookStyles.moreButtonWrap, styles.moreButtonWrap]} pointerEvents="box-none">
            <TouchableOpacity
              style={bookStyles.moreButton}
              activeOpacity={0.85}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={(event) => {
                event.stopPropagation();
                onLongPress(group);
              }}
            >
              <MoreVerticalIcon size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
      <View style={bookStyles.infoWrap}>
        <Text style={bookStyles.bookTitle} numberOfLines={1}>
          {group.name}
        </Text>
        <Text style={bookStyles.bookAuthor} numberOfLines={1}>
          {t("library.groupBookCount", { count: books.length, defaultValue: `${books.length} 本` })}
        </Text>
        <View style={bookStyles.tagsRow}>
          <View style={bookStyles.newBadge}>
            <Text style={bookStyles.newText}>{t("library.group", "分组")}</Text>
          </View>
        </View>
        <View style={bookStyles.statusRow} />
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  coverLayer: {
    position: "absolute",
    borderRadius: radius.sm,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  coverImage: {
    width: "100%",
    height: "100%",
    borderRadius: radius.sm,
  },
  emptyIcon: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.45,
  },
  moreButtonWrap: {
    zIndex: 80,
    elevation: 12,
  },
});
