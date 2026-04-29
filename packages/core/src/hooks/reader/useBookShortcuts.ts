/**
 * useBookShortcuts — keyboard shortcuts for the reader.
 *
 * Listens for both main-window keydown events and bridged
 * iframe-keydown messages from iframeEventHandlers.
 */
import { useCallback, useEffect } from "react";
import { shouldIgnoreKeyboardShortcut } from "../../reader/keyboard";
import type { FoliateView } from "./useFoliateView";

interface UseBookShortcutsOptions {
  bookKey: string;
  viewRef: React.RefObject<FoliateView | null>;
  onToggleSearch?: () => void;
  onToggleToc?: () => void;
  onToggleChat?: () => void;
  enabled?: boolean;
}

export function useBookShortcuts({
  bookKey,
  viewRef,
  onToggleSearch,
  onToggleToc,
  onToggleChat: _onToggleChat,
  enabled = true,
}: UseBookShortcutsOptions) {
  const handleAction = useCallback(
    (key: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => {
      const view = viewRef.current;
      if (!view) return;

      const cmd = modifiers.ctrlKey || modifiers.metaKey;

      switch (key) {
        case "ArrowLeft":
          view.goLeft();
          return true;
        case "ArrowRight":
          view.goRight();
          return true;
        case "ArrowUp":
          view.prev();
          return true;
        case "ArrowDown":
        case " ":
          if (modifiers.shiftKey) {
            view.prev();
          } else {
            view.next();
          }
          return true;
        case "[":
          view.prev();
          return true;
        case "]":
          view.next();
          return true;
        case "f":
          if (cmd) {
            onToggleSearch?.();
            return true;
          }
          return false;
        case "t":
          if (cmd) {
            onToggleToc?.();
            return true;
          }
          return false;
        case "=":
        case "+":
          if (cmd) return true;
          return false;
        case "-":
          if (cmd) return true;
          return false;
        default:
          return false;
      }
    },
    [viewRef, onToggleSearch, onToggleToc],
  );

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const onKeydown = (e: KeyboardEvent) => {
      if (shouldIgnoreKeyboardShortcut(e)) return;

      const handled = handleAction(e.key, {
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
      });
      if (handled) e.preventDefault();
    };

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type !== "iframe-keydown" || data.bookKey !== bookKey) return;
      if (
        data.defaultPrevented ||
        data.isComposing ||
        data.key === "Process" ||
        data.keyCode === 229
      ) {
        return;
      }

      handleAction(data.key, {
        ctrlKey: data.ctrlKey,
        metaKey: data.metaKey,
        shiftKey: data.shiftKey,
      });
    };

    window.addEventListener("keydown", onKeydown);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("message", onMessage);
    };
  }, [enabled, bookKey, handleAction]);
}
