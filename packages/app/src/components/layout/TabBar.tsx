import { evictBlobCache } from "@/components/reader/ReaderView";
import { DesktopWindowControls } from "@/components/layout/DesktopWindowControls";
/**
 * TabBar — draggable tab bar
 * macOS: native traffic lights (left), can optionally preview custom controls on the right
 * Windows/Linux: custom window controls (right), system decorations disabled in Tauri setup
 */
import { type Tab, useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import { useReaderStore } from "@/stores/reader-store";
import { useSyncStore } from "@/stores/sync-store";
import { BookOpen, Home, MessageSquare, NotebookPen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const TAB_ICONS: Record<string, React.ElementType> = {
  home: Home,
  reader: BookOpen,
  chat: MessageSquare,
  notes: NotebookPen,
};

const NO_DRAG_STYLE = { WebkitAppRegion: "no-drag" } as Record<string, string>;

function usePlatformInfo() {
  const [info, setInfo] = useState({ isTauri: false, isMac: false, isWinOrLinux: false });
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    setInfo({
      isTauri: "__TAURI_INTERNALS__" in window,
      isMac: ua.includes("mac"),
      isWinOrLinux: !ua.includes("mac"),
    });
  }, []);
  return info;
}

function useIsFullscreen() {
  const [fs, setFs] = useState(false);
  useEffect(() => {
    const check = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const w = getCurrentWindow();
        setFs(await w.isFullscreen());
        const unlisten = await w.onResized(async () => { setFs(await w.isFullscreen()); });
        return unlisten;
      } catch { return undefined; }
    };
    let unlisten: (() => void) | undefined;
    check().then((u) => { unlisten = u; });
    return () => unlisten?.();
  }, []);
  return fs;
}

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, removeTab } = useAppStore();
  const removeReaderTab = useReaderStore((s) => s.removeTab);
  const books = useLibraryStore((s) => s.books);
  const { isMac, isTauri } = usePlatformInfo();
  const isFullscreen = useIsFullscreen();
  const headerRef = useRef<HTMLDivElement | null>(null);

  const visibleTabs = tabs.filter((t) => t.type !== "home");

  const handleTabClose = (tabId: string) => {
    const closingTab = tabs.find((t) => t.id === tabId);
    const isBookTab = !!closingTab?.bookId;
    if (closingTab?.bookId) {
      const book = books.find((b) => b.id === closingTab.bookId);
      if (book?.filePath) evictBlobCache(book.filePath);
    }
    removeTab(tabId);
    removeReaderTab(tabId);
    const remainingNonHome = tabs.filter((t) => t.type !== "home" && t.id !== tabId);
    if (remainingNonHome.length === 0) setActiveTab("home");
    if (isBookTab) {
      useSyncStore.getState().syncNow?.();
    }
  };

  return (
    <div
      ref={headerRef}
      className="flex h-8 shrink-0 select-none items-center border-neutral-200 bg-muted"
    >
      {/* macOS: space for native traffic lights (hidden in reader mode) */}
      <div className="flex h-full shrink-0 items-center" style={{ paddingLeft: (isMac && !isFullscreen) ? 68 : 4 }}>
        <button
          type="button"
          className="flex items-center justify-center rounded-md p-1 text-neutral-500 transition-colors hover:bg-neutral-200/60 hover:text-neutral-800"
          style={NO_DRAG_STYLE}
          data-no-window-drag
          onClick={() => setActiveTab("home")}
        >
          <Home className="h-[18px] w-[18px]" />
        </button>
      </div>

      {/* Tabs */}
      <div
        className="flex h-full flex-1 items-center gap-0.5 overflow-x-auto px-1"
      >
        {visibleTabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onActivate={() => setActiveTab(tab.id)}
            onClose={() => handleTabClose(tab.id)}
          />
        ))}
      </div>

      {/* Desktop: custom window controls on right; macOS keeps native traffic lights only */}
      {isTauri && <DesktopWindowControls headerRef={headerRef} />}
    </div>
  );
}

function TabItem({
  tab,
  isActive,
  onActivate,
  onClose,
}: {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const Icon = TAB_ICONS[tab.type] ?? BookOpen;

  return (
    <div
      className={`group flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs transition-all ${
        isActive
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
      style={NO_DRAG_STYLE}
      data-no-window-drag
      onClick={onActivate}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="max-w-[120px] truncate">{tab.title}</span>
      <button
        type="button"
        className="ml-0.5 hidden h-4 w-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-neutral-200/80 hover:text-foreground group-hover:flex"
        data-no-window-drag
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
