import { useId } from "react";
import { LoaderCircleIcon } from "lucide-react";

import type { Models } from "@/components/assistant/models";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { KeyStorage, ProviderError } from "@/lib/commands";

export function hostOf(address: string): string {
  return address.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

export function Spinner() {
  return <LoaderCircleIcon className="size-4 animate-spin" />;
}

/** What a saved provider says next to its name. */
export function Saved({
  children,
  live = true,
}: {
  children: React.ReactNode;
  /** Whether it's answering now: a stopped server has no green dot. */
  live?: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap items-center">
      {live ? (
        <span className="mr-2 inline-block size-1.5 rounded-full bg-emerald-500" />
      ) : null}
      {children}
    </span>
  );
}

export function modelCount(
  models: Models | undefined,
  failed: string,
): React.ReactNode {
  if (!models || models.state === "loading") return "Listing models";
  if (models.state === "failed") return failed;
  const count = models.models.length;
  return count === 1 ? "1 model" : `${count} models`;
}

export function storageLine(storage: KeyStorage | null): string | null {
  if (storage === "file") {
    return "This computer has no keyring, so the key is in a file only you can open";
  }
  if (storage === "memory") {
    return "You'll add it again next time you open Netherstone";
  }
  return null;
}

/** The words for why a provider couldn't be used. */
export function errorText(kind: ProviderError["kind"], name: string): string {
  switch (kind) {
    case "keyRefused":
      return `${name} didn't accept this key`;
    case "unreachable":
      return `Couldn't reach ${name}`;
    case "rateLimited":
      return `${name} is busy, try again in a moment`;
    case "noModels":
      return "No models found at this address";
    case "insecure":
      return "Use an https address to send a key to another computer";
    case "notLocal":
      return "Use an address on this computer, or set it up as Custom";
    case "badAddress":
      return "This isn't a web address";
    case "storage":
      return "Couldn't save the key on this computer";
    case "failed":
      return `Something went wrong with ${name}`;
  }
}

/** Shown without a keyring: whether to keep keys in a file or this run only. */
export function RememberChoice({
  remember,
  onChange,
}: {
  remember: boolean;
  onChange: (remember: boolean) => void;
}) {
  const id = useId();
  return (
    <Label htmlFor={id} className="font-normal">
      <Checkbox
        id={id}
        checked={remember}
        onCheckedChange={(checked) => onChange(checked === true)}
      />
      Keep the key on this computer
    </Label>
  );
}

export function ProviderRow({
  name,
  description,
  actions,
  children,
}: {
  name: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-6 px-4 py-3.5">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="font-medium text-ui">{name}</div>
          {description ? (
            <div className="space-y-0.5 text-muted-foreground text-ui-sm leading-5">
              {description}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children ? <div className="space-y-2 px-4 pb-4">{children}</div> : null}
    </div>
  );
}

export function ErrorLine({ children }: { children: React.ReactNode }) {
  return <p className="text-destructive text-ui-sm leading-5">{children}</p>;
}
