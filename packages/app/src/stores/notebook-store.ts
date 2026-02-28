/**
 * Notebook store — manages notebook panel state for note editing
 */
import type { Highlight } from "@/types";
import { create } from "zustand";

export interface PendingNote {
  /** Selected text to annotate */
  text: string;
  /** CFI location */
  cfi: string;
  /** Chapter title for context */
  chapterTitle?: string;
  /** Associated highlight ID (if editing existing) */
  highlightId?: string;
  /** Existing note content (if editing) */
  existingNote?: string;
}

export interface NotebookState {
  /** Whether the notebook panel is visible */
  isOpen: boolean;
  /** Pending note being created/edited */
  pendingNote: PendingNote | null;
  /** Highlight being edited (for updating note on existing highlight) */
  editingHighlight: Highlight | null;
  /** Draft notes keyed by text hash (for auto-save) */
  drafts: Record<string, string>;

  // Actions
  openNotebook: () => void;
  closeNotebook: () => void;
  toggleNotebook: () => void;
  
  /** Start creating a new note from selection */
  startNewNote: (note: PendingNote) => void;
  /** Start editing note on existing highlight */
  startEditNote: (highlight: Highlight) => void;
  /** Clear pending note/editing state */
  clearPending: () => void;
  
  /** Save draft for auto-recovery */
  saveDraft: (key: string, content: string) => void;
  /** Get draft by key */
  getDraft: (key: string) => string | undefined;
  /** Clear draft */
  clearDraft: (key: string) => void;
}

/** Simple hash function for draft keys */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  isOpen: false,
  pendingNote: null,
  editingHighlight: null,
  drafts: {},

  openNotebook: () => set({ isOpen: true }),
  closeNotebook: () => set({ isOpen: false, pendingNote: null, editingHighlight: null }),
  toggleNotebook: () => set((state) => ({ isOpen: !state.isOpen })),

  startNewNote: (note) => set({ 
    isOpen: true, 
    pendingNote: note, 
    editingHighlight: null 
  }),

  startEditNote: (highlight) => set({ 
    isOpen: true, 
    pendingNote: null, 
    editingHighlight: highlight 
  }),

  clearPending: () => set({ pendingNote: null, editingHighlight: null }),

  saveDraft: (key, content) => {
    const hash = simpleHash(key);
    set((state) => ({
      drafts: { ...state.drafts, [hash]: content }
    }));
  },

  getDraft: (key) => {
    const hash = simpleHash(key);
    return get().drafts[hash];
  },

  clearDraft: (key) => {
    const hash = simpleHash(key);
    set((state) => {
      const { [hash]: _, ...rest } = state.drafts;
      return { drafts: rest };
    });
  },
}));
