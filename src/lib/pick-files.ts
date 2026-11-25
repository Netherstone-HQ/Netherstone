// Picking files through the WebView's file input: Android's picker gives
// content links, not paths.

/** The kinds of file a media block takes, as a file input's `accept`. */
const ACCEPT_BY_KIND = {
  image: "image/*",
  video: "video/*",
  audio: "audio/*",
  file: "*/*",
} as const;

export type PickKind = keyof typeof ACCEPT_BY_KIND;

/** What a picked file is called when Android gives it only a number. */
const NAME_BY_KIND: Record<PickKind, string> = {
  image: "picture",
  video: "video",
  audio: "sound",
  file: "file",
};

/** What a picture or video from the camera is called. */
const CAMERA_NAME = "photo";

/** `file`, renamed "picture.png" or "photo.jpg" where Android made up a number for a name. */
export function named(file: File, kind: PickKind, camera = false): File {
  const extension = /(\.[^.]+)?$/.exec(file.name)?.[1] ?? "";
  const stem = file.name.slice(0, file.name.length - extension.length);
  if (!camera && !/^\d+$/.test(stem)) return file;
  const word = camera ? CAMERA_NAME : NAME_BY_KIND[kind];
  return new File([file], `${word}${extension}`, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

/** Picks files of `kind`, or takes them with the camera. Empty when cancelled. */
export function pickFiles(
  kind: PickKind,
  { multiple = false, camera = false }: { multiple?: boolean; camera?: boolean } = {},
): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT_BY_KIND[kind];
    input.multiple = multiple;
    if (camera) input.setAttribute("capture", "environment");
    input.addEventListener(
      "change",
      () => resolve(Array.from(input.files ?? [], (file) => named(file, kind, camera))),
      { once: true },
    );
    input.addEventListener("cancel", () => resolve([]), { once: true });
    input.click();
  });
}
