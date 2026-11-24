import {
  FolderInputIcon,
  PinIcon,
  PinOffIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useUIStore } from "@/store";
import { allPinned, pinAll, trashAll } from "./item-batch";
import { usePhoneNav } from "./nav";
import { PhoneIconButton, PhoneTitle, PhoneTopBar } from "./parts";
import { usePhoneSelection } from "./selection";

/** The top bar while picking shards: close, how many, and Select all. */
export function SelectTopBar({ shown }: { shown: string[] }) {
  const count = usePhoneSelection((s) => s.paths.length);
  const setPaths = usePhoneSelection((s) => s.set);
  const closeFrom = usePhoneNav((s) => s.closeFrom);
  return (
    <PhoneTopBar>
      <PhoneIconButton
        label="Stop selecting"
        onClick={() => closeFrom("select")}
      >
        <XIcon />
      </PhoneIconButton>
      <PhoneTitle>{count} selected</PhoneTitle>
      <button
        type="button"
        className="h-12 shrink-0 rounded-full px-3 font-medium outline-none active:bg-accent"
        onClick={() => setPaths([...new Set(shown)])}
      >
        Select all
      </button>
    </PhoneTopBar>
  );
}

/** The bottom bar while picking shards: Pin, Move and Delete. */
export function SelectActionBar() {
  const paths = usePhoneSelection((s) => s.paths);
  const unpin = useUIStore((s) => allPinned(s.pinnedFiles, paths));
  const push = usePhoneNav((s) => s.push);
  const none = paths.length === 0;
  return (
    <div className="shrink-0 border-t bg-sidebar pb-safe-bottom">
      <div className="flex h-20 items-center justify-around">
        <BarButton
          label={unpin ? "Unpin" : "Pin"}
          icon={unpin ? <PinOffIcon /> : <PinIcon />}
          disabled={none}
          onClick={() => pinAll(paths)}
        />
        <BarButton
          label="Move"
          icon={<FolderInputIcon />}
          disabled={none}
          onClick={() => push({ kind: "move", paths })}
        />
        <BarButton
          label="Delete"
          icon={<TrashIcon />}
          disabled={none}
          onClick={() => trashAll(paths)}
        />
      </div>
    </div>
  );
}

/** A labelled icon button in a bottom bar. */
export function BarButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="flex h-16 w-24 flex-col items-center justify-center gap-1.5 rounded-xl text-sm outline-none active:bg-accent disabled:opacity-40 [&_svg]:size-5"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
