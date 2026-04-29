/**
 * SocraticReaderWrapper - 苏格拉底模式阅读器包装组件
 *
 * 功能：
 * - 在书籍打开前检测是否需要显示预热对话框
 * - 根据预热策略（自动/手动/智能）决定显示时机
 * - 处理预热完成/跳过的逻辑
 */

import { PreheatingDialog } from "@/components/chat/PreheatingDialog";
import { ReaderView } from "@/components/reader/ReaderView";
import { useLibraryStore } from "@/stores/library-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { Book } from "@readany/core/types";
import { useCallback, useEffect, useState } from "react";

interface SocraticReaderWrapperProps {
  bookId: string;
}

export function SocraticReaderWrapper({ bookId }: SocraticReaderWrapperProps) {
  const aiConfig = useSettingsStore((s) => s.aiConfig);
  const socraticSettings = aiConfig.socraticSettings || {
    enabled: false,
    mode: "socratic" as const,
    knowledgeScope: "current_chapter" as const,
    questionComplexity: "medium" as const,
    enablePreheating: true,
    preheatingStrategy: "smart" as const,
    enableWebSearch: false,
  };
  const books = useLibraryStore((s) => s.books);
  const book = books.find((b: Book) => b.id === bookId);

  console.log("[SocraticReaderWrapper] Rendering:", {
    bookId,
    bookFound: !!book,
    booksCount: books.length,
  });

  const [showPreheatingDialog, setShowPreheatingDialog] = useState(false);
  const [hasShownDialog, setHasShownDialog] = useState(false);
  const [showChat, setShowChat] = useState(false);

  const isSocraticEnabled = aiConfig.chatMode === "socratic";

  console.log("[SocraticReaderWrapper] State check:", {
    chatMode: aiConfig.chatMode,
    socraticEnabled: socraticSettings.enabled,
    isSocraticEnabled,
    enablePreheating: socraticSettings.enablePreheating,
    preheatingStrategy: socraticSettings.preheatingStrategy,
  });

  useEffect(() => {
    console.log("[SocraticReaderWrapper] Effect running:", {
      isSocraticEnabled,
      hasShownDialog,
      enablePreheating: socraticSettings.enablePreheating,
      preheatingStrategy: socraticSettings.preheatingStrategy,
    });

    if (!isSocraticEnabled) {
      console.log("[SocraticReaderWrapper] Not socratic mode, hiding dialog");
      setShowPreheatingDialog(false);
      setHasShownDialog(false);
      return;
    }

    if (!socraticSettings.enablePreheating) {
      console.log("[SocraticReaderWrapper] Preheating disabled, hiding dialog");
      return;
    }

    if (hasShownDialog) {
      console.log("[SocraticReaderWrapper] Dialog already shown, skipping");
      return;
    }

    const shouldAutoShow =
      socraticSettings.preheatingStrategy === "auto" ||
      socraticSettings.preheatingStrategy === "smart";

    console.log("[SocraticReaderWrapper] shouldAutoShow:", shouldAutoShow);

    if (shouldAutoShow) {
      console.log("[SocraticReaderWrapper] Showing preheating dialog");
      setShowPreheatingDialog(true);
    }
  }, [isSocraticEnabled, socraticSettings, hasShownDialog]);

  const handleStartPreheating = useCallback(() => {
    setShowPreheatingDialog(false);
    setHasShownDialog(true);
    setShowChat(true);
    sessionStorage.setItem(`preheating-start-${bookId}`, "true");
  }, [bookId]);

  const handleSkipPreheating = useCallback(() => {
    setShowPreheatingDialog(false);
    setHasShownDialog(true);
  }, []);

  const handleCloseDialog = useCallback(() => {
    setShowPreheatingDialog(false);
    setHasShownDialog(true);
  }, []);

  if (!book) {
    return null;
  }

  return (
    <>
      <ReaderView
        key={`chat-${showChat}`}
        bookId={bookId}
        tabId={`reader-${bookId}`}
        initialShowChat={showChat}
      />
      <PreheatingDialog
        open={showPreheatingDialog && isSocraticEnabled}
        book={book}
        onStartPreheating={handleStartPreheating}
        onSkipPreheating={handleSkipPreheating}
        onClose={handleCloseDialog}
      />
    </>
  );
}
