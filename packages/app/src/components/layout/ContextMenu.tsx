import { useEffect, useRef, useState } from "react";

interface MenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
}

type MenuState = { x: number; y: number; items: MenuItem[] } | null;

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest?.(
      "input, textarea, select, [contenteditable='true'], [contenteditable=''], [role='textbox']",
    ),
  );
};

export function ContextMenu() {
  const [menu, setMenu] = useState<MenuState>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const target = event.target as HTMLElement | null;
      if (!isEditableTarget(event.target)) {
        setMenu(null);
        return;
      }
      const editable = target?.closest?.(
        "input, textarea, [contenteditable='true'], [contenteditable=''], [role='textbox']",
      ) as HTMLElement | null;
      if (!editable) return;

      const isTextArea = editable instanceof HTMLTextAreaElement;
      const isInput = editable instanceof HTMLInputElement;
      const isContentEditable = editable.isContentEditable;

      const getSelection = (): string | undefined => {
        try {
          if (isTextArea || isInput) {
            const el = editable as HTMLInputElement | HTMLTextAreaElement;
            return el.value?.substring(el.selectionStart ?? 0, el.selectionEnd ?? 0) ?? "";
          }
          if (isContentEditable) {
            return window.getSelection()?.toString() ?? "";
          }
          return undefined;
        } catch {
          return undefined;
        }
      };

      const hasSelection = Boolean(getSelection());

      // execCommand is deprecated but remains the only way to copy/paste from a
      // custom context menu WITHOUT triggering the WebView2 clipboard permission
      // dialog (navigator.clipboard.readText() prompts every time). All engines
      // (Chromium/WebView2, WebKit, Firefox) still support it, so prefer it and
      // fall back to the async Clipboard API only if execCommand is gone.
      const execCommandAvailable =
        typeof document.execCommand === "function";

      const doAction = (command: string): boolean => {
        if (!execCommandAvailable) return false;
        editable.focus();
        try {
          return document.execCommand(command);
        } catch {
          return false;
        }
      };

      const copySelection = (): void => {
        const text = getSelection();
        if (!text) return;
        if (!doAction("copy")) {
          // execCommand unavailable — use async Clipboard API (may prompt).
          try {
            void navigator.clipboard?.writeText(text).catch(() => {});
          } catch {
            // ignore
          }
        }
      };

      const pasteClipboard = async (): Promise<void> => {
        editable.focus();
        if (!doAction("paste")) {
          // execCommand unavailable — async read + insert (may prompt).
          try {
            const text = await navigator.clipboard.readText();
            if (text) document.execCommand("insertText", false, text);
          } catch {
            // ignore
          }
        }
      };

      const items: MenuItem[] = [
        {
          label: "撤销",
          action: () => doAction("undo"),
        },
        {
          label: "剪切",
          action: () => doAction("cut"),
          disabled: !hasSelection,
        },
        {
          label: "复制",
          action: copySelection,
          disabled: !hasSelection,
        },
        {
          label: "粘贴",
          action: () => {
            void pasteClipboard();
          },
        },
        {
          label: "全选",
          action: () => {
            editable.focus();
            try {
              if (isTextArea || isInput) {
                (editable as HTMLInputElement | HTMLTextAreaElement).select();
              } else {
                document.execCommand("selectAll");
              }
            } catch {
              // ignore
            }
          },
        },
      ];

      setMenu({ x: event.clientX, y: event.clientY, items });
    };

    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenu(null);
      }
    };
    const onBlur = () => setMenu(null);

    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  if (!menu) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-[10000] min-w-[160px] overflow-hidden rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item) => (
        <button
          key={item.label}
          type="button"
          disabled={item.disabled}
          className="flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          onClick={() => {
            item.action();
            setMenu(null);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
