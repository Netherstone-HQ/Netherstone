import { useMemo } from "react";
import { SearchIcon, TagIcon } from "lucide-react";

import { SectionHeader } from "@/components/sidebar/SectionHeader";
import {
  ACTIVE_ROW_CLASS,
  ROW_BUTTON_CLASS,
  ROW_CLASS,
  RowSlot,
  getRowIndent,
} from "@/components/vault/tree-layout";
import { countTags, matchesTagFilter } from "@/lib/tags";
import { cn } from "@/lib/utils";
import { selectActiveTag, useTagsStore } from "@/store/tags";

/** Takes Search's place in the sidebar while Tags is open. */
export function TagFilterField() {
  const filter = useTagsStore((s) => s.filter);
  const setFilter = useTagsStore((s) => s.setFilter);

  return (
    <label className="flex h-8 w-full cursor-text items-center gap-1.5 rounded-md border border-sidebar-border bg-sidebar-accent/25 px-2.5 text-ui-sm shadow-xs transition-colors focus-within:ring-2 focus-within:ring-sidebar-ring">
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
      <input
        type="search"
        aria-label="Filter tags"
        placeholder="Filter tags"
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

function TagRow({
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

/** The sidebar's tag list in Tags mode: All tagged, then each tag. */
export function TagList() {
  const files = useTagsStore((s) => s.files);
  const status = useTagsStore((s) => s.status);
  const filter = useTagsStore((s) => s.filter);
  const activeTag = useTagsStore(selectActiveTag);
  const selectTag = useTagsStore((s) => s.selectTag);
  const tags = useMemo(() => countTags(files), [files]);
  const shownTags = tags.filter(({ tag }) => matchesTagFilter(tag, filter));

  if (status !== "ready") return null;

  return (
    <section aria-label="Tags" className="shrink-0">
      <SectionHeader label="Tags" />
      {tags.length === 0 ? (
        <p className="px-1.5 py-1 text-ui-sm text-muted-foreground">
          No tags yet
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          <TagRow
            icon={<TagIcon className="size-4 text-muted-foreground" />}
            label="All tagged"
            count={files.length}
            isActive={activeTag === null}
            onClick={() => selectTag(null)}
          />
          {shownTags.map(({ tag, count }) => (
            <TagRow
              key={tag}
              icon={<span className="text-ui-sm text-muted-foreground">#</span>}
              label={tag}
              count={count}
              isActive={activeTag === tag}
              onClick={() => selectTag(tag)}
            />
          ))}
          {shownTags.length === 0 ? (
            <li className="px-1.5 py-1 text-ui-sm text-muted-foreground">
              No tags match “{filter.trim()}”
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
