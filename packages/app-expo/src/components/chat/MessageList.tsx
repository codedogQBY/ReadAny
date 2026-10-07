import { CheckIcon, ChevronDownIcon, CopyIcon } from "@/components/ui/Icon";
import { fontSize as fs, radius, useColors, withOpacity } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";
import type { CitationPart, MessageV2, QuotePart, TextPart } from "@readany/core/types/message";
import * as Clipboard from "expo-clipboard";
/**
 * MessageList — FlatList message renderer matching app-mobile MessageList.
 * Scroll-to-bottom button, streaming gap indicator.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  Keyboard,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { PartRenderer } from "./PartRenderer";
import { StreamingIndicator } from "./StreamingIndicator";
import { createScrollToBottomController } from "./scroll-to-bottom-controller";

interface MessageListProps {
  messages: MessageV2[];
  isStreaming?: boolean;
  currentStep?: "thinking" | "tool_calling" | "responding" | "idle";
  onCitationClick?: (citation: CitationPart) => void;
}

const BOTTOM_THRESHOLD = 80;

function sortCitationsByIndex(citations: CitationPart[]): CitationPart[] {
  return citations
    .map((citation, order) => ({ citation, order }))
    .sort((a, b) => {
      const aIndex = a.citation.citationIndex;
      const bIndex = b.citation.citationIndex;
      if (typeof aIndex === "number" && typeof bIndex === "number") return aIndex - bIndex;
      if (typeof aIndex === "number") return -1;
      if (typeof bIndex === "number") return 1;
      return a.order - b.order;
    })
    .map(({ citation }) => citation);
}

export function MessageList({
  messages,
  isStreaming,
  currentStep,
  onCitationClick,
}: MessageListProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const s = makeStyles(colors);
  const flatListRef = useRef<FlatList>(null);
  const isAtBottomRef = useRef(true);
  const latestBottomDistanceRef = useRef(0);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const scrollToBottomControllerRef = useRef<
    ReturnType<typeof createScrollToBottomController> | undefined
  >(undefined);
  if (!scrollToBottomControllerRef.current) {
    scrollToBottomControllerRef.current = createScrollToBottomController({
      scrollToEnd: () => flatListRef.current?.scrollToEnd({ animated: false }),
      bottomThreshold: BOTTOM_THRESHOLD,
      maxAttempts: 60,
      onExhausted: () => {
        const nearBottom = latestBottomDistanceRef.current < BOTTOM_THRESHOLD;
        isAtBottomRef.current = nearBottom;
        setShowScrollDown(!nearBottom);
      },
    });
  }
  const scrollToBottomController = scrollToBottomControllerRef.current;

  const lastMsg = messages[messages.length - 1];

  useEffect(() => {
    return () => scrollToBottomController.cancel();
  }, [scrollToBottomController]);

  // Auto-scroll when new messages arrive or parts update
  useEffect(() => {
    if (isAtBottomRef.current && flatListRef.current && messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  // Periodic scroll during streaming
  useEffect(() => {
    if (!isStreaming) return;
    const interval = setInterval(() => {
      if (isAtBottomRef.current) {
        flatListRef.current?.scrollToEnd({ animated: true });
      }
    }, 300);
    return () => clearInterval(interval);
  }, [isStreaming]);

  // Force scroll to bottom when streaming ends
  useEffect(() => {
    if (!isStreaming && flatListRef.current && messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: false });
        isAtBottomRef.current = true;
        setShowScrollDown(false);
      }, 200);
    }
  }, [isStreaming, messages.length]);

  // Listen for keyboard hide events to restore scroll position
  useEffect(() => {
    const keyboardDidHide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardDidHide" : "keyboardDidHide",
      () => {
        // When keyboard hides, ensure we scroll to bottom if we were at bottom
        if (isAtBottomRef.current && flatListRef.current && messages.length > 0) {
          setTimeout(() => {
            flatListRef.current?.scrollToEnd({ animated: false });
          }, 100);
        }
      },
    );

    return () => {
      keyboardDidHide.remove();
    };
  }, [messages.length]);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const distance = contentSize.height - contentOffset.y - layoutMeasurement.height;
      const nearBottom = distance < BOTTOM_THRESHOLD;
      latestBottomDistanceRef.current = distance;
      scrollToBottomController.observeDistance(distance);
      isAtBottomRef.current = nearBottom;
      setShowScrollDown(!nearBottom && !scrollToBottomController.isPending());
    },
    [scrollToBottomController],
  );

  const handleScrollToBottom = useCallback(() => {
    setShowScrollDown(false);
    scrollToBottomController.request();
  }, [scrollToBottomController]);

  const handleContentSizeChange = useCallback(() => {
    scrollToBottomController.contentSizeChanged();
  }, [scrollToBottomController]);

  const [selectModalText, setSelectModalText] = useState<string | null>(null);
  const handleBubbleLongPress = useCallback((text: string) => {
    setSelectModalText(text);
  }, []);

  const renderMessage = useCallback(
    ({ item, index }: { item: MessageV2; index: number }) => {
      const isLastMsg = index === messages.length - 1;
      const isLastMsgStreaming =
        isStreaming && isLastMsg && item.role === "assistant" && item.parts.length > 0;

      return (
        <MessageBubble
          message={item}
          colors={colors}
          isStreaming={isLastMsgStreaming}
          currentStep={currentStep}
          onCitationClick={onCitationClick}
          onLongPress={handleBubbleLongPress}
        />
      );
    },
    [colors, messages.length, isStreaming, currentStep, onCitationClick, handleBubbleLongPress],
  );

  // Show indicator when streaming but no assistant content yet
  const showStreamingIndicator =
    isStreaming &&
    currentStep &&
    currentStep !== "idle" &&
    (!lastMsg || lastMsg.role !== "assistant" || lastMsg.parts.length === 0);

  return (
    <View style={s.container} onTouchStart={Keyboard.dismiss}>
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={s.listContent}
        onScroll={handleScroll}
        onContentSizeChange={handleContentSizeChange}
        onScrollBeginDrag={Keyboard.dismiss}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        removeClippedSubviews={false}
        initialNumToRender={20}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        bounces={true}
        bouncesZoom={false}
        ListFooterComponent={
          showStreamingIndicator && currentStep ? <StreamingIndicator step={currentStep} /> : null
        }
      />

      {/* Scroll to bottom button */}
      {showScrollDown && (
        <View style={s.scrollDownWrap}>
          <TouchableOpacity
            style={s.scrollDownBtn}
            onPress={handleScrollToBottom}
            activeOpacity={0.8}
          >
            <ChevronDownIcon size={14} color={colors.mutedForeground} />
            <Text style={s.scrollDownText}>{t("streaming.scrollToBottom", "滚动到底部")}</Text>
          </TouchableOpacity>
        </View>
      )}

      <SelectableTextModal
        text={selectModalText}
        colors={colors}
        onClose={() => setSelectModalText(null)}
      />
    </View>
  );
}

function UserQuoteBlock({ part, colors }: { part: QuotePart; colors: ThemeColors }) {
  return (
    <View style={quoteStyles(colors).quoteBlock}>
      <View style={{ flex: 1 }}>
        <Text style={quoteStyles(colors).quoteText} numberOfLines={4}>
          {part.text.length > 200 ? `${part.text.slice(0, 200)}...` : part.text}
        </Text>
        {part.source && <Text style={quoteStyles(colors).quoteSource}>— {part.source}</Text>}
      </View>
    </View>
  );
}

const quoteStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    quoteBlock: {
      flexDirection: "row",
      gap: 6,
      borderRadius: radius.md,
      backgroundColor: withOpacity(colors.primary, 0.05),
      borderWidth: 0.5,
      borderColor: withOpacity(colors.primary, 0.15),
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    quoteText: {
      fontSize: fs.xs,
      lineHeight: 16,
      color: colors.foreground,
      opacity: 0.8,
    },
    quoteSource: {
      fontSize: fs.xs - 1,
      color: colors.mutedForeground,
      marginTop: 2,
    },
  });

interface MessageBubbleProps {
  message: MessageV2;
  colors: ThemeColors;
  isStreaming?: boolean;
  currentStep?: "thinking" | "tool_calling" | "responding" | "idle";
  onCitationClick?: (citation: CitationPart) => void;
  onLongPress?: (text: string) => void;
}

function extractPlainText(message: MessageV2): string {
  const parts: string[] = [];
  for (const p of message.parts) {
    if (p.type === "quote") {
      const q = p as QuotePart;
      if (q.text) parts.push(`> ${q.text}`);
    } else if (p.type === "text") {
      const t = p as TextPart;
      if (t.text.trim()) parts.push(t.text);
    } else if (p.type === "reasoning") {
      const r = p as { reasoning?: string };
      if (r.reasoning?.trim()) parts.push(r.reasoning);
    }
  }
  return parts.join("\n\n");
}

function MessageBubble({
  message,
  colors,
  isStreaming,
  currentStep,
  onCitationClick,
  onLongPress,
}: MessageBubbleProps) {
  const s = makeStyles(colors);

  // Extract citations from message parts
  const citations = useMemo(() => {
    return sortCitationsByIndex(
      message.parts.filter((p): p is CitationPart => p.type === "citation"),
    );
  }, [message.parts]);

  const triggerLongPress = useCallback(() => {
    if (!onLongPress) return;
    const text = extractPlainText(message);
    if (text) onLongPress(text);
  }, [message, onLongPress]);

  if (message.role === "user") {
    const quoteParts = message.parts.filter((p) => p.type === "quote") as QuotePart[];
    const textParts = message.parts.filter((p) => p.type === "text") as TextPart[];

    return (
      <View style={s.userRow}>
        <Pressable style={s.userBubble} onLongPress={triggerLongPress} delayLongPress={300}>
          {quoteParts.length > 0 && (
            <View style={{ gap: 4, marginBottom: textParts.length > 0 ? 6 : 0 }}>
              {quoteParts.map((q) => (
                <UserQuoteBlock key={q.id} part={q} colors={colors} />
              ))}
            </View>
          )}
          {textParts.map((part) => (
            <Text key={part.id} style={s.userText}>
              {part.text}
            </Text>
          ))}
        </Pressable>
      </View>
    );
  }

  // Assistant message
  const hasContent = message.parts.some(
    (p) => (p.type === "text" && (p as TextPart).text.trim()) || p.type !== "text",
  );
  if (!hasContent) return null;

  const copyText = () => {
    const text = message.parts
      .filter((p) => p.type === "text" && (p as TextPart).text.trim())
      .map((p) => (p as TextPart).text)
      .join("\n\n");
    if (text) Clipboard.setStringAsync(text);
  };

  // Show gap indicator between parts when streaming
  const lastPart = message.parts[message.parts.length - 1];
  const isLastPartRunningText = lastPart?.type === "text" && lastPart.status === "running";
  const isLastPartActiveToolCall =
    lastPart?.type === "tool_call" &&
    (lastPart.status === "pending" || lastPart.status === "running");
  const isLastPartRunningReasoning =
    lastPart?.type === "reasoning" && lastPart.status === "running";
  const showGapIndicator =
    isStreaming &&
    currentStep !== "idle" &&
    lastPart &&
    !isLastPartRunningText &&
    !isLastPartActiveToolCall &&
    !isLastPartRunningReasoning;

  return (
    <View style={s.assistantRow}>
      <Pressable onLongPress={triggerLongPress} delayLongPress={300}>
        {message.parts.map((part) => (
          <PartRenderer
            key={part.id}
            part={part}
            citations={citations}
            onCitationClick={onCitationClick}
          />
        ))}
      </Pressable>
      {showGapIndicator && <StreamingIndicator step="thinking" />}
      {!isStreaming && <CopyButton onPress={copyText} colors={colors} />}
    </View>
  );
}

function CopyButton({ onPress, colors }: { onPress: () => void; colors: ThemeColors }) {
  const [copied, setCopied] = useState(false);
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => {
        onPress();
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: copied ? `${colors.primary}14` : "transparent",
      }}
    >
      {copied ? (
        <CheckIcon size={13} color={colors.primary} />
      ) : (
        <CopyIcon size={13} color={colors.mutedForeground} />
      )}
    </TouchableOpacity>
  );
}

function SelectableTextModal({
  text,
  colors,
  onClose,
}: {
  text: string | null;
  colors: ThemeColors;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const visible = text !== null;

  useEffect(() => {
    if (!visible) setCopied(false);
  }, [visible]);

  const handleCopyAll = useCallback(() => {
    if (!text) return;
    Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}
        onPress={onClose}
      >
        <Pressable
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 24,
            maxHeight: "75%",
          }}
          onPress={() => {}}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <Text style={{ color: colors.mutedForeground, fontSize: fs.xs }}>
              {t("chat.selectAndCopy", "长按选中文字复制")}
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity
                onPress={handleCopyAll}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: copied ? `${colors.primary}14` : colors.muted,
                }}
              >
                {copied ? (
                  <CheckIcon size={13} color={colors.primary} />
                ) : (
                  <CopyIcon size={13} color={colors.foreground} />
                )}
                <Text style={{ color: colors.foreground, fontSize: fs.xs }}>
                  {t("common.copyAll", "全部复制")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onClose}
                style={{ paddingHorizontal: 8, paddingVertical: 4 }}
              >
                <Text style={{ color: colors.mutedForeground, fontSize: fs.sm }}>
                  {t("common.close", "关闭")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          <TextInput
            value={text ?? ""}
            editable={false}
            multiline
            scrollEnabled
            textAlignVertical="top"
            selectionColor={colors.primary}
            style={{
              color: colors.foreground,
              fontSize: fs.sm,
              lineHeight: 22,
              padding: 12,
              backgroundColor: colors.muted,
              borderRadius: 8,
              minHeight: 200,
              maxHeight: 480,
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1 },
    listContent: { paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
    userRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      marginTop: 16,
    },
    userBubble: {
      maxWidth: "85%",
      backgroundColor: colors.muted,
      borderRadius: radius.xl + 4,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    userText: {
      fontSize: fs.sm,
      lineHeight: 20,
      color: colors.foreground,
    },
    assistantRow: {
      gap: 4,
    },
    scrollDownWrap: {
      position: "absolute",
      bottom: 8,
      left: 0,
      right: 0,
      alignItems: "center",
    },
    scrollDownBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 4,
    },
    scrollDownText: {
      fontSize: fs.xs,
      color: colors.mutedForeground,
    },
  });
