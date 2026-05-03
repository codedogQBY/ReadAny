import { useResolvedSrc } from "@/hooks/use-resolved-src";
import type { Book, BookGroup } from "@readany/core/types";
import { Folder, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface GroupCardProps {
  group: BookGroup;
  books: Book[];
  onOpen: (groupId: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  onDelete: (group: BookGroup) => void;
}

function CoverLayer({ book, index, total }: { book: Book; index: number; total: number }) {
  const coverSrc = useResolvedSrc(book.meta.coverUrl);

  const configs: Record<
    number,
    { right: number; bottom: number; width: string; opacity: number; zIndex: number }[]
  > = {
    1: [{ right: 1, bottom: 1, width: "94%", opacity: 1, zIndex: 30 }],
    2: [
      { right: 0, bottom: 0, width: "88%", opacity: 0.78, zIndex: 10 },
      { right: 12, bottom: 8, width: "88%", opacity: 1, zIndex: 20 },
    ],
    3: [
      { right: 0, bottom: 0, width: "82%", opacity: 0.62, zIndex: 10 },
      { right: 10, bottom: 6, width: "82%", opacity: 0.8, zIndex: 20 },
      { right: 20, bottom: 12, width: "82%", opacity: 1, zIndex: 30 },
    ],
    4: [
      { right: 0, bottom: 0, width: "76%", opacity: 0.5, zIndex: 10 },
      { right: 8, bottom: 5, width: "76%", opacity: 0.65, zIndex: 20 },
      { right: 16, bottom: 10, width: "76%", opacity: 0.82, zIndex: 30 },
      { right: 24, bottom: 15, width: "76%", opacity: 1, zIndex: 40 },
    ],
  };
  const offsets = configs[total] ?? configs[4] ?? configs[1];
  const offset = offsets[index] ?? offsets[0];

  return (
    <div
      className="book-cover-shadow absolute aspect-[28/41] overflow-hidden rounded transition-all duration-200"
      style={{
        right: offset.right,
        bottom: offset.bottom,
        width: offset.width,
        zIndex: offset.zIndex,
        opacity: offset.opacity,
      }}
    >
      {coverSrc ? (
        <>
          <img
            src={coverSrc}
            alt=""
            className="h-full w-full rounded object-cover"
            loading="lazy"
          />
          <div className="book-spine absolute inset-0 rounded" />
        </>
      ) : (
        <div className="flex h-full w-full flex-col items-center rounded bg-gradient-to-b from-stone-100 to-stone-200 p-2">
          <div className="flex flex-1 items-center justify-center">
            <span className="line-clamp-3 text-center font-serif text-[11px] font-medium leading-snug text-stone-500">
              {book.meta.title}
            </span>
          </div>
          <div className="h-px w-8 bg-stone-300/60" />
          {book.meta.author && (
            <div className="flex h-1/4 items-center justify-center">
              <span className="line-clamp-1 text-center font-serif text-[9px] text-stone-400">
                {book.meta.author}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const GroupCard = memo(function GroupCard({
  group,
  books,
  onOpen,
  renameGroup,
  onDelete,
}: GroupCardProps) {
  const { t } = useTranslation();
  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const previewBooks = useMemo(
    () =>
      [...books]
        .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
        .slice(0, 4)
        .reverse(),
    [books],
  );

  const handleStartRename = useCallback(() => {
    setRenameValue(group.name);
    setIsRenaming(true);
    setShowMenu(false);
    setMenuPos(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [group.name]);

  const commitRename = useCallback(() => {
    const name = renameValue.trim();
    if (name && name !== group.name) renameGroup(group.id, name);
    setIsRenaming(false);
  }, [renameValue, group.id, group.name, renameGroup]);

  return (
    <div className="group/card relative flex h-full cursor-pointer flex-col justify-end">
      <div className="relative aspect-[28/41] w-full">
        <button
          type="button"
          className="book-cover-shadow relative h-full w-full overflow-hidden rounded bg-muted/70 transition-all duration-200 group-hover/card:book-cover-shadow"
          onClick={() => {
            if (!isRenaming) onOpen(group.id);
          }}
        >
          {previewBooks.length > 0 ? (
            previewBooks.map((book, index) => (
              <CoverLayer key={book.id} book={book} index={index} total={previewBooks.length} />
            ))
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/70">
              <Folder className="h-10 w-10 text-muted-foreground/30" />
            </div>
          )}
        </button>

        <button
          type="button"
          className="absolute right-1 bottom-1 z-20 rounded-md bg-black/30 p-0.5 opacity-0 backdrop-blur-sm transition-opacity group-hover/card:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            if (showMenu) {
              setShowMenu(false);
              setMenuPos(null);
            } else {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenuPos({ x: rect.right, y: rect.top });
              setShowMenu(true);
            }
          }}
        >
          <MoreVertical className="h-3.5 w-3.5 text-white" />
        </button>
      </div>

      {showMenu && menuPos && (
        <>
          <div
            className="fixed inset-0 z-50"
            onClick={() => {
              setShowMenu(false);
              setMenuPos(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setShowMenu(false);
                setMenuPos(null);
              }
            }}
          />
          <div
            className="fixed z-50 min-w-36 rounded-lg border bg-popover p-1 shadow-lg"
            style={{ bottom: window.innerHeight - menuPos.y + 4, left: menuPos.x - 152 }}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted"
              onClick={handleStartRename}
            >
              <Pencil className="h-3.5 w-3.5" />
              {t("common.rename", "重命名")}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
              onClick={() => {
                setShowMenu(false);
                setMenuPos(null);
                onDelete(group);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("common.delete", "删除")}
            </button>
          </div>
        </>
      )}

      <div className="flex w-full flex-col pt-2">
        {isRenaming ? (
          <input
            ref={inputRef}
            className="w-full border-b border-primary bg-transparent text-xs font-semibold text-foreground outline-none"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setIsRenaming(false);
            }}
            onBlur={commitRename}
          />
        ) : (
          <h4 className="truncate text-xs font-semibold leading-tight text-foreground">
            {group.name}
          </h4>
        )}
        <p className="truncate text-[10px] leading-tight text-muted-foreground">
          {t("library.groupBookCount", { count: books.length, defaultValue: `${books.length} 本` })}
        </p>
        <div className="mt-0.5 flex flex-wrap gap-0.5">
          <span className="inline-flex items-center rounded-full bg-primary/8 px-1.5 py-px text-[9px] font-medium text-primary">
            {t("library.group", "分组")}
          </span>
        </div>
        <div className="mt-0.5" style={{ minHeight: "14px" }} />
      </div>
    </div>
  );
});
