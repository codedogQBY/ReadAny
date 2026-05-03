import { FolderPlus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BookGroup } from "@readany/core/types";

interface GroupPickerPopoverProps {
  groups: BookGroup[];
  currentGroupId?: string;
  onSelect: (groupId: string | undefined) => void;
  onCreateGroup: (name: string) => void;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

export function GroupPickerPopover({
  groups,
  currentGroupId,
  onSelect,
  onCreateGroup,
  onClose,
  anchorRef,
}: GroupPickerPopoverProps) {
  const { t } = useTranslation();
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isCreating) {
      inputRef.current?.focus();
    }
  }, [isCreating]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        (!anchorRef?.current || !anchorRef.current.contains(e.target as Node))
      ) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose, anchorRef]);

  const handleCreate = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    onCreateGroup(name);
    onClose();
  }, [newName, onCreateGroup, onClose]);

  const style = anchorRef?.current ? getPopoverPosition(anchorRef.current) : {};

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
      <div
        ref={popoverRef}
        className="fixed z-50 w-52 overflow-hidden rounded-xl border bg-popover shadow-xl"
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t("library.moveToGroup", "移入分组")}
          </span>
          <button type="button" className="rounded p-0.5 hover:bg-muted" onClick={onClose}>
            <X className="size-3 text-muted-foreground" />
          </button>
        </div>

        <div className="p-1">
          {groups.length > 0 &&
            groups.map((group) => (
              <button
                key={group.id}
                type="button"
                className="flex w-full items-center rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-muted"
                onClick={() => {
                  onSelect(group.id);
                  onClose();
                }}
              >
                {group.name}
              </button>
            ))}

          {isCreating ? (
            <div className="flex items-center gap-1.5 px-1.5 py-1.5">
              <input
                ref={inputRef}
                type="text"
                className="flex-1 rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-primary"
                placeholder={t("library.groupNamePlaceholder", "分组名称")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") {
                    setIsCreating(false);
                    setNewName("");
                  }
                }}
              />
              <button
                type="button"
                className="shrink-0 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                disabled={!newName.trim()}
                onClick={handleCreate}
              >
                {t("common.confirm", "确定")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-primary hover:bg-muted"
              onClick={() => setIsCreating(true)}
            >
              <FolderPlus className="size-4" />
              {t("library.createGroup", "新建分组")}
            </button>
          )}

          {currentGroupId && (
            <>
              <div className="border-t mx-1 my-0.5" />
              <button
                type="button"
                className="flex w-full items-center rounded-md px-2.5 py-2 text-sm text-destructive hover:bg-destructive/10"
                onClick={() => {
                  onSelect(undefined);
                  onClose();
                }}
              >
                {t("library.removeFromGroup", "移出分组")}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function getPopoverPosition(anchor: HTMLElement): React.CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const popoverWidth = 208;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let top = rect.bottom + 6;
  let left = rect.right - popoverWidth;

  if (left < 8) left = 8;
  if (left + popoverWidth > viewportWidth - 8) left = viewportWidth - popoverWidth - 8;
  if (top + 300 > viewportHeight) {
    top = rect.top - 6;
  }

  return { position: "fixed", top, left };
}
