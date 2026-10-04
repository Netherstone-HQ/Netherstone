import { useEffect } from "react";
import { useUIStore } from "@/store/ui";

export function useSearchModal() {
  const isOpen = useUIStore((s) => s.isSearchModalOpen);
  const setIsOpen = useUIStore((s) => s.setSearchModalOpen);
  const toggleSearchModal = useUIStore((s) => s.toggleSearchModal);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // CMD+K on Mac, CTRL+K on Windows/Linux
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        toggleSearchModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSearchModal]);

  return { isOpen, setIsOpen };
}
