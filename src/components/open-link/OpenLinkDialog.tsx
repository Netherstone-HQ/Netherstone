import { useEffect, useState } from "react";
import { LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";

import { CreateVaultForm } from "@/components/onboarding/VaultStep";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Dot } from "@/components/ui/dot";
import { Progress } from "@/components/ui/progress";
import { defaultVaultLocation, type LinkListing, type LinkRefusal } from "@/lib/commands";
import {
  cancelOpeningLink,
  closeLink,
  createVaultFromLink,
  isOpeningLink,
  useOpenLink,
  type LinkStep,
} from "@/lib/open-link";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store";
import { copy } from "./copy";

/**
 * Asks before a Netherstone link makes a vault: a template from
 * netherstone.app, or any other folder with what's in it and where it's
 * from. Then shows the download, and what went wrong if it did.
 */
export function OpenLinkDialog() {
  const step = useOpenLink((s) => s.step);
  const [location, setLocation] = useState<string | null>(null);

  useEffect(() => {
    if (!step || location) return;
    void defaultVaultLocation()
      .then(setLocation)
      .catch(() => {});
  }, [location, step]);

  const busy = step?.kind === "downloading" || step?.kind === "adding";

  return (
    <Dialog open={step !== null} onOpenChange={(open) => !open && closeLink()}>
      <DialogContent
        // Nothing to describe while the link is looked up.
        {...(step?.kind === "listing" ? { "aria-describedby": undefined } : {})}
        showCloseButton={!busy}
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (isOpeningLink()) event.preventDefault();
        }}
      >
        {step?.kind === "listing" ? (
          <>
            <DialogTitle className="sr-only">{copy.listing}</DialogTitle>
            <LoaderCircleIcon className="mx-auto size-5 animate-spin text-muted-foreground" />
          </>
        ) : step?.kind === "refused" ? (
          <Refused refusal={step.refusal} name={step.name} />
        ) : step ? (
          <Opening step={step} location={location} onLocationChange={setLocation} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Opening({
  step,
  location,
  onLocationChange,
}: {
  step: Exclude<LinkStep, { kind: "listing" } | { kind: "refused" }>;
  location: string | null;
  onLocationChange: (location: string) => void;
}) {
  const { listing } = step;
  // A template downloads in a moment, so its form stays with the button
  // saying so; a folder's download shows how far it got, once the name and
  // the space are checked and it starts.
  const progress =
    !listing.template && step.kind !== "ready" ? progressLine(step) : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {listing.template ? copy.template.title(listing.name) : copy.folder.title(listing.name)}
        </DialogTitle>
        <DialogDescription className={cn(!listing.template && "font-mono text-xs")}>
          {listing.template ? copy.template.from : listing.address}
        </DialogDescription>
      </DialogHeader>
      {progress ? (
        <>
          <div className="space-y-2">
            <Progress value={progress.value} />
            <p className="text-muted-foreground">{progress.text}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={cancelOpeningLink}>
              {copy.folder.cancel}
            </Button>
          </DialogFooter>
        </>
      ) : (
        <>
          {listing.template ? null : <FolderContents listing={listing} />}
          <CreateVaultForm
            location={location}
            onLocationChange={onLocationChange}
            onCreated={() => {}}
            defaultName={listing.name}
            create={createVaultFromLink}
            busyLabel={listing.template ? copy.template.downloading(listing.name) : undefined}
          />
        </>
      )}
    </>
  );
}

/** The bar and the line under it while a folder downloads and is added. */
function progressLine(step: Extract<LinkStep, { kind: "downloading" } | { kind: "adding" }>) {
  if (step.kind === "adding") {
    const { done = 0, total = step.listing.shards } = step.progress ?? {};
    return { value: 100, text: copy.folder.adding(done, total) };
  }
  const progress = step.progress;
  if (!progress) return null;
  const value = progress.totalBytes ? (progress.bytes / progress.totalBytes) * 100 : 0;
  const line = progress.stage === "template" ? copy.folder.downloading.shards : copy.folder.downloading[progress.stage];
  return { value, text: line(progress.done, progress.total) };
}

function FolderContents({ listing }: { listing: LinkListing }) {
  return (
    <>
      <div className="space-y-2 rounded-lg border px-3.5 py-3">
        <div>
          {copy.folder.shards(listing.shards)}
          {listing.drawings ? (
            <>
              <Dot />
              {copy.folder.drawings(listing.drawings)}
            </>
          ) : null}
          {listing.pictures ? (
            <>
              <Dot />
              {copy.folder.pictures(listing.pictures)}
            </>
          ) : null}
          <Dot />
          {formatSize(listing.size)}
        </div>
        {listing.leftOut ? (
          <div className="text-muted-foreground">{copy.folder.leftOut(listing.leftOut)}</div>
        ) : null}
      </div>
      <p className="flex items-start gap-2.5 text-amber-700 dark:text-amber-300">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{copy.folder.warning}</span>
      </p>
    </>
  );
}

function Refused({ refusal, name }: { refusal: LinkRefusal; name: string | null }) {
  const { title, body } = refusedText(refusal, name);
  const update = refusal.code === "update-first";

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{body}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        {update ? (
          <>
            <Button variant="outline" onClick={closeLink}>
              {copy.refused.updateFirst.notNow}
            </Button>
            <Button
              onClick={() => {
                closeLink();
                useUIStore.getState().openSettings("about");
              }}
            >
              {copy.refused.updateFirst.update}
            </Button>
          </>
        ) : (
          <Button onClick={closeLink}>{copy.refused.ok}</Button>
        )}
      </DialogFooter>
    </>
  );
}

function refusedText(refusal: LinkRefusal, name: string | null) {
  const text = copy.refused;
  switch (refusal.code) {
    case "update-first":
      return { title: text.updateFirst.title, body: text.updateFirst.body(refusal.name ?? name, refusal.version) };
    case "template-not-found":
      return text.templateNotFound;
    case "not-enough-space":
      return {
        title: text.notEnoughSpace.title,
        body: text.notEnoughSpace.body(name ?? "", formatSize(refusal.needed), refusal.folder, formatSize(refusal.free)),
      };
    case "cant-open":
      return text.cantOpen;
    case "nothing-to-open":
      return text.nothingToOpen;
    case "too-many-files":
      return text.tooManyFiles;
    default:
      return { title: text.downloadFailed.title(name), body: text.downloadFailed.body };
  }
}

/** `41 MB`: whole numbers from 10 up, one decimal under. */
export function formatSize(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${shown} ${units[unit]}`;
}
