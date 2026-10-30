'use client';

import type { SlateEditor } from 'platejs';

import {
  createSlatePlugin,
  createTextSubstitutionInputRule,
  defineInputRule,
  KEYS,
  NodeApi,
} from 'platejs';

// Code is kept as typed, both in code blocks and in inline code.
const isTextSubstitutionBlocked = (editor: SlateEditor) =>
  !!editor.api.marks()?.[editor.getType(KEYS.code)] ||
  editor.api.some({
    match: {
      type: [editor.getType(KEYS.codeBlock)],
    },
  });

const createAutoformatTextSubstitutionRule = ({
  patterns,
}: {
  patterns: Parameters<typeof createTextSubstitutionInputRule>[0]['patterns'];
}) =>
  createTextSubstitutionInputRule({
    enabled: ({ editor }) => !isTextSubstitutionBlocked(editor),
    patterns,
  });

const arrowsRule = createAutoformatTextSubstitutionRule({
  patterns: [
    { format: '→', match: '->' },
    { format: '←', match: '<-' },
    { format: '⇒', match: '=>' },
    { format: '⇐', match: '≤=' },
  ],
});

const comparisonsRule = createAutoformatTextSubstitutionRule({
  patterns: [
    { format: '≯', match: '!>' },
    { format: '≮', match: '!<' },
    { format: '≥', match: '>=' },
    { format: '≤', match: '<=' },
    { format: '≱', match: ['!>=', '≯='] },
    { format: '≰', match: ['!<=', '≮='] },
  ],
});

const equalityRule = createAutoformatTextSubstitutionRule({
  patterns: [
    { format: '≠', match: '!=' },
    { format: '≡', match: '==' },
    { format: '≢', match: ['!==', '≠='] },
    { format: '≉', match: '!~=' },
    { format: '≈', match: '~=' },
  ],
});

const fractions = new Map([
  ['1/2', '½'],
  ['1/3', '⅓'],
  ['1/4', '¼'],
  ['1/5', '⅕'],
  ['1/6', '⅙'],
  ['1/7', '⅐'],
  ['1/8', '⅛'],
  ['1/9', '⅑'],
  ['1/10', '⅒'],
  ['2/3', '⅔'],
  ['2/5', '⅖'],
  ['3/4', '¾'],
  ['3/5', '⅗'],
  ['3/8', '⅜'],
  ['4/5', '⅘'],
  ['5/6', '⅚'],
  ['5/8', '⅝'],
  ['7/8', '⅞'],
]);
const longestFraction = Math.max(...[...fractions.keys()].map((match) => match.length));

// A fraction is only known once the number ends, so it is replaced when a
// space or punctuation follows it, and only when it stands on its own:
// 1/2 inside 1/2/2026, 11/2 or 1/25 stays as typed.
const fractionsRule = defineInputRule({
  target: 'insertText',
  trigger: [' ', ',', ';', ':', '!', '?', ')'],
  enabled: ({ editor }) => !isTextSubstitutionBlocked(editor),
  resolve: ({ editor }) => {
    const anchor = editor.selection?.anchor;
    if (!anchor || !editor.api.isCollapsed()) return;
    const text = NodeApi.string(NodeApi.get(editor, anchor.path)!);
    const before = text.slice(Math.max(0, anchor.offset - longestFraction - 1), anchor.offset);
    for (const [match, format] of fractions) {
      if (!before.endsWith(match)) continue;
      const previous = before.at(-match.length - 1);
      if (previous && /[\p{L}\p{N}/.]/u.test(previous)) return;
      return { format, match };
    }
  },
  apply: ({ editor, options, text }, { format, match }) => {
    editor.tf.delete({ distance: match.length, reverse: true, unit: 'character' });
    editor.tf.insertText(format);
    editor.tf.insertText(text, options);
  },
});

const legalRule = createAutoformatTextSubstitutionRule({
  patterns: [
    { format: '™', match: ['(tm)', '(TM)'] },
    { format: '®', match: ['(r)', '(R)'] },
    { format: '©', match: ['(c)', '(C)'] },
  ],
});

const legalHtmlRule = createAutoformatTextSubstitutionRule({
  patterns: [
    { format: '™', match: '&trade;' },
    { format: '®', match: '&reg;' },
    { format: '©', match: '&copy;' },
    { format: '§', match: '&sect;' },
  ],
});

const operatorsRule = createAutoformatTextSubstitutionRule({
  patterns: [
    { format: '±', match: '+-' },
    { format: '‰', match: '%%' },
    { format: '‱', match: ['%%%', '‰%'] },
  ],
});

const punctuationRule = createAutoformatTextSubstitutionRule({
  patterns: [
    { format: '»', match: '>>' },
    { format: '«', match: '<<' },
  ],
});

const smartQuotesRule = createAutoformatTextSubstitutionRule({
  patterns: [
    { format: ['“', '”'], match: '"' },
    { format: ['‘', '’'], match: "'" },
  ],
});

const subscriptNumbersRule = createAutoformatTextSubstitutionRule({
  patterns: [
    { format: '₀', match: '~0' },
    { format: '₁', match: '~1' },
    { format: '₂', match: '~2' },
    { format: '₃', match: '~3' },
    { format: '₄', match: '~4' },
    { format: '₅', match: '~5' },
    { format: '₆', match: '~6' },
    { format: '₇', match: '~7' },
    { format: '₈', match: '~8' },
    { format: '₉', match: '~9' },
  ],
});

const subscriptSymbolsRule = createAutoformatTextSubstitutionRule({
  patterns: [
    { format: '₊', match: '~+' },
    { format: '₋', match: '~-' },
  ],
});

const superscriptNumbersRule = createAutoformatTextSubstitutionRule({
  patterns: [
    { format: '⁰', match: '^0' },
    { format: '¹', match: '^1' },
    { format: '²', match: '^2' },
    { format: '³', match: '^3' },
    { format: '⁴', match: '^4' },
    { format: '⁵', match: '^5' },
    { format: '⁶', match: '^6' },
    { format: '⁷', match: '^7' },
    { format: '⁸', match: '^8' },
    { format: '⁹', match: '^9' },
  ],
});

const superscriptSymbolsRule = createAutoformatTextSubstitutionRule({
  patterns: [
    { format: '°', match: '^o' },
    { format: '⁺', match: '^+' },
    { format: '⁻', match: '^-' },
  ],
});

const AutoformatShortcutsPlugin = createSlatePlugin({
  key: 'autoformatShortcuts',
  inputRules: [
    legalRule,
    legalHtmlRule,
    arrowsRule,
    comparisonsRule,
    equalityRule,
    fractionsRule,
    operatorsRule,
    punctuationRule,
    smartQuotesRule,
    subscriptNumbersRule,
    subscriptSymbolsRule,
    superscriptNumbersRule,
    superscriptSymbolsRule,
  ],
});

export const AutoformatKit = [AutoformatShortcutsPlugin];
