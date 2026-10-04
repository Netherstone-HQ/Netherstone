import {
  MagnifyingGlassIcon,
  ScribbleIcon,
  TextTIcon,
} from "@phosphor-icons/react";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { copy } from "./copy";
import { Step } from "./StepLayout";
import type { VaultChoice } from "./VaultStep";

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

export function ReadyStep({
  vault,
  onBack,
  onFinish,
}: {
  vault: VaultChoice;
  onBack: () => void;
  onFinish: (addGuide: boolean) => void;
}) {
  // A new vault already has the guide; any other vault can get it here.
  const offerGuide = !vault.startHerePath;
  const [addGuide, setAddGuide] = useState(true);

  const body =
    vault.kind === "created"
      ? copy.ready.bodyNewVault
      : vault.kind === "restored"
        ? copy.ready.bodyRestored
        : copy.ready.body;

  const tips = [
    { icon: MagnifyingGlassIcon, text: copy.ready.tips.search(isMac ? "⌘K" : "Ctrl+K") },
    { icon: TextTIcon, text: copy.ready.tips.blocks },
    { icon: ScribbleIcon, text: copy.ready.tips.canvas },
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
          <li key={text} className="flex items-center gap-3 text-sm">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Icon className="size-4.5" />
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
      {offerGuide ? (
        <label className="mt-8 flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-4 text-sm">
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
