/**
 * FloatingTTSBubble — Global floating mini-player shown when TTS is active on desktop.
 *
 * Rendered as a sibling to the main layout in App.tsx so it floats above every screen.
 * Tapping it expands a compact player popover.
 *
 * Design:
 * - Bubble always shows headphones icon
 * - Pulsing ring animation when playing; no animation when paused
 * - Tap bubble → toggle mini player popover
 * - Mini player: book title, chapter, play/pause, rate control, stop, go-to-reader
 * - Draggable via CSS user-select:none + mouse events
 */
import { useTTSStore } from "@/stores/tts-store";
import { useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import { useReaderStore } from "@/stores/reader-store";
import { TTSSleepTimerControl } from "./TTSSleepTimerControl";
import { eventBus } from "@readany/core/utils/event-bus";
import { BookOpen, Headphones, Loader2, Minus, Pause, Play, Plus, ScrollText, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

// ─── Main floating bubble ─────────────────────────────────────────────────────

export function FloatingTTSBubble() {
  const PLAYER_PANEL_WIDTH = 392;
  const { t } = useTranslation();
  const playState = useTTSStore((s) => s.playState);
  const currentBookTitle = useTTSStore((s) => s.currentBookTitle);
  const currentChapterTitle = useTTSStore((s) => s.currentChapterTitle);
  const currentBookId = useTTSStore((s) => s.currentBookId);
  const currentLocationCfi = useTTSStore((s) => s.currentLocationCfi);
  const sleepTimerEndsAt = useTTSStore((s) => s.sleepTimerEndsAt);
  const config = useTTSStore((s) => s.config);
  const pause = useTTSStore((s) => s.pause);
  const resume = useTTSStore((s) => s.resume);
  const stop = useTTSStore((s) => s.stop);
  const updateConfig = useTTSStore((s) => s.updateConfig);

  const addTab = useAppStore((s) => s.addTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const books = useLibraryStore((s) => s.books);
  const goToCfiFn = useReaderStore((s) => s.goToCfiFn);

  const isActive = playState === "playing" || playState === "paused" || playState === "loading";
  const [showPlayer, setShowPlayer] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Close mini player when TTS stops
  useEffect(() => {
    if (!isActive) setShowPlayer(false);
  }, [isActive]);

  useEffect(() => {
    if (!sleepTimerEndsAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sleepTimerEndsAt]);

  // Draggable position
  const [pos, setPos] = useState({ x: 20, y: 120 }); // bottom-right origin
  const [playerPos, setPlayerPos] = useState({ left: 16, top: 16 });
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; initX: number; initY: number }>({
    dragging: false,
    startX: 0,
    startY: 0,
    initX: 0,
    initY: 0,
  });
  const hasDraggedRef = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    hasDraggedRef.current = false;
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      initX: pos.x,
      initY: pos.y,
    };

    const onMove = (me: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      const dx = me.clientX - dragRef.current.startX;
      const dy = me.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasDraggedRef.current = true;
      setPos({
        x: dragRef.current.initX - dx, // right-anchored
        y: dragRef.current.initY - dy, // bottom-anchored
      });
    };

    const onUp = () => {
      dragRef.current.dragging = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [pos]);

  const handleBubbleClick = useCallback(() => {
    if (!hasDraggedRef.current) {
      setShowPlayer((v) => !v);
    }
  }, []);

  const handlePlayPause = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (playState === "playing") pause();
      else if (playState === "paused") resume();
    },
    [playState, pause, resume],
  );

  const handleStop = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      stop();
      setShowPlayer(false);
    },
    [stop],
  );

  const openReaderTab = useCallback(() => {
    if (!currentBookId) return;
    const book = books.find((b) => b.id === currentBookId);
    addTab({
      id: `reader-${currentBookId}`,
      type: "reader",
      title: book?.meta.title ?? "Book",
      bookId: currentBookId,
      initialCfi: currentLocationCfi || undefined,
    });
    setActiveTab(`reader-${currentBookId}`);
    setShowPlayer(false);
  }, [addTab, books, currentBookId, currentLocationCfi, setActiveTab]);

  const handleJumpToCurrentLocation = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!currentBookId) return;
      openReaderTab();
      if (currentLocationCfi) {
        window.setTimeout(() => {
          let handled = false;
          eventBus.emit("tts:jump-to-current", {
            bookId: currentBookId,
            cfi: currentLocationCfi,
            respond: () => {
              handled = true;
            },
          });
          if (!handled && goToCfiFn) {
            goToCfiFn(currentLocationCfi);
          }
        }, 120);
      }
      setShowPlayer(false);
    },
    [currentBookId, currentLocationCfi, goToCfiFn, openReaderTab],
  );

  const handleOpenLyricsPage = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!currentBookId) return;
      openReaderTab();
      window.setTimeout(() => {
        eventBus.emit("tts:open-lyrics-page", { bookId: currentBookId });
      }, 120);
      setShowPlayer(false);
    },
    [currentBookId, openReaderTab],
  );

  const adjustRate = useCallback(
    (e: React.MouseEvent, delta: number) => {
      e.stopPropagation();
      const newRate = Math.round(Math.max(0.5, Math.min(2.0, config.rate + delta)) * 10) / 10;
      updateConfig({ rate: newRate });
    },
    [config.rate, updateConfig],
  );

  const statusText =
    playState === "loading"
      ? t("tts.loading")
      : playState === "playing"
        ? t("tts.playing")
        : playState === "paused"
          ? t("tts.paused")
          : t("tts.stopped");

  const sleepTimerLabel = useMemo(() => {
    void now;
    if (!sleepTimerEndsAt) return null;
    const remainingMs = Math.max(0, sleepTimerEndsAt - Date.now());
    if (remainingMs <= 0) return null;
    const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, [now, sleepTimerEndsAt]);

  const updatePlayerPosition = useCallback(() => {
    const bubbleEl = bubbleRef.current;
    if (!bubbleEl) return;
    const rect = bubbleEl.getBoundingClientRect();
    const panelWidth = Math.min(PLAYER_PANEL_WIDTH, window.innerWidth - 32);
    const panelHeight = playerRef.current?.offsetHeight ?? 176;
    const gap = 12;
    const viewportPadding = 16;
    const clamp = (value: number, min: number, max: number) =>
      Math.min(Math.max(value, min), max);

    const left = clamp(
      rect.left + rect.width / 2 - panelWidth / 2,
      viewportPadding,
      window.innerWidth - panelWidth - viewportPadding,
    );
    const preferAbove = rect.top >= panelHeight + gap + viewportPadding;
    const top = clamp(
      preferAbove ? rect.top - panelHeight - gap : rect.bottom + gap,
      viewportPadding,
      window.innerHeight - panelHeight - viewportPadding,
    );

    setPlayerPos({ left, top });
  }, [PLAYER_PANEL_WIDTH]);

  useEffect(() => {
    if (!showPlayer) return;
    const frame = window.requestAnimationFrame(() => updatePlayerPosition());
    const handleResize = () => updatePlayerPosition();
    window.addEventListener("resize", handleResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
    };
  }, [showPlayer, pos, sleepTimerLabel, currentBookTitle, currentChapterTitle, statusText, currentBookId, updatePlayerPosition]);

  if (!isActive) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[9999]"
      aria-hidden="true"
    >
      {/* ── Bubble ── */}
      <div
        className="pointer-events-auto absolute"
        style={{ right: pos.x, bottom: pos.y }}
        onMouseDown={handleMouseDown}
        ref={bubbleRef}
      >
        {/* Ripple rings — playing only */}
        {playState === "playing" && (
          <>
            <span className="bubble-ring absolute inset-0 rounded-full bg-primary opacity-0 animate-bubble-ring" />
            <span className="bubble-ring-2 absolute inset-0 rounded-full bg-primary opacity-0 animate-bubble-ring-2" />
          </>
        )}

        {/* Main button */}
        <button
          type="button"
          onClick={handleBubbleClick}
          className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform active:scale-95 select-none"
          aria-label={t("tts.player")}
          title={t("tts.player")}
        >
          {playState === "loading" ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <Headphones className="h-6 w-6" />
          )}
        </button>

      </div>

      {/* ── Mini player popover ── */}
      {showPlayer && (
        <div
          ref={playerRef}
          className="pointer-events-auto fixed z-[10000] inline-flex w-[24.5rem] max-w-[calc(100vw-1.5rem)] flex-col rounded-2xl border bg-card shadow-2xl"
          style={{ left: playerPos.left, top: playerPos.top }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2.5 px-4 py-3.5">
            <Headphones className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {currentBookTitle || t("tts.listeningToBook")}
              </p>
              {!!currentChapterTitle && (
                <p className="truncate text-xs text-muted-foreground">{currentChapterTitle}</p>
              )}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{statusText}</span>
          </div>

          <div className="mx-4 border-t" />

          <div className="flex items-center gap-3 px-4 py-3">
            <button
              type="button"
              onClick={(e) => adjustRate(e, -0.1)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/80 text-foreground transition-colors hover:bg-muted"
              aria-label={t("tts.decreaseRate")}
              title={t("tts.decreaseRate")}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-9 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
              {config.rate.toFixed(1)}x
            </span>
            <button
              type="button"
              onClick={(e) => adjustRate(e, 0.1)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/80 text-foreground transition-colors hover:bg-muted"
              aria-label={t("tts.increaseRate")}
              title={t("tts.increaseRate")}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={handlePlayPause}
              disabled={playState === "loading"}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              aria-label={playState === "playing" ? t("tts.pause") : t("tts.play")}
              title={playState === "playing" ? t("tts.pause") : t("tts.play")}
            >
              {playState === "loading" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : playState === "playing" ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5" />
              )}
            </button>

            <button
              type="button"
              onClick={handleStop}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/80 text-foreground transition-colors hover:bg-muted"
              aria-label={t("tts.stop")}
              title={t("tts.stop")}
            >
              <Square className="h-3.5 w-3.5" />
            </button>

            {!!currentBookId && (
              <button
                type="button"
                onClick={handleJumpToCurrentLocation}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/80 text-foreground transition-colors hover:bg-muted"
                aria-label={t("tts.jumpToCurrentLocation")}
                title={t("tts.jumpToCurrentLocation")}
              >
                <BookOpen className="h-3.5 w-3.5" />
              </button>
            )}

            {!!currentBookId && (
              <button
                type="button"
                onClick={handleOpenLyricsPage}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/80 text-foreground transition-colors hover:bg-muted"
                aria-label={t("tts.openLyricsPage", "跳到歌词页")}
                title={t("tts.openLyricsPage", "跳到歌词页")}
              >
                <ScrollText className="h-3.5 w-3.5" />
              </button>
            )}

            <TTSSleepTimerControl compact />

            <div className="ml-auto mr-1 flex shrink-0 items-center gap-2">
              {sleepTimerLabel ? (
                <span className="min-w-[44px] text-right text-[11px] font-semibold tabular-nums text-primary">
                  {sleepTimerLabel}
                </span>
              ) : null}
            </div>

          </div>
        </div>
      )}

      <style>{`
        @keyframes bubbleRing {
          0% { transform: scale(1); opacity: 0.35; }
          100% { transform: scale(2); opacity: 0; }
        }
        .animate-bubble-ring {
          animation: bubbleRing 1.6s ease-out infinite;
        }
        .animate-bubble-ring-2 {
          animation: bubbleRing 1.6s ease-out 0.7s infinite;
        }
      `}</style>
    </div>
  );
}
