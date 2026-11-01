import { ImportError, type Importer } from "../../types";
import { IMPORT_FORMATS } from "../list";
import type { FromWorker, ToWorker } from "./protocol";

/** How often a cancel is looked for while the worker reads. */
const CANCEL_CHECK_MS = 100;
/** How long a worker waits for the next file before it stops. */
const IDLE_MS = 5_000;
/**
 * A worker reads files until it has read this much, then makes way for a
 * fresh one: the memory a big document took isn't always given back while
 * the worker lives, and the next files would read slower and slower.
 */
const WORKER_BYTES = 1_000_000;

/** Workers waiting for the next file, one for each file read at once. */
const idle: { worker: Worker; read: number; timer: ReturnType<typeof setTimeout> }[] = [];

/** A worker left from a file before, or a new one. */
function takeWorker() {
  const taken = idle.pop();
  if (!taken) return { worker: new Worker(new URL("./docx.worker.ts", import.meta.url), { type: "module" }), read: 0 };
  clearTimeout(taken.timer);
  return taken;
}

function keepWorker(worker: Worker, read: number) {
  const kept = {
    worker,
    read,
    timer: setTimeout(() => {
      worker.terminate();
      idle.splice(idle.indexOf(kept), 1);
    }, IDLE_MS),
  };
  idle.push(kept);
}

/**
 * Word documents (.docx), read straight from their XML: headings, text
 * formatting and colours, alignment and indents, numbered, bulleted and
 * to-do lists, tables with merged and shaded cells, pictures, links,
 * equations, footnotes and the table of contents.
 *
 * Files are read in a worker, so a long document doesn't freeze the window.
 * Each worker reads small files one after another; it is stopped as soon
 * as the import is cancelled.
 */
export const docxImporter: Importer = {
  ...IMPORT_FORMATS.docx,
  async convert(file, context) {
    const bytes = await file.read();
    const { worker, read } = takeWorker();
    const send = (message: ToWorker) => worker.postMessage(message);
    let watch: ReturnType<typeof setInterval> | undefined;
    /** Whether the worker finished the file, so it can take the next one. */
    let finished = false;

    try {
      const markdown = await new Promise<string>((resolve, reject) => {
        // Throws once the import is cancelled.
        watch = setInterval(() => context.checkpoint().catch(reject), CANCEL_CHECK_MS);
        worker.onmessage = async ({ data }: MessageEvent<FromWorker>) => {
          switch (data.type) {
            case "warn":
              context.warn(data.message);
              break;
            case "link":
              send({ type: "linked", id: data.id, link: context.linkTo(data.target) });
              break;
            case "store":
              try {
                send({ type: "stored", id: data.id, link: await context.addAttachment(data.name, data.bytes) });
              } catch (error) {
                send({ type: "notStored", id: data.id, error: error instanceof Error ? error.message : String(error) });
              }
              break;
            case "done":
              finished = true;
              resolve(data.markdown);
              break;
            case "failed":
              finished = true;
              reject(data.readable ? new ImportError(data.error) : new Error(data.error));
              break;
          }
        };
        worker.onerror = (event) => reject(new Error(event.message));
        worker.onmessageerror = () => reject(new Error());
        send({ type: "read", bytes, name: file.name.replace(/\.[^.]+$/, ""), filePath: context.shardPath });
      });
      return { markdown };
    } finally {
      clearInterval(watch);
      if (finished && read + bytes.length < WORKER_BYTES) keepWorker(worker, read + bytes.length);
      else worker.terminate();
    }
  },
};
