import { ImportError, type ImportContext } from "../../types";
import { encodePng, unpackBits } from "./png";
import { BundledDataFactory, loadPdfJs } from "./pdfjs";

/** A piece of text as the PDF places it, in page pixels from the top left. */
export interface TextPiece {
  text: string;
  x: number;
  /** Baseline. */
  y: number;
  width: number;
  size: number;
  bold: boolean;
  italic: boolean;
  mono: boolean;
  /** The link this piece sits under, if any. */
  href?: string;
  /** Fill colour as `#rrggbb`, when the operators could be matched to the text. */
  color?: string;
}

export interface PagePicture {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Stored attachment link. */
  url: string;
}

/** A small filled shape: a bullet drawn as a dot or square instead of a character. */
export interface PageMark {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A straight horizontal or vertical line drawn on the page: a table border, a rule. */
export interface PageRule {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PageData {
  width: number;
  height: number;
  pieces: TextPiece[];
  pictures: PagePicture[];
  marks: PageMark[];
  rules: PageRule[];
}

type Matrix = [number, number, number, number, number, number];

function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

const BOLD_NAME = /bold|black|heavy|semibold|demibold|demi\b|-sb\b/i;
const ITALIC_NAME = /italic|oblique|-it\b/i;
const MONO_NAME = /mono|courier|consolas|menlo|monaco|inconsolata|lucida ?console|source ?code/i;

/** Smallest picture worth keeping, in page pixels; smaller ones are bullets and rules. */
const MIN_PICTURE = 24;

interface PdfFont {
  name?: string;
  bold?: boolean;
  black?: boolean;
  italic?: boolean;
  isMonospace?: boolean;
}

interface PdfImage {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
}

/**
 * Reads every page: its text pieces with their fonts and links, and the
 * pictures on it (stored as attachments as they are found).
 */
export async function extractPages(
  bytes: Uint8Array,
  context: ImportContext,
  onPage: (page: number, total: number) => void,
): Promise<{ pages: PageData[]; failedPictures: number }> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: bytes,
    // Raw pixels instead of browser bitmaps, so pictures can be saved.
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    fontExtraProperties: true,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
    BinaryDataFactory: BundledDataFactory,
  } as Parameters<typeof pdfjs.getDocument>[0]);

  let document;
  try {
    document = await task.promise;
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (name === "PasswordException") throw new ImportError("This PDF has a password. Remove it, then import it again.");
    throw new ImportError("This file isn't a PDF Netherstone can read, or it's damaged.");
  }

  const pages: PageData[] = [];
  let failedPictures = 0;
  let pictureCount = 0;
  const pictureLinks = new Map<string, string | null>();
  const baseName = context.file.name.replace(/\.[^.]+$/, "");

  try {
    for (let number = 1; number <= document.numPages; number += 1) {
      onPage(number, document.numPages);
      await context.checkpoint();
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const toPage = viewport.transform as Matrix;

      const operators = await page.getOperatorList();
      const text = await page.getTextContent();
      const annotations = (await page.getAnnotations()) as { subtype?: string; url?: string; rect?: number[] }[];

      const links = annotations
        .filter((annotation) => annotation.subtype === "Link" && annotation.url && annotation.rect)
        .map((annotation) => {
          const [x1, y1] = viewport.convertToViewportPoint(annotation.rect![0], annotation.rect![1]) as number[];
          const [x2, y2] = viewport.convertToViewportPoint(annotation.rect![2], annotation.rect![3]) as number[];
          return { url: annotation.url!, left: Math.min(x1, x2), right: Math.max(x1, x2), top: Math.min(y1, y2), bottom: Math.max(y1, y2) };
        });

      const fontCache = new Map<string, PdfFont | null>();
      const fontOf = (name: string): PdfFont | null => {
        if (!fontCache.has(name)) {
          let font: PdfFont | null = null;
          try {
            font = page.commonObjs.has(name) ? (page.commonObjs.get(name) as PdfFont) : null;
          } catch {
            font = null;
          }
          fontCache.set(name, font);
        }
        return fontCache.get(name)!;
      };

      const pieces: TextPiece[] = [];
      for (const item of text.items as { str?: string; transform?: number[]; width?: number; fontName?: string }[]) {
        if (!item.str || !item.transform) continue;
        const [a, b, c, d, e, f] = multiply(toPage, item.transform as Matrix);
        const size = Math.hypot(c, d) || Math.hypot(a, b);
        if (size < 1) continue;
        const font = fontOf(item.fontName ?? "");
        const family = (text.styles as Record<string, { fontFamily?: string }>)[item.fontName ?? ""]?.fontFamily ?? "";
        const fontName = font?.name ?? "";
        const piece: TextPiece = {
          text: item.str,
          x: e,
          y: f,
          width: (item.width ?? 0) * Math.hypot(toPage[0], toPage[1]),
          size,
          bold: !!font?.bold || !!font?.black || BOLD_NAME.test(fontName),
          italic: !!font?.italic || ITALIC_NAME.test(fontName),
          mono: !!font?.isMonospace || MONO_NAME.test(fontName) || family === "monospace",
        };
        const middleX = piece.x + piece.width / 2;
        const middleY = piece.y - size / 3;
        const linked = links.find((box) => middleX >= box.left && middleX <= box.right && middleY >= box.top - 2 && middleY <= box.bottom + 2);
        if (linked && /^(https?|mailto):/i.test(linked.url)) piece.href = linked.url;
        pieces.push(piece);
      }

      // Pictures: follow the drawing state to know where each one lands.
      const pictures: PagePicture[] = [];
      const marks: PageMark[] = [];
      const rules: PageRule[] = [];
      const { OPS } = pdfjs;
      // Hollow bullets are stroked, solid ones filled.
      const PAINTS = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke, OPS.stroke, OPS.closeStroke]);
      const STROKES = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
      let matrix: Matrix = [1, 0, 0, 1, 0, 0];
      let fill = "#000000";
      const stack: { matrix: Matrix; fill: string }[] = [];
      // Every character drawn, with its fill colour, in drawing order.
      let drawn = "";
      const drawnColors: string[] = [];
      for (let index = 0; index < operators.fnArray.length; index += 1) {
        const op = operators.fnArray[index];
        const args = operators.argsArray[index] as unknown[];
        if (op === OPS.save) stack.push({ matrix, fill });
        else if (op === OPS.restore) ({ matrix, fill } = stack.pop() ?? { matrix, fill });
        else if (op === OPS.transform) matrix = multiply(matrix, args as Matrix);
        else if (op === OPS.setFillRGBColor && typeof args[0] === "string") fill = args[0];
        else if (op === OPS.showText && Array.isArray(args[0])) {
          for (const glyph of args[0] as unknown[]) {
            const unicode = (glyph as { unicode?: unknown } | null)?.unicode;
            if (typeof unicode !== "string") continue;
            const characters = comparable(unicode);
            drawn += characters;
            for (let count = 0; count < characters.length; count += 1) drawnColors.push(fill);
          }
        } else if (op === OPS.paintFormXObjectBegin) {
          stack.push({ matrix, fill });
          if (Array.isArray(args[0]) && args[0].length === 6) matrix = multiply(matrix, args[0] as Matrix);
        } else if (op === OPS.paintFormXObjectEnd) ({ matrix, fill } = stack.pop() ?? { matrix, fill });
        else if (op === OPS.constructPath) {
          const [pathOp, data, minMax] = args as [number, unknown, ArrayLike<number> | null];
          if (PAINTS.has(pathOp) && minMax && minMax.length === 4) {
            const device = multiply(toPage, matrix);
            const path = Array.isArray(data) ? (data[0] as ArrayLike<number> | undefined) : undefined;
            if (path) rules.push(...rulesOf(path, device, STROKES.has(pathOp)));
            const [x1, y1] = apply(device, minMax[0], minMax[1]);
            const [x2, y2] = apply(device, minMax[2], minMax[3]);
            const box = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
            const squarish = box.width / box.height < 1.6 && box.height / box.width < 1.6;
            if (box.width >= 0.5 && box.width <= 12 && box.height >= 0.5 && box.height <= 12 && squarish) marks.push(box);
          }
        } else if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) {
          const device = multiply(toPage, matrix);
          const corners = [apply(device, 0, 0), apply(device, 1, 0), apply(device, 0, 1), apply(device, 1, 1)];
          const xs = corners.map((point) => point[0]);
          const ys = corners.map((point) => point[1]);
          const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
          if (box.width < MIN_PICTURE || box.height < MIN_PICTURE) continue;

          const id = op === OPS.paintImageXObject ? (args[0] as string) : null;
          let url = id !== null ? pictureLinks.get(id) : undefined;
          if (url === undefined) {
            const image = id !== null ? await objectOf(page, id) : (args[0] as PdfImage);
            const png = image ? await toPng(image) : null;
            if (png) {
              pictureCount += 1;
              url = await context.addAttachment(`${baseName} ${pictureCount}.png`, png);
            } else {
              failedPictures += 1;
              url = null;
            }
            if (id !== null) pictureLinks.set(id, url);
          }
          if (url) pictures.push({ ...box, url });
        }
      }

      colorPieces(pieces, drawn, drawnColors);
      pages.push({ width: viewport.width, height: viewport.height, pieces, pictures, marks, rules });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }

  return { pages, failedPictures };
}

/** pdf.js path commands (`DrawOPS`). */
const MOVE_TO = 0;
const LINE_TO = 1;
const CURVE_TO = 2;
const QUADRATIC_CURVE_TO = 3;
const CLOSE_PATH = 4;

/**
 * The straight horizontal and vertical lines a path draws, in page pixels.
 * Stroked paths give each of their straight edges; filled ones give the
 * shapes thin enough to be lines, which is how Word draws table borders.
 */
function rulesOf(path: ArrayLike<number>, device: Matrix, stroked: boolean): PageRule[] {
  const rules: PageRule[] = [];
  let points: [number, number][] = [];
  let curved = false;
  const finish = (closed: boolean) => {
    if (points.length >= 2 && !curved) {
      if (stroked) {
        const edges = closed ? [...points, points[0]] : points;
        for (let index = 1; index < edges.length; index += 1) {
          const [x1, y1] = edges[index - 1];
          const [x2, y2] = edges[index];
          if ((Math.abs(y1 - y2) < 1 || Math.abs(x1 - x2) < 1) && Math.hypot(x2 - x1, y2 - y1) >= 3) {
            rules.push({ x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) });
          }
        }
      } else {
        const xs = points.map((point) => point[0]);
        const ys = points.map((point) => point[1]);
        const left = Math.min(...xs);
        const right = Math.max(...xs);
        const top = Math.min(...ys);
        const bottom = Math.max(...ys);
        if (bottom - top <= 2.5 && right - left >= 3) rules.push({ x1: left, y1: (top + bottom) / 2, x2: right, y2: (top + bottom) / 2 });
        else if (right - left <= 2.5 && bottom - top >= 3) rules.push({ x1: (left + right) / 2, y1: top, x2: (left + right) / 2, y2: bottom });
      }
    }
    points = [];
    curved = false;
  };
  for (let index = 0; index < path.length; ) {
    switch (path[index++]) {
      case MOVE_TO:
        finish(false);
        points.push(apply(device, path[index++], path[index++]));
        break;
      case LINE_TO:
        points.push(apply(device, path[index++], path[index++]));
        break;
      case CURVE_TO:
        curved = true;
        index += 6;
        break;
      case QUADRATIC_CURVE_TO:
        curved = true;
        index += 4;
        break;
      case CLOSE_PATH:
        finish(true);
        break;
      default:
        return rules;
    }
  }
  finish(false);
  return rules;
}

/** Text with spaces removed and ligatures split, so drawn glyphs and text pieces compare. */
function comparable(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "");
}

/**
 * pdf.js reports text without its colour, and colour only in the drawing
 * operators. Both list the text in the order it is drawn, so each piece is
 * found in the drawn characters a little after the previous one and takes
 * the colour of its first character. A piece that can't be found (right to
 * left text, glyphs without Unicode) keeps the ordinary text colour.
 */
function colorPieces(pieces: TextPiece[], drawn: string, colors: string[]) {
  let position = 0;
  for (const piece of pieces) {
    const characters = comparable(piece.text);
    if (!characters) continue;
    const found = drawn.indexOf(characters.slice(0, 12), position);
    if (found === -1 || found - position > 400) continue;
    piece.color = colors[found];
    position = found + characters.length;
  }
}

function objectOf(page: { objs: { get(id: string, callback: (value: unknown) => void): void }; commonObjs: { get(id: string, callback: (value: unknown) => void): void } }, id: string): Promise<PdfImage | null> {
  const store = id.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 10_000);
    try {
      store.get(id, (value) => {
        clearTimeout(timer);
        resolve((value as PdfImage) ?? null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** pdf.js's raw image (`ImageKind`) as a PNG. */
async function toPng(image: PdfImage): Promise<Uint8Array | null> {
  const { width, height, data, kind } = image;
  if (!data || !width || !height) return null;
  switch (kind) {
    case 1:
      return encodePng(unpackBits(data, width, height), width, height, 1);
    case 2:
      return encodePng(data, width, height, 3);
    case 3:
      return encodePng(data, width, height, 4);
    default:
      return null;
  }
}
