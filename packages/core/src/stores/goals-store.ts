/**
 * goals-store.ts — Persisted reading goals store.
 * Uses the same withPersist pattern as settings-store for FS JSON persistence.
 */
import { create } from "zustand";
import type { ReadingGoal } from "../stats/schema";
import { withPersist } from "./persist";

export interface GoalsState {
  goals: ReadingGoal[];
  _hasHydrated: boolean;

  addGoal: (goal: ReadingGoal) => void;
  updateGoal: (
    id: string,
    updates: Partial<Pick<ReadingGoal, "target" | "type" | "period">>,
  ) => void;
  removeGoal: (id: string) => void;
}

export const useGoalsStore = create<GoalsState>(
  withPersist(
    "goals",
    (set) => ({
      goals: [],
      _hasHydrated: false,

      addGoal: (goal) => set((state) => ({ goals: [...state.goals, goal] })),

      updateGoal: (id, updates) =>
        set((state) => ({
          goals: state.goals.map((g) => (g.id === id ? { ...g, ...updates } : g)),
        })),

      removeGoal: (id) =>
        set((state) => ({
          goals: state.goals.filter((g) => g.id !== id),
        })),
    }),
    { _hasHydrated: false } as Partial<GoalsState>,
  ),
);
