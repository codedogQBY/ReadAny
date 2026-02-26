/**
 * TabBar — draggable tab bar (sageread style: compact h-7, Home icon pinned left, drag region)
 */
import { type Tab, useAppStore } from "@/stores/app-store";
import { BookOpen, Home, MessageSquare, StickyNote, X } from "lucide-react";
import { useNavigate } from "react-router";

const TAB_ICONS: Record<string, React.ElementType> = {
  home: Home,
  reader: BookOpen,
  chat: MessageSquare,
  notes: StickyNote,
};

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, removeTab } = useAppStore();
  const navigate = useNavigate();

  const readerTabs = tabs.filter((t) => t.type !== "home");

  const handleTabActivate = (tab: Tab) => {
    setActiveTab(tab.id);
    // Navigate to the correct route based on tab type
    if (tab.type === "reader" && tab.bookId) {
      navigate(`/reader/${tab.bookId}`);
    } else if (tab.type === "chat") {
      navigate("/chat");
    } else if (tab.type === "notes") {
      navigate("/notes");
    }
  };

  return (
    <div
      className="flex h-8 shrink-0 select-none items-center border-neutral-200 bg-muted"
      data-tauri-drag-region
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* macOS traffic light spacing + Home icon */}
      <div
        className="flex h-full shrink-0 items-center"
        style={{ paddingLeft: 68 }}
      >
        <button
          type="button"
          className="flex items-center justify-center rounded-md p-1 text-neutral-500 transition-colors hover:bg-neutral-200/60 hover:text-neutral-800"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onClick={() => {
            setActiveTab("home");
            navigate("/");
          }}
        >
          <Home className="h-[18px] w-[18px]" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex h-full flex-1 items-center gap-0.5 overflow-x-auto px-1" data-tauri-drag-region style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
        {readerTabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onActivate={() => handleTabActivate(tab)}
            onClose={() => removeTab(tab.id)}
          />
        ))}
      </div>
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
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      onClick={onActivate}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="max-w-[120px] truncate">{tab.title}</span>
      <button
        type="button"
        className="ml-0.5 hidden h-4 w-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-neutral-200/80 hover:text-foreground group-hover:flex"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
