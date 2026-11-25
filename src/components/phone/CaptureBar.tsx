import { CameraIcon, MicIcon, PlusIcon } from "lucide-react";
import { DrawingIcon } from "@/components/icons";
import { PhoneBottomBar, PhoneIconButton } from "./parts";
import {
  createDrawingIn,
  createPhotoShard,
  createVoiceNoteShard,
  createUntitledShard,
} from "./create";

/**
 * The bar along the bottom of home and folders: ways to capture on the
 * left, and + for a new shard, in `folder`.
 */
export function CaptureBar({
  vaultPath,
  folder,
}: {
  vaultPath: string;
  folder: string;
}) {
  return (
    <PhoneBottomBar className="h-20 items-center pr-4 pl-1">
      <PhoneIconButton
        label="Record a voice note"
        onClick={() => void createVoiceNoteShard(vaultPath, folder)}
      >
        <MicIcon />
      </PhoneIconButton>
      <PhoneIconButton
        label="Take a photo"
        onClick={() => void createPhotoShard(vaultPath, folder)}
      >
        <CameraIcon />
      </PhoneIconButton>
      <PhoneIconButton
        label="New drawing"
        onClick={() => void createDrawingIn(vaultPath, folder)}
      >
        <DrawingIcon />
      </PhoneIconButton>
      <div className="flex-1" />
      <button
        type="button"
        aria-label="New shard"
        className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground outline-none active:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => void createUntitledShard(vaultPath, folder)}
      >
        <PlusIcon className="size-6" strokeWidth={2} />
      </button>
    </PhoneBottomBar>
  );
}
