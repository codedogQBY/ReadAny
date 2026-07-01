import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import {
  BoldIcon,
  CodeIcon,
  EditIcon,
  EyeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  Link2Icon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  StrikethroughIcon,
  XIcon,
} from "@/components/ui/Icon";
import { radius, useColors } from "@/styles/theme";
import {
  type KnowledgeEditorFeature,
  type KnowledgeEditorSurface,
  type KnowledgeEditorTier,
  getKnowledgeEditorProfile,
  getKnowledgeEditorSurfaceProfile,
  hasKnowledgeEditorFeature,
} from "@readany/core/knowledge";
import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

interface RichTextEditorProps {
  initialContent?: string;
  onChange?: (markdown: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  tier?: KnowledgeEditorTier;
  surface?: KnowledgeEditorSurface;
}

export function RichTextEditor({
  initialContent = "",
  onChange,
  placeholder,
  autoFocus = false,
  tier = "inline_note",
  surface,
}: RichTextEditorProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const defaultPlaceholder = placeholder ?? t("common.writeYourThoughts", "写下你的想法...");
  const [value, setValue] = useState(initialContent);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const editorProfile = useMemo(
    () => (surface ? getKnowledgeEditorSurfaceProfile(surface) : getKnowledgeEditorProfile(tier)),
    [surface, tier],
  );
  const canUse = useCallback(
    (feature: KnowledgeEditorFeature) => hasKnowledgeEditorFeature(editorProfile, feature),
    [editorProfile],
  );
  const selectionRef = useRef<{ start: number; end: number }>({
    start: initialContent.length,
    end: initialContent.length,
  });

  const handleChange = useCallback(
    (text: string) => {
      setValue(text);
      onChange?.(text);
    },
    [onChange],
  );

  const handleSelectionChange = useCallback(
    (e: { nativeEvent: { selection: { start: number; end: number } } }) => {
      selectionRef.current = e.nativeEvent.selection;
    },
    [],
  );

  const wrapSelection = useCallback(
    (prefix: string, suffix: string) => {
      const { start, end } = selectionRef.current;
      const selected = value.substring(start, end);
      const newText = value.substring(0, start) + prefix + selected + suffix + value.substring(end);
      handleChange(newText);
      const newPos = start + prefix.length + selected.length + suffix.length;
      selectionRef.current = { start: newPos, end: newPos };
    },
    [value, handleChange],
  );

  const insertAtLineStart = useCallback(
    (prefix: string) => {
      const { start } = selectionRef.current;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const lineEnd = value.indexOf("\n", start);
      const actualEnd = lineEnd === -1 ? value.length : lineEnd;
      const currentLine = value.substring(lineStart, actualEnd);

      if (currentLine.startsWith(prefix)) {
        const newText =
          value.substring(0, lineStart) +
          currentLine.substring(prefix.length) +
          value.substring(actualEnd);
        handleChange(newText);
        return;
      }

      const stripped = currentLine.replace(/^(#{1,3}\s|[-*]\s|\d+\.\s|>\s)/, "");
      const newText =
        value.substring(0, lineStart) + prefix + stripped + value.substring(actualEnd);
      handleChange(newText);
    },
    [value, handleChange],
  );

  const handleBold = useCallback(() => wrapSelection("**", "**"), [wrapSelection]);
  const handleItalic = useCallback(() => wrapSelection("*", "*"), [wrapSelection]);
  const handleStrikethrough = useCallback(() => wrapSelection("~~", "~~"), [wrapSelection]);
  const handleCode = useCallback(() => wrapSelection("`", "`"), [wrapSelection]);
  const handleH1 = useCallback(() => insertAtLineStart("# "), [insertAtLineStart]);
  const handleH2 = useCallback(() => insertAtLineStart("## "), [insertAtLineStart]);
  const handleH3 = useCallback(() => insertAtLineStart("### "), [insertAtLineStart]);
  const handleBulletList = useCallback(() => insertAtLineStart("- "), [insertAtLineStart]);
  const handleOrderedList = useCallback(() => insertAtLineStart("1. "), [insertAtLineStart]);
  const handleQuote = useCallback(() => insertAtLineStart("> "), [insertAtLineStart]);

  const openLinkModal = useCallback(() => {
    const { start, end } = selectionRef.current;
    const selected = value.substring(start, end);
    setLinkText(selected);
    setLinkUrl("");
    setShowLinkModal(true);
  }, [value]);

  const handleInsertLink = useCallback(() => {
    const url = linkUrl.trim();
    if (!url) {
      setShowLinkModal(false);
      return;
    }
    const text = linkText.trim() || url;
    const { start, end } = selectionRef.current;
    const markdown = `[${text}](${url})`;
    const newText = value.substring(0, start) + markdown + value.substring(end);
    handleChange(newText);
    setShowLinkModal(false);
    setLinkUrl("");
    setLinkText("");
  }, [linkUrl, linkText, value, handleChange]);

  const styles = makeStyles(colors);
  const toolbarGroupCandidates: ({ key: string; node: React.ReactNode } | null)[] = [
    canUse("heading1") || canUse("heading2") || canUse("heading3")
      ? {
          key: "headings",
          node: (
            <View style={styles.toolbarGroup}>
              {canUse("heading1") ? (
                <ToolbarButton onPress={handleH1} styles={styles}>
                  <Heading1Icon size={16} color={colors.mutedForeground} />
                </ToolbarButton>
              ) : null}
              {canUse("heading2") ? (
                <ToolbarButton onPress={handleH2} styles={styles}>
                  <Heading2Icon size={16} color={colors.mutedForeground} />
                </ToolbarButton>
              ) : null}
              {canUse("heading3") ? (
                <ToolbarButton onPress={handleH3} styles={styles}>
                  <Heading3Icon size={16} color={colors.mutedForeground} />
                </ToolbarButton>
              ) : null}
            </View>
          ),
        }
      : null,
    {
      key: "inline",
      node: (
        <View style={styles.toolbarGroup}>
          {canUse("bold") ? (
            <ToolbarButton onPress={handleBold} styles={styles}>
              <BoldIcon size={16} color={colors.mutedForeground} />
            </ToolbarButton>
          ) : null}
          {canUse("italic") ? (
            <ToolbarButton onPress={handleItalic} styles={styles}>
              <ItalicIcon size={16} color={colors.mutedForeground} />
            </ToolbarButton>
          ) : null}
          {canUse("strike") ? (
            <ToolbarButton onPress={handleStrikethrough} styles={styles}>
              <StrikethroughIcon size={16} color={colors.mutedForeground} />
            </ToolbarButton>
          ) : null}
          {canUse("inlineCode") ? (
            <ToolbarButton onPress={handleCode} styles={styles}>
              <CodeIcon size={16} color={colors.mutedForeground} />
            </ToolbarButton>
          ) : null}
          {canUse("link") ? (
            <ToolbarButton onPress={openLinkModal} styles={styles}>
              <Link2Icon size={16} color={colors.mutedForeground} />
            </ToolbarButton>
          ) : null}
        </View>
      ),
    },
    canUse("bulletList") || canUse("orderedList") || canUse("blockquote")
      ? {
          key: "blocks",
          node: (
            <View style={styles.toolbarGroup}>
              {canUse("bulletList") ? (
                <ToolbarButton onPress={handleBulletList} styles={styles}>
                  <ListIcon size={16} color={colors.mutedForeground} />
                </ToolbarButton>
              ) : null}
              {canUse("orderedList") ? (
                <ToolbarButton onPress={handleOrderedList} styles={styles}>
                  <ListOrderedIcon size={16} color={colors.mutedForeground} />
                </ToolbarButton>
              ) : null}
              {canUse("blockquote") ? (
                <ToolbarButton onPress={handleQuote} styles={styles}>
                  <QuoteIcon size={16} color={colors.mutedForeground} />
                </ToolbarButton>
              ) : null}
            </View>
          ),
        }
      : null,
  ];
  const toolbarGroups = toolbarGroupCandidates.filter(
    (group): group is { key: string; node: React.ReactNode } => group !== null,
  );

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.toolbarContent}
        style={styles.toolbar}
      >
        <View style={styles.toolbarGroup}>
          <ToolbarButton
            onPress={() => setPreviewMode(!previewMode)}
            isActive={previewMode}
            styles={styles}
          >
            {previewMode ? (
              <EditIcon size={16} color={previewMode ? colors.primary : colors.mutedForeground} />
            ) : (
              <EyeIcon size={16} color={colors.mutedForeground} />
            )}
          </ToolbarButton>
        </View>

        {!previewMode &&
          toolbarGroups.map((group) => (
            <Fragment key={group.key}>
              <View style={styles.toolbarDivider} />
              {group.node}
            </Fragment>
          ))}
      </ScrollView>

      {previewMode ? (
        <ScrollView
          style={[
            styles.previewWrapper,
            { borderColor: colors.border, backgroundColor: colors.background },
          ]}
          contentContainerStyle={styles.previewContent}
        >
          {value.trim() ? (
            <MarkdownRenderer content={value} />
          ) : (
            <Text style={[styles.previewPlaceholder, { color: colors.mutedForeground }]}>
              {defaultPlaceholder}
            </Text>
          )}
        </ScrollView>
      ) : (
        <View
          style={[
            styles.editorWrapper,
            { borderColor: colors.border, backgroundColor: colors.background },
          ]}
        >
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={handleChange}
            onSelectionChange={handleSelectionChange}
            placeholder={defaultPlaceholder}
            placeholderTextColor={colors.mutedForeground}
            autoFocus={autoFocus}
            multiline
            textAlignVertical="top"
            contextMenuHidden
            style={[styles.editor, { color: colors.foreground }]}
          />
        </View>
      )}

      <Modal
        visible={showLinkModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLinkModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.linkModal}>
            <View style={styles.linkModalHeader}>
              <Text style={styles.linkModalTitle}>{t("common.insertLink", "插入链接")}</Text>
              <TouchableOpacity onPress={() => setShowLinkModal(false)}>
                <XIcon size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.linkInput}
              value={linkText}
              onChangeText={setLinkText}
              placeholder={t("common.linkText", "链接文字")}
              placeholderTextColor={colors.mutedForeground}
            />
            <TextInput
              style={styles.linkInput}
              value={linkUrl}
              onChangeText={setLinkUrl}
              placeholder={t("common.enterLinkUrl", "输入链接地址")}
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <View style={styles.linkModalActions}>
              <TouchableOpacity
                style={styles.linkCancelBtn}
                onPress={() => setShowLinkModal(false)}
              >
                <Text style={styles.linkCancelText}>{t("common.cancel", "取消")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.linkConfirmBtn} onPress={handleInsertLink}>
                <Text style={styles.linkConfirmText}>{t("common.confirm", "确定")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

interface ToolbarButtonProps {
  onPress: () => void;
  isActive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
}

function ToolbarButton({ onPress, isActive, disabled, children, styles }: ToolbarButtonProps) {
  return (
    <TouchableOpacity
      style={[
        styles.toolbarButton,
        isActive && styles.toolbarButtonActive,
        disabled && styles.toolbarButtonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      {children}
    </TouchableOpacity>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    toolbar: {
      maxHeight: 44,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.muted,
    },
    toolbarContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 8,
      paddingVertical: 6,
      gap: 2,
    },
    toolbarGroup: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
    },
    toolbarButton: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    toolbarButtonActive: {
      backgroundColor: `${colors.primary}20`,
    },
    toolbarButtonDisabled: {
      opacity: 0.3,
    },
    toolbarDivider: {
      width: 1,
      height: 20,
      backgroundColor: colors.border,
      marginHorizontal: 6,
    },
    editorWrapper: {
      flex: 1,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.lg,
      overflow: "hidden",
    },
    editor: {
      flex: 1,
      fontSize: 15,
      lineHeight: 24,
      padding: 12,
      textAlignVertical: "top",
    },
    previewWrapper: {
      flex: 1,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.lg,
      overflow: "hidden",
    },
    previewContent: {
      padding: 12,
    },
    previewPlaceholder: {
      fontSize: 15,
      lineHeight: 24,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      alignItems: "center",
      justifyContent: "center",
    },
    linkModal: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: 16,
      width: "85%",
      maxWidth: 320,
    },
    linkModalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    linkModalTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.foreground,
    },
    linkInput: {
      backgroundColor: colors.muted,
      borderRadius: radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.foreground,
      marginBottom: 12,
    },
    linkModalActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 8,
      marginTop: 4,
    },
    linkCancelBtn: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: radius.sm,
    },
    linkCancelText: {
      color: colors.mutedForeground,
      fontSize: 15,
    },
    linkConfirmBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: radius.sm,
    },
    linkConfirmText: {
      color: colors.primaryForeground,
      fontSize: 15,
      fontWeight: "500",
    },
  });
