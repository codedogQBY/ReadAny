import { NoteList } from "@/components/annotation/NoteList";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { TOCPanel } from "@/components/reader/TOCPanel";
/**
 * Sidebar — container for chat/notes/TOC panels
 */
import { useAppStore } from "@/stores/app-store";

export function Sidebar() {
  const { sidebarTab, setSidebarTab, toggleSidebar } = useAppStore();

  return (
    <aside className="flex w-80 flex-col border-l border-border bg-background">
      <div className="flex h-9 items-center justify-between border-b border-border px-3">
        <div className="flex gap-2">
          {(["chat", "notes", "toc"] as const).map((tab) => (
            <button
              key={tab}
              className={`text-xs font-medium transition-colors ${
                sidebarTab === tab
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setSidebarTab(tab)}
            >
              {tab === "chat" ? "Chat" : tab === "notes" ? "Notes" : "TOC"}
            </button>
          ))}
        </div>
        <button className="text-muted-foreground hover:text-foreground" onClick={toggleSidebar}>
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        {sidebarTab === "chat" && <ChatPanel />}
        {sidebarTab === "notes" && <NoteList />}
        {sidebarTab === "toc" && <TOCPanel />}
      </div>
    </aside>
  );
}
