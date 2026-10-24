import {
  FileAudioIcon,
  FileIcon,
  FileTextIcon,
  FileVideoIcon,
  ImageIcon,
} from "lucide-react";

import { DrawingIcon } from "@/components/icons";
import type { GalleryKind } from "@/lib/gallery";

export const KIND_ICONS: Record<GalleryKind, React.ElementType> = {
  image: ImageIcon,
  drawing: DrawingIcon,
  pdf: FileTextIcon,
  audio: FileAudioIcon,
  video: FileVideoIcon,
  other: FileIcon,
};
