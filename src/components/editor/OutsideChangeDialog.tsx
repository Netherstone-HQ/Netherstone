import { useState } from "react";
import { LoaderCircleIcon } from "lucide-react";

import { VersionPreview } from "@/components/sync/ConflictDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { flushPendingAutosave } from "@/hooks/useAutosave";
import { keepVersion, type KeptVersion } from "@/lib/outside-changes";
import { fileName } from "@/lib/sync";
import { useEditorStore } from "@/store/editor";

const bytes = (text: string) => new TextEncoder().encode(text).length;

/**
 * Asks which version to keep when the open shard changed outside the app in
 * the part being edited. Until the user decides, nothing is saved and their
 * version stays on screen.
 */
export function OutsideChangeDialog() {
  const change = useEditorStore((s) => s.outsideChange);
  const [choosing, setChoosing] = useState<KeptVersion | null>(null);

  async function choose(choice: KeptVersion) {
    setChoosing(choice);
    try {
      await keepVersion(choice);
      await flushPendingAutosave();
    } catch (error) {
      console.error("[Netherstone] Couldn't keep the chosen version:", error);
    } finally {
      setChoosing(null);
    }
  }

  const name = change ? fileName(change.path) : "";
  const dot = name.lastIndexOf(".");
  const copyName =
    dot > 0
      ? `${name.slice(0, dot)} (Changed outside)${name.slice(dot)}`
      : `${name} (Changed outside)`;

  return (
    <Dialog open={change !== null}>
      <DialogContent
        className="sm:max-w-2xl"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Choose which version to keep</DialogTitle>
          <DialogDescription>
            <span className="text-foreground">{name}</span> changed outside
            Netherstone while you were editing it. Your version is on screen
            until you choose.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <VersionPreview
            label="Your version"
            text={change?.mine}
            bytes={change ? bytes(change.mine) : null}
            loading={false}
          />
          <VersionPreview
            label="Outside version"
            text={change?.outside}
            bytes={change ? bytes(change.outside) : null}
            loading={false}
          />
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            disabled={choosing !== null}
            onClick={() => void choose("both")}
            title={`Your version keeps the name; the outside one is saved as ${copyName}`}
          >
            {choosing === "both" ? <LoaderCircleIcon className="animate-spin" /> : null}
            Keep both
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="outline"
              disabled={choosing !== null}
              onClick={() => void choose("outside")}
            >
              {choosing === "outside" ? <LoaderCircleIcon className="animate-spin" /> : null}
              Keep outside version
            </Button>
            <Button disabled={choosing !== null} onClick={() => void choose("mine")}>
              {choosing === "mine" ? <LoaderCircleIcon className="animate-spin" /> : null}
              Keep your version
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
