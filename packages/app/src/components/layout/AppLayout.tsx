/**
 * AppLayout — main layout with tab bar + content area + sidebar
 */
import { useAppStore } from "@/stores/app-store";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <TabBar />
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-hidden">{children}</main>
        {sidebarOpen && <Sidebar />}
      </div>
    </div>
  );
}
