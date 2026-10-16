import { useEffect, useState } from "react";

import {
  CreateVaultForm,
  type VaultChoice,
} from "@/components/onboarding/VaultStep";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { defaultVaultLocation } from "@/lib/commands";
import { openEditorFile } from "@/lib/open-editor-file";

/**
 * Creates a vault and switches to it, with the same form and Start here
 * guide as the welcome tour.
 */
export function NewVaultDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [location, setLocation] = useState<string | null>(null);

  useEffect(() => {
    if (!open || location) return;
    void defaultVaultLocation()
      .then(setLocation)
      .catch(() => {});
  }, [location, open]);

  function created({ startHerePath }: VaultChoice) {
    onOpenChange(false);
    if (startHerePath) void openEditorFile(startHerePath);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New vault</DialogTitle>
          <DialogDescription>
            Netherstone makes a new folder and switches to it.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <CreateVaultForm
            location={location}
            onLocationChange={setLocation}
            onCreated={created}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
