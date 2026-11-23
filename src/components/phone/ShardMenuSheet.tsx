import { useState } from "react";
import {
  ArrowDownUpIcon,
  HistoryIcon,
  Link2Icon,
  ListTreeIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
} from "lucide-react";
import {
  BottomSheet,
  BottomSheetItem,
  BottomSheetSeparator,
} from "@/components/ui/bottom-sheet";
import { LinkedFromSection } from "@/components/sidebar/right-sidebar/LinkedFromSection";
import { LinksSection } from "@/components/sidebar/right-sidebar/LinksSection";
import { OutlineSection } from "@/components/sidebar/right-sidebar/OutlineSection";
import {
  useIndexedShard,
  useShardLinks,
} from "@/components/sidebar/right-sidebar/useShardInfo";
import { useVaultItem } from "@/components/vault/useVaultItem";
import { openFileHistory } from "@/lib/open-vault-file";
import { NameSheet } from "./NameSheet";
import { usePhoneNav } from "./nav";

type Part = "menu" | "outline" | "links" | "rename";

/** The open shard's menu: what's in it, its history, and file actions. */
export function ShardMenuSheet({
  path,
  open,
  onOpenChange,
}: {
  path: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [part, setPart] = useState<Part>("menu");
  const name = path.split(/[\\/]/).pop() ?? path;
  const item = useVaultItem({ name, path, kind: "file" });
  const links = useShardLinks(open);
  const indexed = useIndexedShard(open);
  const replace = usePhoneNav((s) => s.replace);

  const close = (next: boolean) => {
    if (!next) setPart("menu");
    onOpenChange(next);
  };

  return (
    <>
      <BottomSheet
        open={open && part === "menu"}
        onOpenChange={close}
        title={item.displayName}
      >
        <BottomSheetItem icon={<ListTreeIcon />} onClick={() => setPart("outline")}>
          Outline
        </BottomSheetItem>
        <BottomSheetItem
          icon={<Link2Icon />}
          onClick={() => setPart("links")}
          end={<span className="text-sm">{links.length}</span>}
        >
          Links
        </BottomSheetItem>
        <BottomSheetItem
          icon={<HistoryIcon />}
          onClick={() => {
            replace({ kind: "history" });
            void openFileHistory(path).catch((error: unknown) =>
              console.error("[Netherstone] Couldn't show history:", error),
            );
          }}
        >
          Show history
        </BottomSheetItem>
        <BottomSheetSeparator />
        <BottomSheetItem
          icon={item.isPinned ? <PinOffIcon /> : <PinIcon />}
          onClick={() => {
            item.togglePin();
            close(false);
          }}
        >
          {item.isPinned ? "Unpin" : "Pin"}
        </BottomSheetItem>
        <BottomSheetItem icon={<PencilIcon />} onClick={() => setPart("rename")}>
          Rename
        </BottomSheetItem>
        <BottomSheetItem
          icon={<ArrowDownUpIcon />}
          onClick={() => {
            item.startMove();
            close(false);
          }}
        >
          Move
        </BottomSheetItem>
        <BottomSheetSeparator />
        <BottomSheetItem
          danger
          icon={<Trash2Icon />}
          onClick={() => {
            close(false);
            item.trash();
          }}
        >
          Move to trash
        </BottomSheetItem>
      </BottomSheet>

      <BottomSheet
        open={open && part === "outline"}
        onOpenChange={close}
        title="Outline"
        height="half"
      >
        <div className="px-2 pb-4">
          <OutlineSection />
        </div>
      </BottomSheet>

      <BottomSheet
        open={open && part === "links"}
        onOpenChange={close}
        title="Links"
        height="half"
      >
        <div className="px-2 pb-4">
          <LinksSection links={links} />
          <LinkedFromSection backlinks={indexed?.linkedFrom ?? null} />
        </div>
      </BottomSheet>

      <NameSheet
        open={open && part === "rename"}
        onOpenChange={close}
        title="Rename"
        initialName={item.displayName}
        submitLabel="Rename"
        onCreate={async (next) => {
          try {
            await item.renameTo(next);
            close(false);
            return null;
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        }}
      />
      {item.dialogs}
    </>
  );
}
