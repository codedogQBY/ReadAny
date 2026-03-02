import { useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import { BarChart3, BookOpen, ChevronDown, ChevronRight, MessageSquare, Puzzle, Search, Settings, StickyNote } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface NavItem {
  tabType: "home" | "chat" | "notes" | "skills";
  labelKey: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  expandable?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { tabType: "home", labelKey: "sidebar.library", icon: BookOpen, expandable: true },
  { tabType: "chat", labelKey: "sidebar.chat", icon: MessageSquare },
  { tabType: "notes", labelKey: "sidebar.notes", icon: StickyNote },
  { tabType: "skills", labelKey: "sidebar.skills", icon: Puzzle },
];

export function HomeSidebar() {
  const { t } = useTranslation();
  const { activeTabId, setActiveTab, addTab } = useAppStore();
  const { filter, setFilter } = useLibraryStore();
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [isLibraryExpanded, setIsLibraryExpanded] = useState(true);

  // Determine which home sub-view is active
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === activeTabId));
  const activeType = activeTab?.type ?? "home";

  const handleNavClick = (tabType: "home" | "chat" | "notes" | "skills") => {
    if (tabType === "home") {
      setActiveTab("home");
    } else {
      // Add the tab if it doesn't exist, then activate
      // Use translated title for the tab
      const item = NAV_ITEMS.find((n) => n.tabType === tabType);
      const title = item ? t(item.labelKey) : tabType;
      addTab({ id: tabType, type: tabType, title });
      setActiveTab(tabType);
    }
  };

  const handleStatsClick = () => {
    addTab({ id: "stats", type: "home" as "home", title: t("stats.title") });
    // Use a special convention: we set activeTab to "stats" but type is home
    // Actually, let's keep it simple — stats is a home sub-view triggered by a special tab id
    setActiveTab("stats");
  };

  return (
    <aside className="z-40 flex h-full w-48 shrink-0 select-none flex-col overflow-hidden">
      <div className="px-2 pt-2">
        {isSearchVisible ? (
          <div className="flex w-full items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 transition-colors">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input type="text" placeholder={`${t("common.search")}...`} autoFocus
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              value={filter.search}
              onChange={(e) => { setFilter({ search: e.target.value }); if (e.target.value && activeType !== "home") setActiveTab("home"); }}
              onBlur={() => { if (!filter.search) setIsSearchVisible(false); }}
              onKeyDown={(e) => { if (e.key === "Escape") { setFilter({ search: "" }); setIsSearchVisible(false); } }}
            />
          </div>
        ) : (
          <button type="button" className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => setIsSearchVisible(true)}>
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="text-sm">{t("common.search")}</span>
          </button>
        )}
      </div>
      <nav className="flex flex-1 flex-col space-y-1 overflow-y-auto px-1 pt-2 pl-2">
        {NAV_ITEMS.map((item) => {
          const isActive = activeType === item.tabType;
          const Icon = item.icon;
          return (
            <div key={item.tabType}>
              {item.expandable ? (
                <div className="flex w-full items-center">
                  <button type="button" className={`flex flex-1 items-center gap-2 rounded-md p-1 py-1 text-left text-sm transition-colors hover:bg-muted ${isActive ? "text-neutral-900" : "text-neutral-700"}`} onClick={() => handleNavClick(item.tabType)}>
                    <div className="flex flex-1 items-center gap-2">
                      <Icon size={16} className="shrink-0" />
                      <span className="font-medium text-sm">{t(item.labelKey)}</span>
                    </div>
                    <div className="flex h-5 w-5 items-center justify-center rounded-full text-neutral-700 transition-colors hover:bg-neutral-100" onClick={(e) => { e.stopPropagation(); setIsLibraryExpanded(!isLibraryExpanded); }}>
                      {isLibraryExpanded ? <ChevronDown size={16} className="shrink-0" /> : <ChevronRight size={16} className="shrink-0" />}
                    </div>
                  </button>
                </div>
              ) : (
                <button type="button" className={`flex w-full items-center gap-2 rounded-md p-1 py-1 text-left text-sm transition-colors hover:bg-muted ${isActive ? "text-neutral-900" : "text-neutral-700"}`} onClick={() => handleNavClick(item.tabType)}>
                  <Icon size={16} className="shrink-0" />
                  <span className="font-medium text-sm">{t(item.labelKey)}</span>
                </button>
              )}
              {item.expandable && isLibraryExpanded && (
                <div className="ml-6 mt-1 space-y-0.5">
                  <button type="button" className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-neutral-500 transition-colors hover:bg-muted hover:text-neutral-700" onClick={() => handleNavClick("home")}>
                    <span>{t("sidebar.allBooks")}</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="space-y-1 px-2 py-3">
        <button type="button" className="flex w-full items-center gap-2 rounded-md p-1 py-1 text-left text-neutral-600 text-sm hover:bg-muted" onClick={handleStatsClick}>
          <BarChart3 size={16} className="shrink-0" />
          <span className="text-sm">{t("stats.title")}</span>
        </button>
        <button type="button" className="flex w-full items-center gap-2 rounded-md p-1 py-1 text-left text-neutral-600 text-sm hover:bg-muted" onClick={() => setShowSettings(true)}>
          <Settings size={16} className="shrink-0" />
          <span className="text-sm">{t("common.settings")}</span>
        </button>
      </div>
    </aside>
  );
}
