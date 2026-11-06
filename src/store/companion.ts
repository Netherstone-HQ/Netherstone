import { create } from "zustand";

/** Where the companion sits while he's the assistant (Companion.tsx). */
interface CompanionState {
  /** The panel's composer card, which he sits on while the panel is open. */
  perch: HTMLElement | null;
  /** Whether he's sitting there, so the messages leave room under him. */
  perched: boolean;
}

export const useCompanionStore = create<CompanionState>(() => ({
  perch: null,
  perched: false,
}));
