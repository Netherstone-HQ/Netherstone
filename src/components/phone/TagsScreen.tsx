import { HashIcon } from "lucide-react";
import { countTags } from "@/lib/tags";
import { useTagsStore } from "@/store/tags";
import { usePhoneNav } from "./nav";
import { PhoneBackButton, PhoneFrame, PhoneTitle, PhoneTopBar } from "./parts";
import { useTaggedFiles } from "./SearchScreen";

/** Every tag in the vault, by name, with how many shards use it. */
export function TagsScreen() {
  const files = useTaggedFiles();
  const status = useTagsStore((s) => s.status);
  const push = usePhoneNav((s) => s.push);
  const tags = countTags(files).sort((a, b) => a.tag.localeCompare(b.tag));

  return (
    <PhoneFrame>
      <PhoneTopBar>
        <PhoneBackButton />
        <PhoneTitle>Tags</PhoneTitle>
      </PhoneTopBar>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {status === "error" ? (
          <p className="px-4 pt-20 text-center text-muted-foreground">
            Tags couldn't be loaded.
          </p>
        ) : status === "ready" && tags.length === 0 ? (
          <p className="px-4 pt-20 text-center text-muted-foreground">
            No tags yet. Type # and a word anywhere in a shard.
          </p>
        ) : (
          tags.map(({ tag, count }) => (
            <button
              key={tag}
              type="button"
              className="flex h-14 w-full items-center gap-3 px-4 text-left outline-none active:bg-accent"
              onClick={() =>
                push({ kind: "search", filter: { kind: "tag", tag } })
              }
            >
              <HashIcon className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{tag}</span>
              <span className="text-sm text-muted-foreground">{count}</span>
            </button>
          ))
        )}
      </div>
    </PhoneFrame>
  );
}
