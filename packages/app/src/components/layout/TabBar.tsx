/**
 * TabBar — draggable tab bar for multiple open books/views
 */
import { type Tab, useAppStore } from "@/stores/app-store";
import { BookOpen, Home, MessageSquare, StickyNote, X } from "lucide-react";

const TAB_ICONS: Record<string, React.ElementType> = {
  home: Home,
  reader: BookOpen,
  chat: MessageSquare,
  notes: StickyNote,
};

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, removeTab } = useAppStore();

  return (
    <div
      className="flex h-9 items-center border-b border-border bg-muted/50 px-2"
      data-tauri-drag-region
    >
      <div className="flex items-center gap-0.5 overflow-x-auto">
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onActivate={() => setActiveTab(tab.id)}
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
      className={`group flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors ${
        isActive
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
      onClick={onActivate}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="max-w-[120px] truncate">{tab.title}</span>
      {tab.type !== "home" && (
        <button
          className="ml-1 hidden h-4 w-4 items-center justify-center rounded-sm hover:bg-muted group-hover:flex"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
