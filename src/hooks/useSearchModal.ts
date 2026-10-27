import { useUIStore } from "@/store/ui";

/** Whether the search modal is open. Its shortcut is in `useAppShortcuts`. */
export function useSearchModal() {
  const isOpen = useUIStore((s) => s.isSearchModalOpen);
  const setIsOpen = useUIStore((s) => s.setSearchModalOpen);

  return { isOpen, setIsOpen };
}
