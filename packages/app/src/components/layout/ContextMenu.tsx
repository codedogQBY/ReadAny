import { shouldSuppressNativeContextMenu } from "@/lib/environment";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type MenuCommand = "undo" | "cut" | "copy" | "paste" | "selectAll";

interface MenuItem {
  command: MenuCommand;
  action: () => void;
  disabled?: boolean;
}

type MenuState = { x: number; y: number; items: MenuItem[] } | null;

const EDITABLE_SELECTOR =
  "input, textarea, [contenteditable='true'], [contenteditable=''], [role='textbox']";

// Clipboard I/O goes through the Tauri plugin: native IPC with no permission
// prompt, identical behavior on Windows/macOS/Linux. The custom menu only
// runs in production builds, which always execute inside Tauri, so there is
// no web Clipboard API fallback — it would be a dead path (and WebView2 gates
// navigator.clipboard.readText() behind a permission dialog anyway).
const readClipboard = async (): Promise<string | null> => {
  try {
    const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
    return await readText();
  } catch {
    return null;
  }
};

const writeClipboard = async (text: string): Promise<void> => {
  try {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
  } catch {
    // ignore — nothing sensible to fall back to
  }
};

// Last-ditch insert for when even execCommand("insertText") is unavailable.
// It writes the value directly, so the edit does NOT land on the native undo
// stack (Undo cannot revert it). React-controlled inputs need a bubbled input
// event so their onChange picks up the new DOM value.
const insertTextAtSelection = (editable: HTMLElement, text: string): void => {
  if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
    const start = editable.selectionStart ?? editable.value.length;
    const end = editable.selectionEnd ?? editable.value.length;
    editable.setRangeText(text, start, end, "end");
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
};

export function ContextMenu() {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuState>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Dev keeps the native menu for debugging — no suppression, no custom menu.
    if (!shouldSuppressNativeContextMenu) return;

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const target = event.target as HTMLElement | null;
      const editable = target?.closest?.(EDITABLE_SELECTOR) as HTMLElement | null;
      if (!editable) {
        setMenu(null);
        return;
      }

      const isTextField =
        editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement;

      const getSelectedText = (): string => {
        try {
          if (isTextField) {
            const el = editable as HTMLInputElement | HTMLTextAreaElement;
            return el.value?.substring(el.selectionStart ?? 0, el.selectionEnd ?? 0) ?? "";
          }
          return window.getSelection()?.toString() ?? "";
        } catch {
          return "";
        }
      };

      const hasSelection = Boolean(getSelectedText());

      // Browsers block cut/copy on password fields for security — mirror the
      // native menu and disable those items instead of offering silent no-ops.
      // Paste/undo/select-all remain useful (password managers paste).
      const isPassword = editable instanceof HTMLInputElement && editable.type === "password";

      // execCommand is deprecated but still fully supported. "insertText"
      // behaves like typed input (stays on the undo stack), "cut" and "undo"
      // drive the field's native editing commands. "paste" is NOT usable —
      // engines refuse it for web content (Chromium/WebView2 included; it
      // silently returns false), which is why clipboard reads/writes go
      // through the Tauri plugin above.
      const execCommand = (command: string, value?: string): boolean => {
        if (typeof document.execCommand !== "function") return false;
        editable.focus();
        try {
          return document.execCommand(command, false, value);
        } catch {
          return false;
        }
      };

      const copySelection = (): void => {
        const text = getSelectedText();
        if (!text) return;
        void writeClipboard(text);
      };

      // Insert as if typed so the paste lands on the field's native undo
      // stack and menu Undo / Ctrl+Z can revert it.
      const pasteClipboard = async (): Promise<void> => {
        editable.focus();
        const text = await readClipboard();
        if (!text) return;
        if (execCommand("insertText", text)) return;
        insertTextAtSelection(editable, text);
      };

      const selectAll = (): void => {
        editable.focus();
        if (isTextField) {
          (editable as HTMLInputElement | HTMLTextAreaElement).select();
          return;
        }
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editable);
        selection?.removeAllRanges();
        selection?.addRange(range);
      };

      const items: MenuItem[] = [
        { command: "undo", action: () => execCommand("undo") },
        { command: "cut", action: () => execCommand("cut"), disabled: !hasSelection || isPassword },
        { command: "copy", action: copySelection, disabled: !hasSelection || isPassword },
        {
          command: "paste",
          action: () => {
            void pasteClipboard();
          },
        },
        { command: "selectAll", action: selectAll },
      ];

      // Keyboard invocation (ContextMenu key / Shift+F10) carries no pointer
      // position (detail === 0; coordinates default to 0,0) — anchor the menu
      // to the field itself instead, like readest's context menus do.
      let x = event.clientX;
      let y = event.clientY;
      if (event.detail === 0) {
        const rect = editable.getBoundingClientRect();
        x = rect.left + 8;
        y = rect.bottom + 4;
      }

      setMenu({ x, y, items });
    };

    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenu(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    const onBlur = () => setMenu(null);

    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Clamp the menu inside the viewport before first paint — right-clicks near
  // the right/bottom edge would otherwise render it partially off-screen.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    const x = Math.max(8, Math.min(menu.x, window.innerWidth - el.offsetWidth - 8));
    const y = Math.max(8, Math.min(menu.y, window.innerHeight - el.offsetHeight - 8));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [menu]);

  if (!shouldSuppressNativeContextMenu || !menu) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-[10000] min-w-[160px] overflow-hidden rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item) => (
        <button
          key={item.command}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className="flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          onClick={() => {
            item.action();
            setMenu(null);
          }}
        >
          {t(`common.${item.command}`)}
        </button>
      ))}
    </div>
  );
}
