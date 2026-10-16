import { useEffect } from "react";
import { hasModKey } from "@/lib/platform";
import { useUIStore } from "@/store/ui";

export function useSearchModal() {
  const isOpen = useUIStore((s) => s.isSearchModalOpen);
  const setIsOpen = useUIStore((s) => s.setSearchModalOpen);
  const toggleSearchModal = useUIStore((s) => s.toggleSearchModal);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ⌘K on a Mac, Ctrl+K elsewhere
      if (hasModKey(e) && e.key === "k") {
        e.preventDefault();
        toggleSearchModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSearchModal]);

  return { isOpen, setIsOpen };
}
