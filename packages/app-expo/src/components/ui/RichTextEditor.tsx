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
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
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
}

export function RichTextEditor({
  initialContent = "",
  onChange,
  placeholder,
  autoFocus = false,
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
            colors={colors}
            styles={styles}
          >
            {previewMode ? (
              <EditIcon size={16} color={previewMode ? colors.primary : colors.mutedForeground} />
            ) : (
              <EyeIcon size={16} color={colors.mutedForeground} />
            )}
          </ToolbarButton>
        </View>

        {!previewMode && (
          <>
            <View style={styles.toolbarDivider} />

            <View style={styles.toolbarGroup}>
              <ToolbarButton onPress={handleH1} colors={colors} styles={styles}>
                <Heading1Icon size={16} color={colors.mutedForeground} />
              </ToolbarButton>
              <ToolbarButton onPress={handleH2} colors={colors} styles={styles}>
                <Heading2Icon size={16} color={colors.mutedForeground} />
              </ToolbarButton>
              <ToolbarButton onPress={handleH3} colors={colors} styles={styles}>
                <Heading3Icon size={16} color={colors.mutedForeground} />
              </ToolbarButton>
            </View>

            <View style={styles.toolbarDivider} />

            <View style={styles.toolbarGroup}>
              <ToolbarButton onPress={handleBold} colors={colors} styles={styles}>
                <BoldIcon size={16} color={colors.mutedForeground} />
              </ToolbarButton>
              <ToolbarButton onPress={handleItalic} colors={colors} styles={styles}>
                <ItalicIcon size={16} color={colors.mutedForeground} />
              </ToolbarButton>
              <ToolbarButton onPress={handleStrikethrough} colors={colors} styles={styles}>
                <StrikethroughIcon size={16} color={colors.mutedForeground} />
              </ToolbarButton>
              <ToolbarButton onPress={handleCode} colors={colors} styles={styles}>
                <CodeIcon size={16} color={colors.mutedForeground} />
              </ToolbarButton>
              <ToolbarButton onPress={openLinkModal} colors={colors} styles={styles}>
                <Link2Icon size={16} color={colors.mutedForeground} />
              </ToolbarButton>
            </View>

            <View style={styles.toolbarDivider} />

            <View style={styles.toolbarGroup}>
              <ToolbarButton onPress={handleBulletList} colors={colors} styles={styles}>
                <ListIcon size={16} color={colors.mutedForeground} />
              </ToolbarButton>
              <ToolbarButton onPress={handleOrderedList} colors={colors} styles={styles}>
                <ListOrderedIcon size={16} color={colors.mutedForeground} />
              </ToolbarButton>
              <ToolbarButton onPress={handleQuote} colors={colors} styles={styles}>
                <QuoteIcon size={16} color={colors.mutedForeground} />
              </ToolbarButton>
            </View>
          </>
        )}
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
              {placeholder}
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
            placeholder={placeholder}
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
        <KeyboardAvoidingView
          style={styles.modalKeyboardRoot}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
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
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

interface ToolbarButtonProps {
  onPress: () => void;
  isActive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
}

function ToolbarButton({
  onPress,
  isActive,
  disabled,
  children,
  colors,
  styles,
}: ToolbarButtonProps) {
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
      backgroundColor: colors.primary + "20",
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
    modalKeyboardRoot: { flex: 1 },
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
