/**
 * AppLayout — main layout (sageread style)
 * Tab bar at top, then main content area with rounded card containers.
 * Home: left sidebar + right content card.
 * Reader/other: full card container.
 */
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { useAppStore } from "@/stores/app-store";
import { HomeSidebar } from "./Sidebar";
import { TabBar } from "./TabBar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const activeTabId = useAppStore((s) => s.activeTabId);
  const showSettings = useAppStore((s) => s.showSettings);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const isHome = activeTabId === "home";

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-muted">
      <TabBar />
      <main className="relative flex-1 overflow-hidden p-1">
        {isHome ? (
          <div className="flex h-full w-full overflow-hidden rounded-xl border bg-background shadow-around">
            <HomeSidebar />
            <div className="h-full flex-1 overflow-hidden p-1">
              <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-background shadow-around">
                {children}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-background shadow-around">
            {children}
          </div>
        )}
      </main>
      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
