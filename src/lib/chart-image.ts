/**
 * Turns a chart drawn on screen into a PNG. The SVG takes its colours from
 * the theme through CSS, which an image doesn't have, so the colours each
 * part is drawn in are written onto a copy first.
 */

const PAINTED = ["fill", "stroke", "opacity", "font-family", "font-size"];

function inlineStyles(source: Element, copy: Element) {
  const style = getComputedStyle(source);
  const declarations = PAINTED.map(
    (name) => `${name}:${style.getPropertyValue(name)}`,
  ).join(";");
  copy.setAttribute("style", declarations);
  copy.removeAttribute("class");
  for (let i = 0; i < source.children.length; i++) {
    const child = copy.children[i];
    if (child) inlineStyles(source.children[i], child);
  }
}

const PADDING = 16;
const TITLE_HEIGHT = 28;
const LEGEND_HEIGHT = 26;

/**
 * A PNG of `svg` at `scale` times its size on screen, on `background`, with
 * the chart's title above it and, for more than one series, its legend
 * below, so the picture reads on its own.
 */
export async function chartPng(
  svg: SVGSVGElement,
  {
    background,
    title,
    legend,
    scale = 2,
  }: {
    background: string;
    title: string;
    /** Each series' name and the colour it's drawn in. */
    legend: { name: string; color: string }[];
    scale?: number;
  },
): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = svg.getBoundingClientRect();
  const copy = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, copy);
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(width));
  copy.setAttribute("height", String(height));
  // Hit targets and hover marks don't belong in the picture.
  copy.querySelectorAll('rect[fill="transparent"]').forEach((r) => r.remove());

  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(copy)], {
      type: "image/svg+xml",
    }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();

    const style = getComputedStyle(svg);
    const text = style.color;
    const muted =
      getComputedStyle(svg.querySelector("text") ?? svg).fill || text;
    const font = style.fontFamily;
    const showLegend = legend.length > 1;
    const fullWidth = width + PADDING * 2;
    const fullHeight =
      PADDING +
      TITLE_HEIGHT +
      height +
      (showLegend ? LEGEND_HEIGHT : 0) +
      PADDING;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(fullWidth * scale);
    canvas.height = Math.round(fullHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas isn't available");
    context.scale(scale, scale);
    context.fillStyle = background;
    context.fillRect(0, 0, fullWidth, fullHeight);

    context.textBaseline = "middle";
    context.fillStyle = text;
    context.font = `500 14px ${font}`;
    context.fillText(title, PADDING, PADDING + TITLE_HEIGHT / 2 - 4);
    context.drawImage(image, PADDING, PADDING + TITLE_HEIGHT, width, height);

    if (showLegend) {
      let x = PADDING;
      const y = PADDING + TITLE_HEIGHT + height + LEGEND_HEIGHT / 2 + 2;
      context.font = `13px ${font}`;
      for (const entry of legend) {
        context.fillStyle = entry.color;
        context.beginPath();
        context.roundRect(x, y - 5, 10, 10, 2);
        context.fill();
        context.fillStyle = muted;
        context.fillText(entry.name, x + 16, y);
        x += 16 + context.measureText(entry.name).width + 16;
      }
    }

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("No image"))),
        "image/png",
      ),
    );
    return { blob, width: fullWidth, height: fullHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * A drawing holding the picture, so a chart can be annotated in Canvas.
 * Canvas fills in the rest of each element when it loads the file.
 */
export function drawingWithImage({
  dataUrl,
  width,
  height,
}: {
  dataUrl: string;
  width: number;
  height: number;
}) {
  const fileId = crypto.randomUUID().replace(/-/g, "");
  const now = Date.now();
  return JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: "netherstone",
      elements: [
        {
          id: crypto.randomUUID(),
          type: "image",
          // Clear of Canvas's menu and toolbar when it opens.
          x: 40,
          y: 120,
          width,
          height,
          angle: 0,
          strokeColor: "transparent",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 1,
          strokeStyle: "solid",
          roughness: 0,
          opacity: 100,
          groupIds: [],
          frameId: null,
          roundness: null,
          seed: Math.floor(Math.random() * 2 ** 31),
          version: 1,
          versionNonce: Math.floor(Math.random() * 2 ** 31),
          isDeleted: false,
          boundElements: null,
          updated: now,
          link: null,
          locked: false,
          status: "saved",
          fileId,
          scale: [1, 1],
          crop: null,
        },
      ],
      appState: {},
      files: {
        [fileId]: {
          id: fileId,
          mimeType: "image/png",
          dataURL: dataUrl,
          created: now,
          lastRetrieved: now,
        },
      },
    },
    null,
    2,
  );
}
