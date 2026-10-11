/**
 * Global application state — Tab management, active tab, home state
 */
import { create } from "zustand";

export type TabType = "home" | "reader" | "chat" | "notes" | "skills" | "epubDraft";

export interface Tab {
  id: string;
  type: TabType;
  title: string;
  bookId?: string; // for reader tabs
  draftId?: string; // for EPUB draft workspace tabs
  threadId?: string; // for chat tabs
  initialCfi?: string; // for reader tabs - initial location to navigate to
  isModified?: boolean;
  lastActiveAt?: number; // timestamp of last activation (for idle tab reclaim)
}

export type SidebarTab = "chat" | "notes" | "toc" | "highlights" | "stats";

export type SettingsTab =
  | "general"
  | "reading"
  | "dictionaries"
  | "fonts"
  | "ai"
  | "vectorModel"
  | "tts"
  | "translation"
  | "sync"
  | "externalAi"
  | "feedback"
  | "about";

export interface AppState {
  tabs: Tab[];
  activeTabId: string | null;
  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
  showSettings: boolean;
  settingsTab: SettingsTab;

  // Actions
  addTab: (tab: Tab) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  toggleSidebar: () => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setShowSettings: (show: boolean, tab?: SettingsTab) => void;
}

export const useAppStore = create<AppState>((set) => ({
  tabs: [{ id: "home", type: "home", title: "Home" }],
  activeTabId: "home",
  sidebarOpen: false,
  sidebarTab: "chat",
  showSettings: false,
  settingsTab: "general",

  addTab: (tab) =>
    set((state) => {
      const now = Date.now();
      const existingIndex = state.tabs.findIndex((t) => t.id === tab.id);
      if (existingIndex >= 0) {
        const existingTab = state.tabs[existingIndex];
        if (existingTab && "initialCfi" in tab) {
          const updatedTabs = [...state.tabs];
          updatedTabs[existingIndex] = {
            ...existingTab,
            initialCfi: tab.initialCfi,
            lastActiveAt: now,
          };
          return { tabs: updatedTabs, activeTabId: tab.id };
        }
        // Update lastActiveAt on re-activation
        const updatedTabs = [...state.tabs];
        if (updatedTabs[existingIndex]) {
          updatedTabs[existingIndex] = { ...updatedTabs[existingIndex], lastActiveAt: now };
        }
        return { tabs: updatedTabs, activeTabId: tab.id };
      }
      return {
        tabs: [...state.tabs, { ...tab, lastActiveAt: now }],
        activeTabId: tab.id,
      };
    }),

  removeTab: (tabId) =>
    set((state) => {
      const tabs = state.tabs.filter((t) => t.id !== tabId);
      const activeTabId =
        state.activeTabId === tabId ? (tabs[tabs.length - 1]?.id ?? null) : state.activeTabId;
      return { tabs, activeTabId };
    }),

  setActiveTab: (tabId) =>
    set((state) => {
      const now = Date.now();
      const updatedTabs = state.tabs.map((t) => (t.id === tabId ? { ...t, lastActiveAt: now } : t));
      return { tabs: updatedTabs, activeTabId: tabId };
    }),

  reorderTabs: (fromIndex, toIndex) =>
    set((state) => {
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, moved);
      return { tabs };
    }),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setSidebarTab: (tab) => set({ sidebarTab: tab, sidebarOpen: true }),

  setShowSettings: (show, tab) => set({ showSettings: show, settingsTab: tab ?? "general" }),
}));
