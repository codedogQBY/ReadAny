import { type CSSProperties, useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const DEFAULT_CHAT_FONT_SIZE = 14;
export const MIN_CHAT_FONT_SIZE = 12;
export const MAX_CHAT_FONT_SIZE = 24;

function normalizeFontSize(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_CHAT_FONT_SIZE, Math.max(MIN_CHAT_FONT_SIZE, Math.round(value)))
    : DEFAULT_CHAT_FONT_SIZE;
}

/** Desktop-only presentation preferences. Kept outside the synced settings store. */
export const useChatAppearanceStore = create<{
  fontSize: number;
  setFontSize: (fontSize: number) => void;
}>()(
  persist(
    (set) => ({
      fontSize: DEFAULT_CHAT_FONT_SIZE,
      setFontSize: (fontSize) => set({ fontSize: normalizeFontSize(fontSize) }),
    }),
    {
      name: "readany-desktop-chat-appearance",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ fontSize }) => ({ fontSize }),
      merge: (saved, current) => ({
        ...current,
        fontSize: normalizeFontSize((saved as { fontSize?: unknown } | undefined)?.fontSize),
      }),
    },
  ),
);

/** Scope Tailwind's text sizes to conversation content, leaving toolbar controls alone. */
export function useChatTypography(): CSSProperties {
  const fontSize = useChatAppearanceStore((state) => state.fontSize);
  return useMemo(
    () =>
      ({
        "--chat-font-size": `${fontSize}px`,
        "--text-sm": `${fontSize}px`,
        "--text-sm--line-height": 20 / 14,
        "--text-xs": `${(fontSize * 12) / 14}px`,
        "--text-xs--line-height": 16 / 12,
      }) as CSSProperties,
    [fontSize],
  );
}
