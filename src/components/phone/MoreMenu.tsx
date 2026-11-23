import {
  ArrowDownAZIcon,
  ArrowDownWideNarrowIcon,
  FolderPlusIcon,
} from "lucide-react";
import { usePhoneNav } from "./nav";
import { usePhonePrefs } from "./prefs";

const ITEM_CLASS =
  "flex h-13 w-full items-center gap-4 px-4 text-left outline-none active:bg-accent [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

/**
 * The ⋮ menu of home and folders, under the top bar's right end. A tap
 * outside or Back closes it.
 */
export function MoreMenu({
  folder,
  onClose,
}: {
  folder: string;
  onClose: () => void;
}) {
  const replace = usePhoneNav((s) => s.replace);
  const sortByDate = usePhonePrefs((s) => s.sortByDate);
  const setSortByDate = usePhonePrefs((s) => s.setSortByDate);

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close menu"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="menu"
        className="absolute top-[calc(var(--safe-area-top,env(safe-area-inset-top))+3.5rem)] right-2 w-58 rounded-xl border bg-popover py-2 text-popover-foreground shadow-lg"
      >
        <button
          type="button"
          role="menuitem"
          className={ITEM_CLASS}
          onClick={() => replace({ kind: "new-folder", parent: folder })}
        >
          <FolderPlusIcon />
          New folder
        </button>
        <button
          type="button"
          role="menuitem"
          className={ITEM_CLASS}
          onClick={() => {
            setSortByDate(!sortByDate);
            onClose();
          }}
        >
          {sortByDate ? <ArrowDownAZIcon /> : <ArrowDownWideNarrowIcon />}
          {sortByDate ? "Sort by name" : "Sort by date edited"}
        </button>
      </div>
    </div>
  );
}
