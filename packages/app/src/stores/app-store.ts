/**
 * Global application state — Tab management, active tab, home state
 */
import { create } from "zustand";

export type TabType = "home" | "reader" | "chat" | "notes";

export interface Tab {
  id: string;
  type: TabType;
  title: string;
  bookId?: string; // for reader tabs
  threadId?: string; // for chat tabs
  isModified?: boolean;
}

export interface AppState {
  tabs: Tab[];
  activeTabId: string | null;
  sidebarOpen: boolean;
  sidebarTab: "chat" | "notes" | "toc";

  // Actions
  addTab: (tab: Tab) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  toggleSidebar: () => void;
  setSidebarTab: (tab: "chat" | "notes" | "toc") => void;
}

export const useAppStore = create<AppState>((set) => ({
  tabs: [{ id: "home", type: "home", title: "Home" }],
  activeTabId: "home",
  sidebarOpen: false,
  sidebarTab: "chat",

  addTab: (tab) =>
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    })),

  removeTab: (tabId) =>
    set((state) => {
      const tabs = state.tabs.filter((t) => t.id !== tabId);
      const activeTabId =
        state.activeTabId === tabId
          ? tabs[tabs.length - 1]?.id ?? null
          : state.activeTabId;
      return { tabs, activeTabId };
    }),

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  reorderTabs: (fromIndex, toIndex) =>
    set((state) => {
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, moved);
      return { tabs };
    }),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setSidebarTab: (tab) => set({ sidebarTab: tab, sidebarOpen: true }),
}));
