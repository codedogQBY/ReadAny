/**
 * Recursive TOC (Table of Contents) tree item component.
 */
import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { ChevronDownIcon, ChevronRightIcon } from "@/components/ui/Icon";
import { type ThemeColors, fontSize, fontWeight, radius, useColors } from "@/styles/theme";
import { getFirstTocHref } from "@readany/core/reader";
import type { TOCItem } from "@readany/core/types";

export function TOCTreeItem({
  item,
  level,
  currentChapter,
  onSelect,
}: {
  item: TOCItem;
  level: number;
  currentChapter: string;
  onSelect: (href: string) => void;
}) {
  const colors = useColors();
  const tocS = makeTocStyles(colors);
  const children = item.subitems ?? [];
  const hasChildren = children.length > 0;
  const targetHref = getFirstTocHref(item);
  const isCurrent = item.title === currentChapter;
  const hasCurrentChild = (items: TOCItem[]): boolean => {
    for (const child of items) {
      if (child.title === currentChapter) return true;
      if (child.subitems && hasCurrentChild(child.subitems)) return true;
    }
    return false;
  };
  const shouldExpand = hasChildren && hasCurrentChild(children);
  const [expanded, setExpanded] = useState(shouldExpand);
  const handlePress = () => {
    if (targetHref) {
      onSelect(targetHref);
      return;
    }

    if (hasChildren) setExpanded((value) => !value);
  };

  return (
    <View>
      <TouchableOpacity
        style={[tocS.item, { paddingLeft: 12 + level * 16 }, isCurrent && tocS.itemActive]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        {hasChildren ? (
          <TouchableOpacity
            style={tocS.expandBtn}
            onPress={() => setExpanded((value) => !value)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {expanded ? (
              <ChevronDownIcon size={14} color={colors.mutedForeground} />
            ) : (
              <ChevronRightIcon size={14} color={colors.mutedForeground} />
            )}
          </TouchableOpacity>
        ) : (
          <View style={tocS.expandPlaceholder} />
        )}
        <Text style={[tocS.itemText, isCurrent && tocS.itemTextActive]} numberOfLines={1}>
          {item.title}
        </Text>
      </TouchableOpacity>
      {expanded && hasChildren && (
        <View>
          {children.map((child) => (
            <TOCTreeItem
              key={child.id || child.href}
              item={child}
              level={level + 1}
              currentChapter={currentChapter}
              onSelect={onSelect}
            />
          ))}
        </View>
      )}
    </View>
  );
}

export const makeTocStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    item: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 10,
      paddingRight: 12,
      borderRadius: radius.lg,
    },
    itemActive: { backgroundColor: `${colors.primary}18` },
    expandBtn: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
    expandPlaceholder: { width: 20 },
    itemText: { fontSize: fontSize.sm, color: colors.foreground, flex: 1 },
    itemTextActive: { color: colors.primary, fontWeight: fontWeight.medium },
  });
