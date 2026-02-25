/**
 * Keyboard shortcut management — full keybinding with tab isolation + input filtering
 */

export interface KeyBinding {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: string;
  description: string;
}

/** Default keyboard bindings */
export const DEFAULT_BINDINGS: KeyBinding[] = [
  // Navigation
  { key: "ArrowLeft", action: "page-prev", description: "Previous page" },
  { key: "ArrowRight", action: "page-next", description: "Next page" },
  { key: "ArrowUp", action: "scroll-up", description: "Scroll up" },
  { key: "ArrowDown", action: "scroll-down", description: "Scroll down" },
  { key: " ", action: "page-next", description: "Next page (Space)" },
  { key: " ", shift: true, action: "page-prev", description: "Previous page (Shift+Space)" },

  // Chapters
  { key: "[", action: "chapter-prev", description: "Previous chapter" },
  { key: "]", action: "chapter-next", description: "Next chapter" },

  // UI
  { key: "t", meta: true, action: "toggle-toc", description: "Toggle TOC" },
  { key: "b", meta: true, action: "toggle-sidebar", description: "Toggle sidebar" },
  { key: "f", meta: true, action: "search", description: "Search in book" },
  { key: ",", meta: true, action: "settings", description: "Open settings" },

  // Zoom
  { key: "=", meta: true, action: "zoom-in", description: "Increase font size" },
  { key: "-", meta: true, action: "zoom-out", description: "Decrease font size" },
  { key: "0", meta: true, action: "zoom-reset", description: "Reset font size" },
];

/** Check if the keyboard event target is an input element */
export function isInputElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable;
}

/** Match a keyboard event against a binding */
export function matchBinding(
  event: KeyboardEvent,
  binding: KeyBinding,
): boolean {
  return (
    event.key === binding.key &&
    !!event.ctrlKey === !!binding.ctrl &&
    !!event.metaKey === !!binding.meta &&
    !!event.shiftKey === !!binding.shift &&
    !!event.altKey === !!binding.alt
  );
}

/** Find matching action for a keyboard event */
export function findAction(
  event: KeyboardEvent,
  bindings: KeyBinding[] = DEFAULT_BINDINGS,
): string | null {
  if (isInputElement(event.target)) return null;
  const match = bindings.find((b) => matchBinding(event, b));
  return match?.action ?? null;
}
