import type { PlateNode } from "../../types";

/** Messages between the Import window and the worker reading a Word file. */

export type ToWorker =
  | { type: "read"; bytes: Uint8Array; name: string }
  | { type: "linked"; id: number; link: string | null }
  | { type: "stored"; id: number; link: string }
  | { type: "notStored"; id: number; error: string };

export type FromWorker =
  | { type: "warn"; message: string }
  | { type: "link"; id: number; target: string }
  | { type: "store"; id: number; name: string; bytes: Uint8Array }
  | { type: "done"; nodes: PlateNode[] }
  | { type: "failed"; error: string; readable: boolean };

/** The worker's side of the channel; a `MessagePort` in tests. */
export interface WorkerScope {
  postMessage(message: FromWorker): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}
