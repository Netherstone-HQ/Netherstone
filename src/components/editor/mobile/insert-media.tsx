import {
  CameraIcon,
  FileIcon,
  FilmIcon,
  ImageIcon,
  Music2Icon,
  VideoIcon,
} from "lucide-react";
import { KEYS } from "platejs";
import type { PlateEditor } from "platejs/react";
import { toast } from "sonner";
import { insertManagedMediaFiles } from "@/components/editor/lib/media-insert";
import type { InsertGroup } from "@/components/ui/insert-toolbar-button";
import { insertBlock } from "@/components/transforms";
import { pickFiles, type PickKind } from "@/lib/pick-files";

const NODE_TYPE: Record<PickKind, string> = {
  image: KEYS.img,
  video: KEYS.video,
  audio: KEYS.audio,
  file: KEYS.file,
};

/**
 * Lets the person pick files of `kind` (or take a picture with the camera),
 * copies them into the vault and puts them at the caret.
 */
async function insertPickedMedia(
  editor: PlateEditor,
  kind: PickKind,
  options: { camera?: boolean } = {},
) {
  const files = await pickFiles(kind, {
    multiple: !options.camera,
    camera: options.camera,
  });
  if (files.length === 0) return;
  try {
    await insertManagedMediaFiles(editor, files, {
      preferredType: NODE_TYPE[kind],
      select: true,
    });
  } catch (error) {
    toast.error("Couldn't add it to the shard", {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The phone's Media group of Insert: pictures, the camera, video, sound and
 * other files come from the phone and are copied into the vault.
 */
export const phoneMediaGroup: InsertGroup = {
  group: "Media",
  items: [
    {
      icon: <ImageIcon />,
      label: "Picture",
      value: "picture",
      onSelect: (editor) => void insertPickedMedia(editor, "image"),
    },
    {
      icon: <CameraIcon />,
      label: "Take a photo",
      value: "photo",
      onSelect: (editor) =>
        void insertPickedMedia(editor, "image", { camera: true }),
    },
    {
      icon: <VideoIcon />,
      label: "Video",
      value: "video",
      onSelect: (editor) => void insertPickedMedia(editor, "video"),
    },
    {
      icon: <Music2Icon />,
      label: "Sound",
      value: "audio",
      onSelect: (editor) => void insertPickedMedia(editor, "audio"),
    },
    {
      icon: <FileIcon />,
      label: "File",
      value: "file",
      onSelect: (editor) => void insertPickedMedia(editor, "file"),
    },
    {
      icon: <FilmIcon />,
      label: "Embed",
      value: KEYS.mediaEmbed,
      onSelect: (editor, value) => insertBlock(editor, value),
    },
  ],
};
