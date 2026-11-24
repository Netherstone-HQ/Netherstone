/**
 * Picking files through the WebView's own file input, for Android, where
 * the system picker hands back content links rather than file paths. The
 * files come with their names and bytes, ready to copy into the vault.
 */

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

/**
 * `file`, or a copy with a word for a name where Android made one up: the
 * photo picker names a file by its number ("1000000018.png" becomes
 * "picture.png"), and the camera by the time ("JPEG_20261124_194322_80871.jpg"
 * becomes "photo.jpg").
 */
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

/**
 * Lets the person pick files of `kind`, or with `camera`, take a picture or
 * a video with the camera app. Resolves with nothing when they go back.
 */
export function pickFiles(
  kind: PickKind,
  { multiple = false, camera = false }: { multiple?: boolean; camera?: boolean } = {},
): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT_BY_KIND[kind];
    input.multiple = multiple;
    input.hidden = true;
    if (camera) input.setAttribute("capture", "environment");
    // In the page while the picker is open: an input nothing holds can be
    // collected while the picker or camera runs, and its change is lost.
    document.body.append(input);
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener(
      "change",
      () => done(Array.from(input.files ?? [], (file) => named(file, kind, camera))),
      { once: true },
    );
    input.addEventListener("cancel", () => done([]), { once: true });
    input.click();
  });
}
