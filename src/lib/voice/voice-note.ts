/**
 * The one voice note being recorded: a block at the cursor while it runs,
 * an audio block of the vault once saved. Its bytes reach a temporary file
 * as they're made, so nothing recorded is lost to a failed write.
 */

import { KEYS, type Path, PathApi, type TElement } from "platejs";
import type { PlateEditor } from "platejs/react";
import { toast } from "sonner";
import { create } from "zustand";

import { managedMediaNode } from "@/components/editor/lib/media-insert";
import { notifyAttachmentSyncStatus } from "@/lib/attachment-sync-status";
import {
  appendVoiceNote,
  beginVoiceNote,
  discardVoiceNote,
  isVoiceNoteWriteError,
  saveVoiceNote,
} from "@/lib/commands/voice-notes";
import { fileName } from "@/lib/drawing-files";
import { useEditorStore } from "@/store/editor";
import { useSettingsStore } from "@/store/settings";
import { useVaultStore } from "@/store/vault";

import {
  type FinishedHead,
  MicrophoneError,
  openMicrophone,
  releaseMicrophone,
  VoiceCapture,
} from "./capture";

/** The block that stands for a recording while it runs. Never saved. */
export const VOICE_RECORDING_TYPE = "voice_recording";

type VoiceNotePhase =
  | "waiting"
  | "recording"
  | "paused"
  | "saving"
  | "problem"
  // Gone from the shard, with Undo on screen a little longer.
  | "discarded";

export type VoiceNoteProblem =
  | "access-off"
  | "no-microphone"
  | "disk-full"
  | "failed";

type VoiceNoteState = {
  phase: VoiceNotePhase | null;
  problem: VoiceNoteProblem | null;
  shardPath: string | null;
  /** The microphone this recording uses, by its name. */
  deviceLabel: string;
  deviceId: string | null;
  syncLimitBytes: number;
};

const IDLE: VoiceNoteState = {
  phase: null,
  problem: null,
  shardPath: null,
  deviceLabel: "",
  deviceId: null,
  syncLimitBytes: 0,
};

export const useVoiceNoteStore = create<VoiceNoteState>(() => IDLE);

/** How many recent levels the wave shows. */
export const WAVE_BARS = 64;

/**
 * The timer, size and recent levels. They change about ten times a second,
 * so the block reads them here and draws without a React render.
 */
type Meter = { durationMs: number; bytes: number; levels: number[] };

const meter: Meter = { durationMs: 0, bytes: 0, levels: [] };
const meterListeners = new Set<(meter: Meter) => void>();

export function subscribeMeter(listener: (meter: Meter) => void) {
  meterListeners.add(listener);
  listener(meter);
  return () => {
    meterListeners.delete(listener);
  };
}

function updateMeter(change: Partial<Meter>) {
  Object.assign(meter, change);
  for (const listener of meterListeners) listener(meter);
}

type Session = {
  editor: PlateEditor;
  shardPath: string;
  vaultPath: string;
  stream: MediaStream | null;
  capture: VoiceCapture | null;
  /** Bytes not yet in the temporary file, oldest first. */
  unwritten: Uint8Array[];
  flushing: Promise<boolean> | null;
  /** Set once the recording stopped: what goes over the file's head. */
  head: FinishedHead | null;
  saving: Promise<boolean> | null;
  /** Where the block was when Discard took it away. */
  discardedAt: Path | null;
  cancelled: boolean;
};

let session: Session | null = null;
let focusBlock: (() => void) | null = null;

/** The recording block registers how to put focus in it. */
export function registerVoiceNoteFocus(focus: (() => void) | null) {
  focusBlock = focus;
}

function setState(change: Partial<VoiceNoteState>) {
  useVoiceNoteStore.setState(change);
}

function end() {
  if (session) {
    releaseMicrophone(session.stream);
    void session.capture?.close();
  }
  session = null;
  useVoiceNoteStore.setState(IDLE, true);
  updateMeter({ durationMs: 0, bytes: 0, levels: [] });
}

function findBlock(editor: PlateEditor): Path | null {
  const entry = editor.api.node<TElement>({
    at: [],
    match: { type: VOICE_RECORDING_TYPE },
  });
  return entry ? entry[1] : null;
}

function removeBlock(editor: PlateEditor): Path | null {
  const path = findBlock(editor);
  if (path) {
    editor.tf.withoutSaving(() => editor.tf.removeNodes({ at: path }));
  }
  return path;
}

function insertBlock(editor: PlateEditor, at?: Path) {
  const node = { type: VOICE_RECORDING_TYPE, children: [{ text: "" }] };
  editor.tf.withoutSaving(() => {
    if (at) {
      editor.tf.insertNodes(node, { at });
      return;
    }
    const block = editor.api.block();
    if (!block) {
      editor.tf.insertNodes(node, { at: [editor.children.length] });
      return;
    }
    const [current, path] = block;
    // Typed text stays above; an empty line moves below, ready to write on.
    const top = [path[0]];
    editor.tf.insertNodes(node, {
      at: editor.api.isEmpty(current) ? top : PathApi.next(top),
    });
  });
}

function shardName(path: string): string {
  const file = fileName(path);
  return file.replace(/\.md$/i, "");
}

const pad = (value: number) => String(value).padStart(2, "0");

/** "<shard> voice note 2026-11-20 14-05.webm" */
function voiceNoteFileName(shardPath: string, at: Date): string {
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}-${pad(at.getMinutes())}`;
  return `${shardName(shardPath)} voice note ${date} ${time}.webm`;
}

function problemOfWrite(error: unknown): VoiceNoteProblem {
  if (isVoiceNoteWriteError(error) && error.kind === "diskFull") {
    return "disk-full";
  }
  return "failed";
}

function showProblem(problem: VoiceNoteProblem, error?: unknown) {
  if (error) console.error("[voice-notes]", problem, error);
  session?.capture?.pause();
  setState({ phase: "problem", problem });
}

/** Writes what's waiting, in order. False once a write fails. */
function flush(current: Session): Promise<boolean> {
  current.flushing ??= (async () => {
    try {
      while (current.unwritten.length > 0) {
        await appendVoiceNote(current.unwritten[0]);
        current.unwritten.shift();
      }
      return true;
    } catch (error) {
      if (session === current) showProblem(problemOfWrite(error), error);
      return false;
    } finally {
      current.flushing = null;
    }
  })();
  return current.flushing;
}

function trackLabel(stream: MediaStream): string {
  return stream.getAudioTracks()[0]?.label ?? "";
}

async function openInput(current: Session, deviceId?: string | null) {
  const stream = await openMicrophone(deviceId ?? undefined);
  if (session !== current || current.cancelled) {
    releaseMicrophone(stream);
    return null;
  }
  const track = stream.getAudioTracks()[0];
  setState({
    deviceLabel: trackLabel(stream),
    deviceId: track?.getSettings().deviceId ?? deviceId ?? null,
  });
  return stream;
}

/** Opens the microphone and starts recording into the session's file. */
async function startCapture(current: Session) {
  setState({ phase: "waiting", problem: null });
  try {
    const stream = await openInput(
      current,
      useSettingsStore.getState().microphone?.deviceId,
    );
    if (!stream) return;
    current.stream = stream;
    const capture = await VoiceCapture.start(stream, {
      onBytes: (bytes) => {
        current.unwritten.push(bytes);
        updateMeter({ bytes: meter.bytes + bytes.length });
        void flush(current);
      },
      onLevel: (peak) => {
        if (session !== current) return;
        const levels = [...meter.levels, peak].slice(-WAVE_BARS);
        updateMeter({ levels, durationMs: current.capture?.durationMs ?? 0 });
      },
      onDeviceLost: () => void saveAfterDeviceLost(current),
    });
    if (session !== current || current.cancelled) {
      await capture.close();
      releaseMicrophone(stream);
      return;
    }
    current.capture = capture;
    setState({ phase: "recording" });
    focusBlock?.();
  } catch (error) {
    releaseMicrophone(current.stream);
    current.stream = null;
    if (session !== current) return;
    const problem =
      error instanceof MicrophoneError && error.problem !== "failed"
        ? error.problem
        : "failed";
    showProblem(problem, error);
  }
}

async function saveAfterDeviceLost(current: Session) {
  if (session !== current || current.saving) return;
  if (await save()) toast("Microphone disconnected. Recording saved");
}

/** Where the recording runs, for "Already recording in …". */
function alreadyRecording(current: Session) {
  toast(`Already recording in ${shardName(current.shardPath)}`, {
    action: { label: "Go there", onClick: () => focusBlock?.() },
  });
}

/** Starts a recording at the cursor of `editor`. */
export async function startVoiceNote(editor: PlateEditor) {
  if (session?.discardedAt) finishDiscard();
  if (session) {
    alreadyRecording(session);
    return;
  }
  const shardPath = useEditorStore.getState().currentFilePath;
  const vaultPath = useVaultStore.getState().currentVaultPath;
  if (!shardPath || !vaultPath) return;

  const current: Session = {
    editor,
    shardPath,
    vaultPath,
    stream: null,
    capture: null,
    unwritten: [],
    flushing: null,
    head: null,
    saving: null,
    discardedAt: null,
    cancelled: false,
  };
  session = current;
  useVoiceNoteStore.setState({ ...IDLE, phase: "waiting", shardPath }, true);
  insertBlock(editor);

  try {
    const { syncLimitBytes } = await beginVoiceNote();
    if (session !== current) return;
    setState({ syncLimitBytes });
  } catch (error) {
    if (session === current) showProblem(problemOfWrite(error), error);
    return;
  }
  await startCapture(current);
}

/** Starts a recording, or saves the one running in `editor`. */
export function toggleVoiceNote(editor: PlateEditor) {
  const phase = useVoiceNoteStore.getState().phase;
  if (session?.editor === editor && (phase === "recording" || phase === "paused")) {
    void save();
    return;
  }
  void startVoiceNote(editor);
}

export function pauseVoiceNote() {
  if (useVoiceNoteStore.getState().phase !== "recording") return;
  session?.capture?.pause();
  setState({ phase: "paused" });
}

export async function resumeVoiceNote() {
  const current = session;
  if (!current?.capture || useVoiceNoteStore.getState().phase !== "paused") {
    return;
  }
  // Discard lets go of the microphone; Undo picks it up again.
  if (!current.stream) {
    try {
      const stream = await openInput(current, useVoiceNoteStore.getState().deviceId);
      if (!stream) return;
      current.stream = stream;
      current.capture.switchTo(stream);
    } catch (error) {
      const problem = error instanceof MicrophoneError ? error.problem : "failed";
      showProblem(problem === "failed" ? "failed" : problem, error);
      return;
    }
  }
  current.capture.resume();
  setState({ phase: "recording" });
}

/** Records from microphone `deviceId` from now on, in the same file. */
export async function switchVoiceNoteInput(deviceId: string) {
  const current = session;
  if (!current?.capture) return;
  try {
    const stream = await openInput(current, deviceId);
    if (!stream) return;
    current.capture.switchTo(stream);
    releaseMicrophone(current.stream);
    current.stream = stream;
  } catch (error) {
    console.error("[voice-notes] Couldn't switch microphone", error);
  }
}

/** Stops recording and puts the clip in the shard where the block is. */
export function save(): Promise<boolean> {
  const current = session;
  if (!current) return Promise.resolve(false);
  current.saving ??= saveSession(current).finally(() => {
    current.saving = null;
  });
  return current.saving;
}

async function saveSession(current: Session): Promise<boolean> {
  const { phase } = useVoiceNoteStore.getState();
  if (phase === "waiting" || phase === "discarded" || phase === null) {
    return false;
  }
  setState({ phase: "saving", problem: null });

  if (current.capture) {
    const capture = current.capture;
    current.capture = null;
    current.head = await capture.finish();
    releaseMicrophone(current.stream);
    current.stream = null;
  }
  if (!(await flush(current))) return false;

  const fileName = voiceNoteFileName(current.shardPath, new Date());
  try {
    const attachment = await saveVoiceNote(
      current.vaultPath,
      fileName,
      current.head?.head ?? new Uint8Array(),
      current.head?.replaces ?? 0,
    );
    if (session !== current) return false;
    const { editor } = current;
    const at = removeBlock(editor) ?? [editor.children.length];
    editor.tf.insertNodes(managedMediaNode(attachment, KEYS.audio, fileName), {
      at,
    });
    notifyAttachmentSyncStatus([attachment]);
    end();
    return true;
  } catch (error) {
    if (session === current) showProblem(problemOfWrite(error), error);
    return false;
  }
}

/** Takes the block away, with Undo for a few seconds. */
export function discard() {
  const current = session;
  if (!current) return;
  const { phase } = useVoiceNoteStore.getState();
  // Nothing was recorded yet, so there's nothing to undo.
  if (phase === "waiting" || !current.capture) {
    current.cancelled = true;
    removeBlock(current.editor);
    void discardVoiceNote().catch(() => {});
    end();
    return;
  }
  current.capture.pause();
  releaseMicrophone(current.stream);
  current.stream = null;
  current.discardedAt = removeBlock(current.editor);
  setState({ phase: "discarded", problem: null });
  toast("Recording discarded", {
    action: { label: "Undo", onClick: () => undoDiscard(current) },
    onDismiss: () => finishDiscard(current),
    onAutoClose: () => finishDiscard(current),
  });
}

function undoDiscard(current: Session) {
  if (session !== current || !current.discardedAt) return;
  const { editor } = current;
  if (useEditorStore.getState().plateEditor !== editor) {
    finishDiscard(current);
    return;
  }
  const at = current.discardedAt;
  current.discardedAt = null;
  insertBlock(editor, at[0] <= editor.children.length ? at : undefined);
  setState({ phase: "paused" });
  focusBlock?.();
}

function finishDiscard(current: Session | null = session) {
  if (!current || session !== current || !current.discardedAt) return;
  void discardVoiceNote().catch(() => {});
  end();
}

/** Try again on a problem: the microphone again, or the save again. */
export async function retryVoiceNote() {
  const current = session;
  if (!current) return;
  const { problem } = useVoiceNoteStore.getState();
  if (problem === "disk-full" || current.capture || current.head) {
    await save();
    return;
  }
  await startCapture(current);
}

/** Whether a recording would be lost if the app closed now. */
export function hasVoiceNote(): boolean {
  return session !== null;
}

/**
 * Saves what was recorded before its shard closes, or drops a recording
 * that hasn't started. False if it couldn't be saved; it stays on screen.
 */
export async function finishVoiceNoteBeforeLeaving(): Promise<boolean> {
  const current = session;
  if (!current) return true;
  if (current.discardedAt) {
    finishDiscard(current);
    return true;
  }
  if (current.saving) return current.saving;
  if (!current.capture && !current.head) {
    discard();
    return true;
  }
  return save();
}
