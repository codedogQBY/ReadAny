import { BrainIcon, EyeOffIcon, SendIcon, StopCircleIcon, XIcon } from "@/components/ui/Icon";
import { useKeyboardInsets } from "@/hooks/use-keyboard-insets";
import { fontSize as fs, radius, useColors, withOpacity } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";
import type { AttachedQuote } from "@readany/core/types";
/**
 * ChatInput — touch-optimized chat input matching app-mobile MobileChatInput.
 * Rounded container with textarea on top, action bar (deep thinking + send) below.
 */
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  type TextInputContentSizeChangeEvent,
  TouchableOpacity,
  View,
} from "react-native";

interface ChatInputProps {
  onSend: (
    text: string,
    deepThinking: boolean,
    spoilerFree: boolean,
    quotes?: AttachedQuote[],
  ) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  quotes?: AttachedQuote[];
  onRemoveQuote?: (id: string) => void;
  placeholder?: string;
}

const SINGLE_LINE_INPUT_HEIGHT = 46;
const MAX_INPUT_HEIGHT = 112;
const INPUT_PADDING_VERTICAL = 16;

export function ChatInput({
  onSend,
  onStop,
  isStreaming,
  quotes = [],
  onRemoveQuote,
  placeholder,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [deepThinking, setDeepThinking] = useState(false);
  const [spoilerFree, setSpoilerFree] = useState(false);
  const [inputHeight, setInputHeight] = useState(SINGLE_LINE_INPUT_HEIGHT);
  const { t } = useTranslation();
  const colors = useColors();
  const s = makeStyles(colors);
  const inputRef = useRef<TextInput>(null);
  const keyboardInsets = useKeyboardInsets();
  const bottomPadding =
    Platform.OS === "ios" && keyboardInsets.isVisible
      ? keyboardInsets.bottomInset + 8
      : Math.max(4, Math.min(keyboardInsets.safeAreaBottom, 8));

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && quotes.length === 0) return;
    inputRef.current?.blur();
    onSend(trimmed, deepThinking, spoilerFree, quotes.length > 0 ? quotes : undefined);
    setInputHeight(SINGLE_LINE_INPUT_HEIGHT);
    setText("");
    setDeepThinking(false);
    setSpoilerFree(false);
  }, [text, deepThinking, spoilerFree, quotes, onSend]);

  const handleTextChange = useCallback((nextText: string) => {
    setText(nextText);
    if (!nextText) {
      setInputHeight(SINGLE_LINE_INPUT_HEIGHT);
    }
  }, []);

  const handleContentSizeChange = useCallback(
    (e: TextInputContentSizeChangeEvent) => {
      if (!text) {
        setInputHeight(SINGLE_LINE_INPUT_HEIGHT);
        return;
      }
      const contentHeight = e.nativeEvent.contentSize.height;
      const totalHeight = contentHeight + INPUT_PADDING_VERTICAL;
      const h = Math.min(totalHeight, MAX_INPUT_HEIGHT);
      setInputHeight(Math.max(SINGLE_LINE_INPUT_HEIGHT, h));
    },
    [text],
  );

  const canSend = text.trim().length > 0 || quotes.length > 0;

  return (
    <View style={[s.wrapper, { paddingBottom: bottomPadding }]}>
      <View style={s.container}>
        {/* Attached quotes chips */}
        {quotes.length > 0 && (
          <View style={s.quotesRow}>
            {quotes.map((q) => (
              <View key={q.id} style={s.quoteChip}>
                <Text style={s.quoteChipText} numberOfLines={1}>
                  {q.text.slice(0, 40)}
                </Text>
                <TouchableOpacity
                  onPress={() => onRemoveQuote?.(q.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <XIcon size={10} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Input area */}
        <TextInput
          ref={inputRef}
          style={[s.input, { height: inputHeight }]}
          placeholder={
            quotes.length > 0
              ? t("chat.askAboutQuote", "关于引用提问...")
              : placeholder || t("chat.inputPlaceholder", "输入消息...")
          }
          placeholderTextColor={colors.mutedForeground}
          value={text}
          onChangeText={handleTextChange}
          multiline
          onContentSizeChange={handleContentSizeChange}
          returnKeyType="default"
          blurOnSubmit={false}
          editable={!isStreaming}
        />

        {/* Action bar: deep thinking toggle + spoiler-free toggle + send */}
        <View style={s.actionBar}>
          <View style={s.toggleRow}>
            <TouchableOpacity
              style={[s.deepThinkBtn, deepThinking && s.deepThinkBtnActive]}
              onPress={() => setDeepThinking(!deepThinking)}
              activeOpacity={0.7}
            >
              <BrainIcon size={13} color={deepThinking ? colors.primary : colors.mutedForeground} />
              <Text style={[s.deepThinkText, deepThinking && s.deepThinkTextActive]}>
                {t("chat.deepThinking", "深度思考")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.deepThinkBtn, spoilerFree && s.deepThinkBtnActive]}
              onPress={() => setSpoilerFree(!spoilerFree)}
              activeOpacity={0.7}
            >
              <EyeOffIcon size={13} color={spoilerFree ? colors.primary : colors.mutedForeground} />
              <Text style={[s.deepThinkText, spoilerFree && s.deepThinkTextActive]}>
                {t("chat.spoilerFree", "防剧透")}
              </Text>
            </TouchableOpacity>
          </View>

          {isStreaming ? (
            <TouchableOpacity style={s.sendBtn} onPress={onStop} activeOpacity={0.7}>
              <StopCircleIcon size={16} color={colors.destructive} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[s.sendBtn, canSend && s.sendBtnActive]}
              onPress={handleSend}
              disabled={!canSend}
              activeOpacity={0.7}
            >
              <SendIcon
                size={14}
                color={canSend ? colors.primaryForeground : colors.mutedForeground}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>
      {deepThinking && (
        <Text style={s.deepThinkHint}>
          {t("chat.deepThinkingHint", "深度思考模式会使用更多 tokens")}
        </Text>
      )}
      {spoilerFree && (
        <Text style={s.deepThinkHint}>
          {t("chat.spoilerFreeHint", "AI 将避免透露当前阅读进度之后的内容")}
        </Text>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrapper: {
      paddingHorizontal: 12,
      paddingTop: 4,
      paddingBottom: 4,
    },
    container: {
      borderRadius: radius.xl + 4,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      shadowColor: colors.foreground,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 6,
      elevation: 2,
    },
    quotesRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      paddingHorizontal: 12,
      paddingTop: 10,
    },
    quoteChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: "rgba(99,102,241,0.06)",
      borderWidth: 0.5,
      borderColor: "rgba(99,102,241,0.2)",
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.md,
      flex: 1,
    },
    quoteChipText: {
      fontSize: fs.xs,
      color: colors.primary,
      flex: 1,
    },
    input: {
      fontSize: fs.sm,
      color: colors.foreground,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 6,
      minHeight: SINGLE_LINE_INPUT_HEIGHT,
      maxHeight: MAX_INPUT_HEIGHT,
      lineHeight: 20,
      textAlignVertical: "top",
    },
    actionBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 12,
      paddingBottom: 9,
      minHeight: 36,
    },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    deepThinkBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    deepThinkBtnActive: {
      borderColor: withOpacity(colors.primary, 0.5),
      backgroundColor: withOpacity(colors.primary, 0.1),
    },
    deepThinkText: {
      fontSize: fs.xs,
      color: colors.mutedForeground,
    },
    deepThinkTextActive: {
      color: colors.primary,
    },
    sendBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    sendBtnActive: {
      borderColor: withOpacity(colors.primary, 0.35),
      backgroundColor: colors.primary,
    },
    deepThinkHint: {
      fontSize: fs.xs,
      color: colors.mutedForeground,
      textAlign: "center",
      marginTop: 6,
    },
  });
