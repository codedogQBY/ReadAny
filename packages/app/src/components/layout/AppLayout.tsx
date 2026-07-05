/**
 * AppLayout — SageRead-style three-column tab-driven layout.
 *
 * Structure: TabBar (top) → Sidebar (left, home pages only) → Content (right).
 *
 * Key design: ALL opened reader tabs stay mounted in the DOM simultaneously.
 * Non-active tabs are hidden via `display:none` so renderers are never destroyed
 * on tab switch. Only closing a tab truly unmounts the ReaderView.
 *
 * Idle Tab Reclaim: Reader tabs inactive for IDLE_TIMEOUT_MS are "hibernated" —
 * their <ReaderView> is unmounted to release renderer / canvas memory.
 * When the user switches back to a hibernated tab, it is re-mounted and the
 * reader restores to the previously recorded CFI position automatically.
 *
 * Home-type pages (home/chat/notes/skills/stats) share the left sidebar.
 * Reader pages are full-width (no sidebar).
 */
import { ChatPage as ChatPageComponent } from "@/components/chat/ChatPage";
import { CommandPalette } from "@/components/command-palette/CommandPalette";
import { HomePage } from "@/components/home/HomePage";
import { NotesPage } from "@/components/notes/NotesPage";
import { OnboardingModal } from "@/components/onboarding/OnboardingModal";
import { ReaderView, evictBlobCache } from "@/components/reader/ReaderView";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { MissingBookPromptDialog } from "@/components/shared/MissingBookPromptDialog";
import { ReadingStatsPanel } from "@/components/stats/ReadingStatsPanel";
import { FloatingTTSBubble } from "@/components/tts/FloatingTTSBubble";
import SkillsPage from "@/pages/Skills";
import { useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import { useReaderStore } from "@/stores/reader-store";
import { useFontStore } from "@readany/core/stores";
import { useSettingsStore } from "@readany/core/stores/settings-store";
import { BookOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HomeSidebar } from "./Sidebar";
import { TabBar } from "./TabBar";

/** All home sub-views — each stays mounted and uses display:none to toggle. */
const HOME_VIEWS: { id: string; Component: React.ComponentType }[] = [
  { id: "home", Component: HomePage },
  { id: "chat", Component: ChatPageComponent },
  { id: "notes", Component: NotesPage },
  { id: "skills", Component: SkillsPage },
  { id: "stats", Component: ReadingStatsPanel },
];

/** Idle timeout before a background reader tab is hibernated (30 minutes). */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** How often we check for idle tabs (every 2 minutes). */
const IDLE_CHECK_INTERVAL_MS = 2 * 60 * 1000;

export function AppLayout() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const showSettings = useAppStore((s) => s.showSettings);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const initTab = useReaderStore((s) => s.initTab);
  const readerStoreTabs = useReaderStore((s) => s.tabs);
  const books = useLibraryStore((s) => s.books);
  const { hasCompletedOnboarding: _hasCompletedOnboarding, _hasHydrated } = useSettingsStore();
  const { t } = useTranslation();

  // Inject @font-face / <link> for all custom fonts into the main app document
  const customFonts = useFontStore((s) => s.fonts);
  useEffect(() => {
    // 1. Inject <link> tags for CSS-based remote fonts
    const cssLinkClass = "__readany_remote_css_font__";
    // Remove old ones that are no longer needed
    document.querySelectorAll(`link.${cssLinkClass}`).forEach((el) => el.remove());
    for (const f of customFonts) {
      if (f.source === "remote" && f.remoteCssUrl) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = f.remoteCssUrl;
        link.className = cssLinkClass;
        document.head.appendChild(link);
      }
    }

    // 2. Inject @font-face for local and direct-URL remote fonts
    if (customFonts.every((f) => f.remoteCssUrl)) return;
    import("@tauri-apps/api/core")
      .then(({ convertFileSrc }) => {
        const styleId = "__readany_app_font_faces__";
        let el = document.getElementById(styleId) as HTMLStyleElement | null;
        if (!el) {
          el = document.createElement("style");
          el.id = styleId;
          document.head.appendChild(el);
        }
        el.textContent = customFonts
          .map((f) => {
            if (f.remoteCssUrl) return ""; // handled by <link>
            if (f.source === "remote") {
              const src = f.remoteUrlWoff2
                ? `url('${f.remoteUrlWoff2}') format('woff2')${f.remoteUrl ? `, url('${f.remoteUrl}') format('woff')` : ""}`
                : f.remoteUrl
                  ? `url('${f.remoteUrl}') format('woff')`
                  : "";
              return src
                ? `@font-face { font-family: ${JSON.stringify(f.fontFamily)}; src: ${src}; font-display: swap; }`
                : "";
            }
            if (!f.filePath) return "";
            const fileUrl = convertFileSrc(f.filePath);
            const fmt =
              f.format === "otf"
                ? "opentype"
                : f.format === "woff"
                  ? "woff"
                  : f.format === "woff2"
                    ? "woff2"
                    : "truetype";
            return `@font-face { font-family: ${JSON.stringify(f.fontFamily)}; src: url('${fileUrl}') format('${fmt}'); }`;
          })
          .filter(Boolean)
          .join("\n");
      })
      .catch((err) => console.warn("[Layout] Failed to load custom font faces:", err));
  }, [customFonts]);

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const readerTabs = tabs.filter((t) => t.type === "reader" && t.bookId);
  const isReaderActive = readerTabs.some((t) => t.id === activeTabId);
  const [showTabBar, setShowTabBar] = useState(!isReaderActive);
  const hideTabBarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevIsReaderActiveRef = useRef(isReaderActive);

  useEffect(() => {
    if (isReaderActive && !prevIsReaderActiveRef.current) {
      setShowTabBar(false);
    }
    if (!isReaderActive) {
      setShowTabBar(true);
    }
    prevIsReaderActiveRef.current = isReaderActive;
  }, [isReaderActive]);

  const toggleCommandPalette = useCallback(() => {
    setCommandPaletteOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        toggleCommandPalette();
      }
      if (e.key === "F11") {
        e.preventDefault();
        import("@tauri-apps/api/window")
          .then(({ getCurrentWindow }) => {
            const win = getCurrentWindow();
            win.isFullscreen().then((fs) => win.setFullscreen(!fs));
          })
          .catch((err) => console.warn("[Layout] Failed to toggle fullscreen:", err));
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [toggleCommandPalette]);

  useEffect(() => {
    if (!isReaderActive) return;

    const handleMouseMove = (e: MouseEvent) => {
      const threshold = 10;
      if (e.clientY <= threshold) {
        if (hideTabBarTimerRef.current) {
          clearTimeout(hideTabBarTimerRef.current);
          hideTabBarTimerRef.current = null;
        }
        setShowTabBar(true);
      }
    };

    const handleMouseLeaveTabBar = () => {
      if (hideTabBarTimerRef.current) {
        clearTimeout(hideTabBarTimerRef.current);
      }
      hideTabBarTimerRef.current = setTimeout(() => {
        setShowTabBar(false);
      }, 500);
    };

    window.addEventListener("mousemove", handleMouseMove);

    const tabBarEl = document.querySelector("[data-tab-bar]");
    if (tabBarEl) {
      tabBarEl.addEventListener("mouseleave", handleMouseLeaveTabBar);
      tabBarEl.addEventListener("mouseenter", () => {
        if (hideTabBarTimerRef.current) {
          clearTimeout(hideTabBarTimerRef.current);
          hideTabBarTimerRef.current = null;
        }
      });
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (tabBarEl) {
        tabBarEl.removeEventListener("mouseleave", handleMouseLeaveTabBar);
      }
      if (hideTabBarTimerRef.current) {
        clearTimeout(hideTabBarTimerRef.current);
      }
    };
  }, [isReaderActive]);

  const handleTabBarMouseEnter = useCallback(() => {
    if (hideTabBarTimerRef.current) {
      clearTimeout(hideTabBarTimerRef.current);
      hideTabBarTimerRef.current = null;
    }
    setShowTabBar(true);
  }, []);

  const handleTabBarMouseLeave = useCallback(() => {
    if (!isReaderActive) return;
    if (hideTabBarTimerRef.current) {
      clearTimeout(hideTabBarTimerRef.current);
    }
    hideTabBarTimerRef.current = setTimeout(() => {
      setShowTabBar(false);
    }, 500);
  }, [isReaderActive]);

  // Determine which home sub-view is active
  const homeViewKey = isReaderActive ? null : (activeTabId ?? "home");

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

  // --- Idle Tab Hibernate ---
  // Set of tab IDs whose ReaderView has been unmounted to reclaim memory.
  // When the user switches back, the tab is removed from this set and re-mounted.
  const [hibernatedTabs, setHibernatedTabs] = useState<Set<string>>(new Set());

  // Periodic idle check — every IDLE_CHECK_INTERVAL_MS, scan non-active reader tabs
  // and hibernate any that have been idle longer than IDLE_TIMEOUT_MS.
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      const currentTabs = useAppStore.getState().tabs;
      const currentActiveId = useAppStore.getState().activeTabId;

      const toHibernate: string[] = [];
      for (const tab of currentTabs) {
        if (tab.type !== "reader" || tab.id === currentActiveId) continue;
        const lastActive = tab.lastActiveAt ?? 0;
        if (now - lastActive >= IDLE_TIMEOUT_MS) {
          toHibernate.push(tab.id);
        }
      }

      if (toHibernate.length > 0) {
        // Evict blob cache for hibernated books
        for (const tabId of toHibernate) {
          const tab = currentTabs.find((t) => t.id === tabId);
          if (tab?.bookId) {
            const book = books.find((b) => b.id === tab.bookId);
            if (book?.filePath) {
              evictBlobCache(book.filePath);
            }
          }
        }

        setHibernatedTabs((prev) => {
          const next = new Set(prev);
          for (const id of toHibernate) next.add(id);
          return next;
        });

        console.log(`[AppLayout] Hibernated ${toHibernate.length} idle tab(s):`, toHibernate);
      }
    };

    const interval = setInterval(check, IDLE_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [books]);

  // Wake up a hibernated tab when it becomes active
  useEffect(() => {
    if (!activeTabId) return;
    setHibernatedTabs((prev) => {
      if (!prev.has(activeTabId)) return prev;
      const next = new Set(prev);
      next.delete(activeTabId);
      console.log(`[AppLayout] Waking up hibernated tab: ${activeTabId}`);
      return next;
    });
  }, [activeTabId]);

  // Clean hibernatedTabs when tabs are removed
  useEffect(() => {
    const currentIds = new Set(readerTabs.map((t) => t.id));
    setHibernatedTabs((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of prev) {
        if (!currentIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [readerTabs]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-muted">
      {_hasHydrated && <OnboardingModal />}
      <div
        data-tab-bar
        onMouseEnter={handleTabBarMouseEnter}
        onMouseLeave={handleTabBarMouseLeave}
        className={`absolute left-0 right-0 top-0 z-50 transition-transform duration-300 ease-in-out ${
          isReaderActive && !showTabBar ? "-translate-y-full" : "translate-y-0"
        }`}
      >
        <TabBar />
      </div>
      <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {!isReaderActive && <div className="h-8 shrink-0" />}
        {/* === Home layer (sidebar + content card) === */}
        <div
          className="flex min-h-0 flex-1 w-full overflow-hidden"
          style={{ display: !isReaderActive ? "flex" : "none" }}
        >
          <HomeSidebar />
          <div className="min-h-0 flex-1 overflow-hidden pr-1 pb-1">
            <div className="relative flex h-full flex-col overflow-hidden rounded-xl border bg-background shadow-around">
              {/* All home sub-views stay mounted; toggle via display:none */}
              {HOME_VIEWS.map(({ id, Component }) => (
                <div
                  key={id}
                  className="h-full w-full"
                  style={{ display: homeViewKey === id ? "block" : "none" }}
                >
                  <Component />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* === Reader layers — one per open reader tab === */}
        {readerTabs.map((tab) => {
          const isHibernated = hibernatedTabs.has(tab.id);
          const isActive = activeTabId === tab.id;

          return (
            <div
              key={tab.id}
              className="absolute inset-0 overflow-hidden"
              style={{ display: isActive ? "block" : "none" }}
            >
              {isHibernated ? (
                <HibernatedPlaceholder
                  tabId={tab.id}
                  title={tab.title}
                  progress={readerStoreTabs[tab.id]?.progress}
                  t={t}
                />
              ) : (
                <ReaderView bookId={tab.bookId!} tabId={tab.id} />
              )}
            </div>
          );
        })}
      </main>
      <MissingBookPromptDialog />
      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
      <FloatingTTSBubble />
    </div>
  );
}

/** Placeholder shown for hibernated (idle-reclaimed) reader tabs. */
function HibernatedPlaceholder({
  tabId,
  title,
  progress,
  t,
}: {
  tabId: string;
  title: string;
  progress?: number;
  t: (key: string) => string;
}) {
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <BookOpen className="h-8 w-8 text-muted-foreground" />
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <h3 className="max-w-xs truncate text-sm font-medium text-foreground">{title}</h3>
        {progress != null && progress > 0 && (
          <p className="text-xs text-muted-foreground">{Math.round(progress * 100)}%</p>
        )}
        <p className="text-xs text-muted-foreground">
          {t("reader.hibernated") || "Tab was hibernated to save memory"}
        </p>
      </div>
      <button
        type="button"
        className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
        onClick={() => {
          // setActiveTab will trigger the wake-up effect and remove from hibernatedTabs
          setActiveTab(tabId);
        }}
      >
        {t("reader.resumeReading") || "Resume Reading"}
      </button>
    </div>
  );
}
