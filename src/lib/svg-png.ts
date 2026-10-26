/**
 * Draws `svg` into a PNG at its own width and height. The SVG is drawn as
 * an image, so anything it uses, such as fonts, must be inside it.
 */
export async function svgToPng(svg: SVGSVGElement): Promise<Blob> {
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml",
    }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = svg.width.baseVal.value;
    canvas.height = svg.height.baseVal.value;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas isn't available");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("No image"))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
