import { useEffect } from "react";
import { hasModKey } from "@/lib/platform";
import { useUIStore } from "@/store/ui";

export function useSearchModal() {
  const isOpen = useUIStore((s) => s.isSearchModalOpen);
  const setIsOpen = useUIStore((s) => s.setSearchModalOpen);
  const toggleSearchModal = useUIStore((s) => s.toggleSearchModal);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ⌘K on a Mac, Ctrl+K elsewhere. Caught first and marked handled, so
      // the editor's own Ctrl+K (a link box) doesn't open and take focus.
      if (hasModKey(e) && e.key === "k") {
        e.preventDefault();
        toggleSearchModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [toggleSearchModal]);

  return { isOpen, setIsOpen };
}
