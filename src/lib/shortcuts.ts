import { IS_MAC } from "@/lib/platform";

/**
 * Keys as "mod+shift+x": modifiers, then one key. `mod` is ⌘ on a Mac and
 * Ctrl elsewhere, `ctrl` is ⌃ on a Mac and the same as `mod` elsewhere.
 *
 * The key is one of three kinds, so one matcher serves every shortcut:
 * - a letter, matched by the character it types, so Mod+Z is the key
 *   labelled Z on any layout. When the key types no Latin letter (Cyrillic,
 *   Greek, or ⌥ held on a Mac), its place on the keyboard counts instead.
 * - a digit or a key named after its place ("period", "minus", "enter",
 *   "f5"), matched by where the key is, so Mod+1 still works on AZERTY,
 *   where that key types "&".
 * - any other character ("=", "-", "plus" for "+"), matched by the
 *   character typed, with or without Shift. For keys that sit in a different
 *   place on each layout, like zoom's + and −. Only defaults use these: keys
 *   set in Settings are always one of the first two.
 */
export type Keys = string;

/**
 * - app: works everywhere.
 * - editor: only while typing in a shard, where it wins over an app
 *   shortcut on the same keys.
 * - canvas: Excalidraw's own keys, listed but not changeable.
 */
export type ShortcutScope = "app" | "editor" | "canvas";

export const SHORTCUT_GROUPS = [
  { id: "app", title: "App" },
  { id: "text", title: "Text" },
  { id: "blocks", title: "Blocks" },
  { id: "drawing", title: "Drawing" },
] as const;
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number]["id"];

type Definition = {
  /** Stable: saved changes are keyed by it, so it is never renamed. */
  readonly id: string;
  readonly label: string;
  readonly group: ShortcutGroup;
  readonly scope: ShortcutScope;
  /** The default keys, as listed in Settings. Empty for none. */
  readonly keys: readonly Keys[];
  /** More default keys that work too but aren't listed. */
  readonly alternates?: readonly Keys[];
  /** Listed only: handled by the system, Slate or Excalidraw. */
  readonly fixed?: true;
  /** Runs again while the keys are held down. */
  readonly repeats?: true;
};

const REDO: Keys = IS_MAC ? "mod+shift+z" : "mod+y";

/** Every shortcut, in the order Settings lists them. */
export const SHORTCUTS = [
  // ── App ───────────────────────────────────────────────────────────────────
  { id: "search", label: "Search your vault", group: "app", scope: "app", keys: ["mod+k"] },
  { id: "newShard", label: "New shard", group: "app", scope: "app", keys: ["mod+n"] },
  { id: "save", label: "Save", group: "app", scope: "app", keys: ["mod+s"] },
  { id: "toggleSidebar", label: "Show or hide the left sidebar", group: "app", scope: "app", keys: ["mod+b"] },
  { id: "openEditor", label: "Editor", group: "app", scope: "app", keys: ["mod+1"] },
  { id: "openCanvas", label: "Canvas", group: "app", scope: "app", keys: ["mod+2"] },
  { id: "openTags", label: "Tags", group: "app", scope: "app", keys: ["mod+3"] },
  { id: "openGallery", label: "Gallery", group: "app", scope: "app", keys: ["mod+4"] },
  { id: "openOverview", label: "Overview", group: "app", scope: "app", keys: ["mod+5"] },
  // Ctrl on every system, as in browsers, since ⌘+Tab switches apps on a Mac.
  { id: "nextRecent", label: "Next recent shard", group: "app", scope: "app", keys: ["ctrl+tab"], repeats: true },
  { id: "previousRecent", label: "Previous recent shard", group: "app", scope: "app", keys: ["ctrl+shift+tab"], repeats: true },
  // By the character typed: "+" is Shift+= on many layouts and has its own
  // key on others, and the number pad types the same.
  { id: "zoomIn", label: "Zoom in", group: "app", scope: "app", keys: ["mod+="], alternates: ["mod+plus"], repeats: true },
  { id: "zoomOut", label: "Zoom out", group: "app", scope: "app", keys: ["mod+-"], repeats: true },
  { id: "resetZoom", label: "Reset zoom", group: "app", scope: "app", keys: ["mod+0"] },

  // ── Text ──────────────────────────────────────────────────────────────────
  { id: "bold", label: "Bold", group: "text", scope: "editor", keys: ["mod+b"] },
  { id: "italic", label: "Italic", group: "text", scope: "editor", keys: ["mod+i"] },
  { id: "underline", label: "Underline", group: "text", scope: "editor", keys: ["mod+u"] },
  { id: "strikethrough", label: "Strikethrough", group: "text", scope: "editor", keys: ["mod+shift+x"] },
  { id: "code", label: "Inline code", group: "text", scope: "editor", keys: ["mod+e"] },
  { id: "highlight", label: "Highlight", group: "text", scope: "editor", keys: ["mod+shift+h"] },
  { id: "superscript", label: "Superscript", group: "text", scope: "editor", keys: ["mod+period"] },
  { id: "subscript", label: "Subscript", group: "text", scope: "editor", keys: ["mod+comma"] },
  { id: "undo", label: "Undo", group: "text", scope: "editor", keys: ["mod+z"], fixed: true },
  { id: "redo", label: "Redo", group: "text", scope: "editor", keys: [REDO], fixed: true },
  { id: "selectAll", label: "Select all", group: "text", scope: "editor", keys: ["mod+a"], fixed: true },
  { id: "openLink", label: "Open a link", group: "text", scope: "editor", keys: ["mod+click"], fixed: true },

  // ── Blocks ────────────────────────────────────────────────────────────────
  { id: "heading1", label: "Heading 1", group: "blocks", scope: "editor", keys: ["mod+alt+1"] },
  { id: "heading2", label: "Heading 2", group: "blocks", scope: "editor", keys: ["mod+alt+2"] },
  { id: "heading3", label: "Heading 3", group: "blocks", scope: "editor", keys: ["mod+alt+3"] },
  { id: "heading4", label: "Heading 4", group: "blocks", scope: "editor", keys: ["mod+alt+4"] },
  { id: "heading5", label: "Heading 5", group: "blocks", scope: "editor", keys: ["mod+alt+5"] },
  { id: "heading6", label: "Heading 6", group: "blocks", scope: "editor", keys: ["mod+alt+6"] },
  { id: "paragraph", label: "Paragraph", group: "blocks", scope: "editor", keys: ["mod+alt+0"], alternates: ["mod+shift+0"] },
  { id: "quote", label: "Quote", group: "blocks", scope: "editor", keys: ["mod+shift+period"] },
  { id: "codeBlock", label: "Code block", group: "blocks", scope: "editor", keys: ["mod+alt+8"] },
  { id: "newLineAfter", label: "New line after this block", group: "blocks", scope: "editor", keys: ["mod+enter"] },
  { id: "newLineBefore", label: "New line before this block", group: "blocks", scope: "editor", keys: ["mod+shift+enter"] },
  { id: "indent", label: "Indent", group: "blocks", scope: "editor", keys: ["tab"], fixed: true },
  { id: "outdent", label: "Outdent", group: "blocks", scope: "editor", keys: ["shift+tab"], fixed: true },

  // ── Drawing ───────────────────────────────────────────────────────────────
  // Excalidraw's own keys, as its help lists them.
  { id: "drawingHand", label: "Hand", group: "drawing", scope: "canvas", keys: ["h"], fixed: true },
  { id: "drawingSelect", label: "Select", group: "drawing", scope: "canvas", keys: ["v", "1"], fixed: true },
  { id: "drawingRectangle", label: "Rectangle", group: "drawing", scope: "canvas", keys: ["r", "2"], fixed: true },
  { id: "drawingDiamond", label: "Diamond", group: "drawing", scope: "canvas", keys: ["d", "3"], fixed: true },
  { id: "drawingEllipse", label: "Ellipse", group: "drawing", scope: "canvas", keys: ["o", "4"], fixed: true },
  { id: "drawingArrow", label: "Arrow", group: "drawing", scope: "canvas", keys: ["a", "5"], fixed: true },
  { id: "drawingLine", label: "Line", group: "drawing", scope: "canvas", keys: ["l", "6"], fixed: true },
  { id: "drawingDraw", label: "Draw", group: "drawing", scope: "canvas", keys: ["p", "7"], fixed: true },
  { id: "drawingText", label: "Text", group: "drawing", scope: "canvas", keys: ["t", "8"], fixed: true },
  { id: "drawingImage", label: "Insert image", group: "drawing", scope: "canvas", keys: ["9"], fixed: true },
  { id: "drawingEraser", label: "Eraser", group: "drawing", scope: "canvas", keys: ["e", "0"], fixed: true },
  { id: "drawingZoomIn", label: "Zoom in", group: "drawing", scope: "canvas", keys: ["mod+equal"], fixed: true },
  { id: "drawingZoomOut", label: "Zoom out", group: "drawing", scope: "canvas", keys: ["mod+minus"], fixed: true },
  { id: "drawingResetZoom", label: "Reset zoom", group: "drawing", scope: "canvas", keys: ["mod+0"], fixed: true },
  { id: "drawingZoomToFit", label: "Zoom to fit", group: "drawing", scope: "canvas", keys: ["shift+1"], fixed: true },
  { id: "drawingGrid", label: "Show or hide the grid", group: "drawing", scope: "canvas", keys: ["mod+quote"], fixed: true },
] as const satisfies readonly Definition[];

export type Shortcut = (typeof SHORTCUTS)[number];
export type ShortcutId = Shortcut["id"];
/** The shortcuts of a scope that the app runs itself. */
export type ShortcutIdIn<S extends ShortcutScope> = Exclude<
  Extract<Shortcut, { scope: S }>,
  { fixed: true }
>["id"];

const BY_ID = new Map<string, Shortcut>(SHORTCUTS.map((s) => [s.id, s]));

export function getShortcut(id: ShortcutId): Shortcut {
  return BY_ID.get(id)!;
}

/** Keys someone changed, by shortcut id. An empty list means none. */
export type ShortcutOverrides = Partial<Record<string, Keys[]>>;

/**
 * Keys that belong to the system or to typing itself, so they can't be
 * given to a shortcut.
 */
export const RESERVED_KEYS: readonly { keys: Keys; label: string }[] = [
  { keys: "mod+c", label: "Copy" },
  { keys: "mod+x", label: "Cut" },
  { keys: "mod+v", label: "Paste" },
  { keys: "mod+a", label: "Select all" },
  { keys: "mod+z", label: "Undo" },
  { keys: "mod+shift+z", label: "Redo" },
  ...(IS_MAC ? [] : [{ keys: "mod+y", label: "Redo" }]),
  { keys: "mod+q", label: "Quit" },
  { keys: "mod+w", label: "Close window" },
  ...(IS_MAC
    ? [{ keys: "mod+tab", label: "Switch apps" }]
    : [
        { keys: "alt+f4", label: "Close window" },
        { keys: "alt+tab", label: "Switch apps" },
      ]),
];

// ── Parsing ─────────────────────────────────────────────────────────────────

type Modifiers = { mod: boolean; ctrl: boolean; alt: boolean; shift: boolean };
type KeyKind = "letter" | "place" | "character";
type Parsed = Modifiers & { key: string; kind: KeyKind };

const MODIFIER_NAMES = ["mod", "ctrl", "alt", "shift"] as const;
/** Character keys that can't be written as themselves in "a+b" keys. */
const CHARACTER_NAMES: Record<string, string> = { plus: "+" };

function keyKind(key: string): KeyKind {
  if (/^[a-z]$/.test(key)) return "letter";
  if (/^[0-9]$/.test(key) || /^[a-z][a-z0-9]+$/.test(key)) {
    return key in CHARACTER_NAMES ? "character" : "place";
  }
  return "character";
}

function parse(keys: Keys): Parsed | null {
  const parts = keys.toLowerCase().split("+");
  const key = parts.pop();
  if (!key) return null;
  const modifiers: Modifiers = { mod: false, ctrl: false, alt: false, shift: false };
  for (const part of parts) {
    if (!(MODIFIER_NAMES as readonly string[]).includes(part)) return null;
    // Ctrl is the shortcut modifier itself on Windows and Linux.
    const name = part === "ctrl" && !IS_MAC ? "mod" : part;
    modifiers[name as keyof Modifiers] = true;
  }
  return { ...modifiers, key, kind: keyKind(key) };
}

function write({ key, ...modifiers }: Omit<Parsed, "kind">): Keys {
  return [...MODIFIER_NAMES.filter((name) => modifiers[name]), key].join("+");
}

/** The same keys written one way, so two spellings compare equal. */
export function normalizeKeys(keys: Keys): Keys | null {
  const parsed = parse(keys);
  return parsed ? write(parsed) : null;
}

// ── Events ──────────────────────────────────────────────────────────────────

/** What a key press is read from: a DOM or a React keyboard event. */
export type KeyPress = {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  getModifierState?: (key: "AltGraph") => boolean;
};

const MODIFIER_KEYS = new Set(["Control", "Meta", "Alt", "AltGraph", "Shift", "OS"]);

type Press = Modifiers & {
  /** The key's place, named as in Keys. */
  place: string;
  /** The Latin letter typed, or the letter key's place without one. */
  letter: string | null;
  character: string;
};

/** The place name for a physical key: "Digit1" is "1", "Period" is "period". */
function placeOf(code: string): string {
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (digit) return digit[1];
  if (code === "NumpadEnter") return "enter";
  return code.toLowerCase();
}

function readPress(e: KeyPress): Press | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  // AltGr reports Ctrl and Alt on Windows, but it types a character
  // ("{" on a German keyboard, "ą" on a Polish one), so it's never a shortcut.
  if (e.getModifierState?.("AltGraph")) return null;
  // The Windows and Super keys belong to the system.
  if (!IS_MAC && e.metaKey) return null;

  const letterKey = /^Key([A-Z])$/.exec(e.code);
  const typed = e.key.length === 1 ? e.key.toLowerCase() : "";
  const letter = /^[a-z]$/.test(typed)
    ? typed
    : letterKey
      ? letterKey[1].toLowerCase()
      : null;
  return {
    mod: IS_MAC ? e.metaKey : e.ctrlKey,
    ctrl: IS_MAC && e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    place: placeOf(e.code),
    letter,
    character: e.key,
  };
}

function pressMatches(press: Press, keys: Parsed): boolean {
  if (press.mod !== keys.mod || press.ctrl !== keys.ctrl || press.alt !== keys.alt) {
    return false;
  }
  if (keys.kind === "character") {
    // Shift may be what types the character, so it isn't compared.
    return press.character === (CHARACTER_NAMES[keys.key] ?? keys.key);
  }
  if (press.shift !== keys.shift) return false;
  return keys.kind === "letter" && press.letter
    ? press.letter === keys.key
    : press.place === keys.key;
}

/** Whether a key press is these keys. */
export function matchesKeys(e: KeyPress, keys: Keys): boolean {
  const press = readPress(e);
  const parsed = parse(keys);
  return press !== null && parsed !== null && pressMatches(press, parsed);
}

/**
 * The keys a press makes, as Settings saves them: letters by character,
 * everything else by place. Null until a key other than a modifier is down.
 */
export function keysOfPress(e: KeyPress): Keys | null {
  const press = readPress(e);
  const key = press?.letter ?? press?.place;
  return press && key ? write({ ...press, key }) : null;
}

// ── Lookup ──────────────────────────────────────────────────────────────────

function isChangeable(shortcut: Shortcut): boolean {
  return !("fixed" in shortcut);
}

function defaultBindings(shortcut: Shortcut): readonly Keys[] {
  return [
    ...shortcut.keys,
    ...("alternates" in shortcut ? shortcut.alternates : []),
  ];
}

/** Every key combination that runs a shortcut, changed ones included. */
export function bindingsOf(
  shortcut: Shortcut,
  overrides: ShortcutOverrides,
): readonly Keys[] {
  return (isChangeable(shortcut) && overrides[shortcut.id]) || defaultBindings(shortcut);
}

/** The keys Settings, menus and tooltips show for a shortcut. */
export function shownKeys(
  shortcut: Shortcut,
  overrides: ShortcutOverrides,
): readonly Keys[] {
  return (isChangeable(shortcut) && overrides[shortcut.id]) || shortcut.keys;
}

export function isChanged(shortcut: Shortcut, overrides: ShortcutOverrides) {
  return isChangeable(shortcut) && overrides[shortcut.id] !== undefined;
}

/** The shortcut of a scope that a key press runs, if any. */
export function findShortcut<S extends ShortcutScope>(
  e: KeyPress,
  scope: S,
  overrides: ShortcutOverrides,
): Extract<Shortcut, { id: ShortcutIdIn<S> }> | undefined {
  const press = readPress(e);
  if (!press) return undefined;
  return SHORTCUTS.find(
    (shortcut) =>
      shortcut.scope === scope &&
      isChangeable(shortcut) &&
      bindingsOf(shortcut, overrides).some((keys) => {
        const parsed = parse(keys);
        return parsed !== null && pressMatches(press, parsed);
      }),
  ) as Extract<Shortcut, { id: ShortcutIdIn<S> }> | undefined;
}

/**
 * Whether a key going up lets go of a shortcut: one of its modifiers other
 * than Shift is no longer held. Ends Ctrl+Tab's walk through Recent.
 */
export function releasesShortcut(
  e: KeyPress,
  shortcut: Shortcut,
  overrides: ShortcutOverrides,
): boolean {
  const held: Modifiers = {
    mod: IS_MAC ? e.metaKey : e.ctrlKey,
    ctrl: IS_MAC && e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
  };
  return bindingsOf(shortcut, overrides).some((keys) => {
    const parsed = parse(keys);
    return (
      parsed !== null &&
      (["mod", "ctrl", "alt"] as const).some((name) => parsed[name] && !held[name])
    );
  });
}

// ── Changing keys ───────────────────────────────────────────────────────────

function scopesOverlap(a: ShortcutScope, b: ShortcutScope): boolean {
  // App shortcuts work in the editor, so they share its keys. Drawing keys
  // aren't ours to move, so an app shortcut may use them too.
  return a === b || (a !== "canvas" && b !== "canvas");
}

function hasKeys(list: readonly Keys[], keys: Keys): boolean {
  return list.some((each) => normalizeKeys(each) === keys);
}

/** Two shortcuts that share these keys by default, as Bold and the sidebar do. */
function isDefaultPair(a: Shortcut, b: Shortcut, keys: Keys): boolean {
  return hasKeys(defaultBindings(a), keys) && hasKeys(defaultBindings(b), keys);
}

export type KeysProblem =
  /** Needs Mod or Alt, or it would stop typing. */
  | { kind: "modifier" }
  | { kind: "reserved"; label: string }
  /** Another shortcut uses the keys. Changeable ones can be replaced. */
  | { kind: "taken"; by: Shortcut };

/**
 * Why a shortcut can't simply take these keys, or null when it can. A pair
 * that shares keys by default (Bold and the sidebar on Mod+B) isn't a clash.
 */
export function keysProblem(
  shortcut: Shortcut,
  keys: Keys,
  overrides: ShortcutOverrides,
): KeysProblem | null {
  const parsed = parse(keys);
  if (!parsed || !(parsed.mod || parsed.alt)) return { kind: "modifier" };
  const written = write(parsed);
  const reserved = RESERVED_KEYS.find((r) => normalizeKeys(r.keys) === written);
  if (reserved) return { kind: "reserved", label: reserved.label };
  const by = SHORTCUTS.find(
    (other) =>
      other.id !== shortcut.id &&
      scopesOverlap(other.scope, shortcut.scope) &&
      hasKeys(bindingsOf(other, overrides), written) &&
      !isDefaultPair(shortcut, other, written),
  );
  return by ? { kind: "taken", by } : null;
}

/** Drops changes that are the defaults again, so later defaults reach them. */
function withChange(
  overrides: ShortcutOverrides,
  shortcut: Shortcut,
  bindings: Keys[],
): ShortcutOverrides {
  const next = { ...overrides };
  const defaults = defaultBindings(shortcut).map(normalizeKeys);
  if (
    bindings.length === defaults.length &&
    bindings.every((keys, i) => keys === defaults[i])
  ) {
    delete next[shortcut.id];
  } else {
    next[shortcut.id] = bindings;
  }
  return next;
}

/**
 * Gives a shortcut these keys. Any other shortcut using them in the same
 * place loses them, and is left without keys if they were its only ones.
 */
export function assignKeys(
  overrides: ShortcutOverrides,
  shortcut: Shortcut,
  keys: Keys,
): ShortcutOverrides {
  const written = normalizeKeys(keys);
  if (!written) return overrides;
  let next = withChange(overrides, shortcut, [written]);
  for (const other of SHORTCUTS) {
    if (
      other.id === shortcut.id ||
      !isChangeable(other) ||
      !scopesOverlap(other.scope, shortcut.scope) ||
      isDefaultPair(shortcut, other, written)
    ) {
      continue;
    }
    const bindings = bindingsOf(other, next);
    if (hasKeys(bindings, written)) {
      next = withChange(
        next,
        other,
        bindings.flatMap((each) => {
          const normal = normalizeKeys(each);
          return normal && normal !== written ? [normal] : [];
        }),
      );
    }
  }
  return next;
}

/**
 * What stands in the way of putting a shortcut back to its default keys:
 * another shortcut now using one of them.
 */
export function resetProblem(
  shortcut: Shortcut,
  overrides: ShortcutOverrides,
): Extract<KeysProblem, { kind: "taken" }> | null {
  const rest = { ...overrides };
  delete rest[shortcut.id];
  for (const keys of defaultBindings(shortcut)) {
    const written = normalizeKeys(keys);
    if (!written) continue;
    const problem = keysProblem(shortcut, written, rest);
    if (problem?.kind === "taken") return problem;
  }
  return null;
}

/** Puts a shortcut back to its default keys, taking them from any other. */
export function resetKeys(
  overrides: ShortcutOverrides,
  shortcut: Shortcut,
): ShortcutOverrides {
  let next = { ...overrides };
  delete next[shortcut.id];
  for (const keys of defaultBindings(shortcut)) {
    const problem = keysProblem(shortcut, keys, next);
    if (problem?.kind !== "taken") continue;
    next = assignKeys(next, shortcut, keys);
    delete next[shortcut.id];
  }
  return next;
}

/**
 * Saved changes as read back, without anything malformed. Ids this version
 * doesn't know are kept, for the version that does.
 */
export function sanitizeOverrides(value: unknown): ShortcutOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const clean: ShortcutOverrides = {};
  for (const [id, keys] of Object.entries(value)) {
    if (!Array.isArray(keys)) continue;
    const written = keys.flatMap((each) =>
      typeof each === "string" && normalizeKeys(each) ? [normalizeKeys(each)!] : [],
    );
    if (written.length === keys.length) clean[id] = written;
  }
  return clean;
}
