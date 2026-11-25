import { useEffect, useState } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";

/** A sheet asking for a name. `onCreate` returns an error to show, or null. */
export function NameSheet({
  open,
  onOpenChange,
  title,
  initialName = "",
  submitLabel = "Create",
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initialName?: string;
  submitLabel?: string;
  onCreate: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setError(null);
  }, [open, initialName]);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(await onCreate(name.trim()));
    setBusy(false);
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="text-lg leading-6 font-semibold text-foreground">
          {title}
        </span>
      }
    >
      <form
        className="flex flex-col gap-5 px-4 pt-1 pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="text-sm text-muted-foreground">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={error !== null}
            className="h-12 rounded-[10px] border-[1.5px] border-input bg-background px-3.5 text-base outline-none focus:border-brand aria-invalid:border-destructive"
          />
          {error ? (
            <span className="text-sm text-destructive">{error}</span>
          ) : null}
        </label>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            className="h-11 px-4.5 text-base"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="h-11 px-4.5 text-base"
            disabled={!name.trim() || busy}
          >
            {submitLabel}
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
}
