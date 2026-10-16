import { SearchIcon, TypeIcon } from "lucide-react";
import { DrawingIcon } from "@/components/icons";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IS_MAC } from "@/lib/platform";
import { copy } from "./copy";
import { Step } from "./StepLayout";
import type { VaultChoice } from "./VaultStep";

export function ReadyStep({
  vault,
  replay,
  onBack,
  onFinish,
}: {
  vault: VaultChoice;
  /** Started again from Settings, on a vault that's already in use. */
  replay: boolean;
  onBack: () => void;
  onFinish: (addGuide: boolean) => void;
}) {
  // A new vault already has the guide; any other vault can get it here.
  const offerGuide = !vault.startHerePath;
  // On a replay the vault is in use already, so the guide is only added on
  // request.
  const [addGuide, setAddGuide] = useState(!replay);

  const body =
    vault.kind === "restored" ? copy.ready.bodyRestored : copy.ready.body;

  const tips = [
    { icon: SearchIcon, text: copy.ready.tips.search(IS_MAC ? "⌘K" : "Ctrl+K") },
    { icon: TypeIcon, text: copy.ready.tips.blocks },
    { icon: DrawingIcon, text: copy.ready.tips.canvas },
  ];

  return (
    <Step
      title={copy.ready.title}
      body={body}
      onBack={onBack}
      action={<Button onClick={() => onFinish(offerGuide && addGuide)}>{copy.ready.finish}</Button>}
    >
      <ul className="space-y-3">
        {tips.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-3 text-ui">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Icon className="size-4.5" />
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
      {offerGuide ? (
        <label className="mt-8 flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-4 text-ui">
          <Checkbox
            checked={addGuide}
            onCheckedChange={(checked) => setAddGuide(checked === true)}
          />
          {copy.ready.addGuide}
        </label>
      ) : null}
    </Step>
  );
}
