/**
 * AppLayout — SageRead-style three-column tab-driven layout.
 *
 * Structure: TabBar (top) → Sidebar (left, home pages only) → Content (right).
 *
 * Key design: ALL opened reader tabs stay mounted in the DOM simultaneously.
 * Non-active tabs are hidden via `display:none` so renderers are never destroyed
 * on tab switch. Only closing a tab truly unmounts the ReaderView.
 *
 * Home-type pages (home/chat/notes/stats) share the left sidebar.
 * Reader pages are full-width (no sidebar).
 */
import { ChatPage as ChatPageComponent } from "@/components/chat/ChatPage";
import { HomePage } from "@/components/home/HomePage";
import { ReaderView } from "@/components/reader/ReaderView";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { ReadingStatsPanel } from "@/components/stats/ReadingStatsPanel";
import { useAppStore } from "@/stores/app-store";
import { useReaderStore } from "@/stores/reader-store";
import { Construction } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { HomeSidebar } from "./Sidebar";
import { TabBar } from "./TabBar";

function NotesPlaceholder() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <Construction className="h-16 w-16" />
      <h2 className="text-xl font-medium">{t("notes.title")}</h2>
      <p className="text-sm">{t("notes.underDevelopment")}</p>
    </div>
  );
}

const HOME_VIEWS: Record<string, React.ComponentType> = {
  home: HomePage,
  chat: ChatPageComponent,
  notes: NotesPlaceholder,
  stats: ReadingStatsPanel,
};

export function AppLayout() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const showSettings = useAppStore((s) => s.showSettings);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const initTab = useReaderStore((s) => s.initTab);
  const readerStoreTabs = useReaderStore((s) => s.tabs);

  const readerTabs = tabs.filter((t) => t.type === "reader" && t.bookId);
  const isReaderActive = readerTabs.some((t) => t.id === activeTabId);

  // Determine which home sub-view to show based on activeTabId
  // "home" → HomePage, "chat" → ChatPage, "notes" → Notes, "stats" → Stats
  const homeViewKey = isReaderActive ? "home" : (activeTabId ?? "home");
  const HomeView = HOME_VIEWS[homeViewKey] ?? HomePage;

  // Track which reader tabs we've already initialized
  const initializedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const tab of readerTabs) {
      if (tab.bookId && !initializedRef.current.has(tab.id) && !readerStoreTabs[tab.id]) {
        initializedRef.current.add(tab.id);
        initTab(tab.id, tab.bookId);
      }
    }
    // Clean up removed tabs from tracking
    const currentIds = new Set(readerTabs.map((t) => t.id));
    for (const id of initializedRef.current) {
      if (!currentIds.has(id)) {
        initializedRef.current.delete(id);
      }
    }
  }, [readerTabs, initTab, readerStoreTabs]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-muted">
      <TabBar />
      <main className="relative flex-1 overflow-hidden">
        {/* === Home layer (sidebar + content card) === */}
        <div
          className="flex h-full w-full overflow-hidden"
          style={{ display: !isReaderActive ? "flex" : "none" }}
        >
          <HomeSidebar />
          <div className="h-full flex-1 overflow-hidden pr-1 pb-1">
            <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-background shadow-around">
              <HomeView />
            </div>
          </div>
        </div>

        {/* === Reader layers — one per open reader tab, all stay mounted === */}
        {readerTabs.map((tab) => (
          <div
            key={tab.id}
            className="absolute inset-0 overflow-hidden"
            style={{ display: activeTabId === tab.id ? "block" : "none" }}
          >
            <ReaderView bookId={tab.bookId!} tabId={tab.id} />
          </div>
        ))}
      </main>
      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
