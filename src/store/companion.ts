import { create } from "zustand";

// Not persisted: once shown, the companion stays until the app restarts.
interface CompanionState {
  visible: boolean;
  show: () => void;
}

export const useCompanionStore = create<CompanionState>()((set) => ({
  visible: false,
  show: () => set({ visible: true }),
}));
