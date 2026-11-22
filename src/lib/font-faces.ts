// WebKit rebuilds its style rules whenever it frees memory (every 30 s while
// the app uses a lot, as with a long shard open) or a style sheet changes. The rebuild adds each CSS
// @font-face again, and one whose font already loaded makes WebKit restyle
// the whole page: about a second with a long shard open. Fonts added through
// document.fonts aren't rebuilt, so every @font-face moves there.

const DESCRIPTORS = [
  ["style", "font-style"],
  ["weight", "font-weight"],
  ["stretch", "font-stretch"],
  ["unicodeRange", "unicode-range"],
  ["display", "font-display"],
  ["featureSettings", "font-feature-settings"],
] as const;

/** Rules already moved, so a style sheet that comes back (dev reloads) adds no copies. */
const moved = new Set<string>();

/** The family as FontFace takes it: the name itself, without CSS quotes. */
function familyName(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted ? quoted[2] : value;
}

function fontFaceFrom(rule: CSSFontFaceRule): FontFace {
  const { style } = rule;
  const descriptors: Record<string, string> = {};
  for (const [key, property] of DESCRIPTORS) {
    const value = style.getPropertyValue(property);
    if (value) descriptors[key] = value;
  }
  // The values are the browser's own serialization, so they parse.
  const family = familyName(style.getPropertyValue("font-family"));
  return new FontFace(family, style.getPropertyValue("src"), descriptors as FontFaceDescriptors);
}

function moveRules(owner: CSSStyleSheet | CSSGroupingRule) {
  const rules = owner.cssRules;
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i];
    if (rule instanceof CSSGroupingRule) moveRules(rule);
    if (!(rule instanceof CSSFontFaceRule)) continue;
    if (!moved.has(rule.cssText)) {
      moved.add(rule.cssText);
      document.fonts.add(fontFaceFrom(rule));
    }
    owner.deleteRule(i);
  }
}

function moveSheet(element: Element) {
  if (!(element instanceof HTMLStyleElement || element instanceof HTMLLinkElement)) return;
  const { sheet } = element;
  if (sheet) moveRules(sheet);
  else if (element instanceof HTMLLinkElement) {
    element.addEventListener("load", () => moveSheet(element), { once: true });
  }
}

/** Moves the page's @font-face rules to document.fonts, now and as more style sheets arrive. */
export function moveFontFacesToScript() {
  const head = document.head;
  for (const element of head.querySelectorAll("style, link[rel~='stylesheet']")) moveSheet(element);
  new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target && target !== head) moveSheet(target);
      for (const node of record.addedNodes) if (node instanceof Element) moveSheet(node);
    }
  }).observe(head, { childList: true, subtree: true, characterData: true });
}
