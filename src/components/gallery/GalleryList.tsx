import { FileIcon, ImagesIcon, SearchIcon } from "lucide-react";

import { SectionHeader } from "@/components/sidebar/SectionHeader";
import {
  ACTIVE_ROW_CLASS,
  ROW_BUTTON_CLASS,
  ROW_CLASS,
  RowSlot,
  getRowIndent,
} from "@/components/vault/tree-layout";
import { GALLERY_KINDS, filesInRow, type GalleryRow } from "@/lib/gallery";
import { cn } from "@/lib/utils";
import { selectActiveRow, useGalleryStore } from "@/store/gallery";
import { KIND_ICONS } from "./kind-icons";

/** Takes Search's place in the sidebar while the Gallery is open. */
export function GalleryFilterField() {
  const filter = useGalleryStore((s) => s.filter);
  const setFilter = useGalleryStore((s) => s.setFilter);

  return (
    <label className="flex h-8 w-full cursor-text items-center gap-1.5 rounded-md border border-sidebar-border bg-sidebar-accent/25 px-2.5 text-ui-sm shadow-xs transition-colors focus-within:ring-2 focus-within:ring-sidebar-ring">
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
      <input
        type="search"
        aria-label="Filter files"
        placeholder="Filter files"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && filter) {
            e.preventDefault();
            setFilter("");
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-sidebar-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
    </label>
  );
}

function FileRow({
  icon,
  label,
  count,
  isActive,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <div
        className={cn(ROW_CLASS, isActive && ACTIVE_ROW_CLASS)}
        style={{ paddingLeft: `${getRowIndent(0)}px` }}
      >
        <button
          type="button"
          aria-current={isActive || undefined}
          className={ROW_BUTTON_CLASS}
          onClick={onClick}
        >
          <RowSlot>{icon}</RowSlot>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="shrink-0 px-1 text-ui-sm text-muted-foreground tabular-nums">
            {count}
          </span>
        </button>
      </div>
    </li>
  );
}

/**
 * The sidebar's list in the Gallery: All files, each kind the vault has,
 * then the files no shard uses.
 */
export function GalleryList() {
  const files = useGalleryStore((s) => s.files);
  const status = useGalleryStore((s) => s.status);
  const activeRow = useGalleryStore(selectActiveRow);
  const selectRow = useGalleryStore((s) => s.selectRow);

  if (status !== "ready") return null;

  const row = (
    key: GalleryRow,
    label: string,
    icon: React.ElementType,
    count: number,
  ) => {
    const Icon = icon;
    return (
      <FileRow
        key={key}
        icon={<Icon className="size-4 text-muted-foreground" />}
        label={label}
        count={count}
        isActive={activeRow === key}
        onClick={() => selectRow(key)}
      />
    );
  };
  const unusedCount = filesInRow(files, "unused").length;

  return (
    <section aria-label="Files" className="shrink-0">
      <SectionHeader label="Files" />
      <ul className="flex flex-col gap-0.5">
        {row("all", "All files", ImagesIcon, files.length)}
        {GALLERY_KINDS.map(({ kind, label }) => {
          const count = filesInRow(files, kind).length;
          return count > 0 ? row(kind, label, KIND_ICONS[kind], count) : null;
        })}
      </ul>
      {unusedCount > 0 ? (
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {row("unused", "Not used", FileIcon, unusedCount)}
        </ul>
      ) : null}
    </section>
  );
}
