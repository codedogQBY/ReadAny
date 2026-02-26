import { DEFAULT_BINDINGS, type KeyBinding, findAction } from "@/lib/reader/keyboard";
/**
 * useKeyboard — keyboard shortcut registration with tab isolation + input filtering
 */
import { useCallback, useEffect } from "react";

type ActionHandler = (action: string) => void;

interface UseKeyboardOptions {
  bindings?: KeyBinding[];
  enabled?: boolean;
}

export function useKeyboard(onAction: ActionHandler, options: UseKeyboardOptions = {}) {
  const { bindings = DEFAULT_BINDINGS, enabled = true } = options;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      const action = findAction(event, bindings);
      if (action) {
        event.preventDefault();
        onAction(action);
      }
    },
    [enabled, bindings, onAction],
  );

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, handleKeyDown]);
}
