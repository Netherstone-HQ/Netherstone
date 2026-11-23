import { lazy, Suspense } from 'react';
import { BaseEquationPlugin, BaseInlineEquationPlugin } from '@platejs/math';
import {
  isHotkey,
  PathApi,
  PointApi,
  RangeApi,
  TextApi,
  type Path,
  type SlateEditor,
  type TEquationElement,
} from 'platejs';
import {
  PlateElement,
  toPlatePlugin,
  type PlateElementProps,
} from 'platejs/react';

import { stepOver } from '@/components/editor/step-over';

// The equation components bring KaTeX, so they load with the first equation
// shown, not with the app. Until then an equation shows its TeX.
const LazyEquationElement = lazy(() =>
  import('@/components/ui/equation-node').then((m) => ({
    default: m.EquationElement,
  }))
);
const LazyInlineEquationElement = lazy(() =>
  import('@/components/ui/equation-node').then((m) => ({
    default: m.InlineEquationElement,
  }))
);

function EquationSource(props: PlateElementProps<TEquationElement>) {
  return (
    <PlateElement {...props}>
      <span contentEditable={false} className="font-mono text-muted-foreground">
        {props.element.texExpression}
      </span>
      {props.children}
    </PlateElement>
  );
}

function EquationElement(props: PlateElementProps<TEquationElement>) {
  return (
    <Suspense fallback={<EquationSource {...props} />}>
      <LazyEquationElement {...props} />
    </Suspense>
  );
}

function InlineEquationElement(props: PlateElementProps<TEquationElement>) {
  return (
    <Suspense fallback={<EquationSource {...props} />}>
      <LazyInlineEquationElement {...props} />
    </Suspense>
  );
}

const EquationPlugin = toPlatePlugin(BaseEquationPlugin);
const InlineEquationPlugin = toPlatePlugin(BaseInlineEquationPlugin);

/**
 * The inline equation selected, or the one the caret is right next to
 * inside a line. At a line's start or end Enter still starts a new line.
 */
function equationAt(editor: SlateEditor, type: string): Path | undefined {
  const { selection } = editor;
  if (!selection) return;
  const isEquation = (at: Path) => editor.api.node(at)?.[0].type === type;

  if (editor.api.isExpanded()) {
    const [equation] = editor.api.nodes({ at: selection, match: { type } });
    if (!equation) return;
    // Only the equation: from the end of the text before it to the start of
    // the text after it (Slate keeps a text on each side of an inline).
    const at = equation[1];
    const before = PathApi.previous(at);
    const [start, end] = RangeApi.edges(selection);
    const exact =
      before &&
      PointApi.equals(start, editor.api.end(before)!) &&
      PointApi.equals(end, editor.api.start(PathApi.next(at))!);
    return exact ? at : undefined;
  }

  const block = editor.api.block();
  if (!block || editor.api.isEdge(selection.anchor, block[1])) return;
  const { offset, path } = selection.anchor;
  const text = editor.api.node(path)?.[0];
  if (!TextApi.isText(text)) return;
  const before = offset === 0 && PathApi.previous(path);
  if (before && isEquation(before)) return before;
  const after = offset === text.text.length && PathApi.next(path);
  if (after && isEquation(after)) return after;
}

export const MathKit = [
  InlineEquationPlugin.overrideEditor(stepOver)
    .extend({
      handlers: {
        /** Enter opens the equation next to the caret: the keyboard way in. */
        onKeyDown: ({ editor, event, type }) => {
          if (!isHotkey('enter', event) || event.nativeEvent.isComposing) return;
          const at = equationAt(editor, type);
          if (!at) return;
          event.preventDefault();
          // A caret inside the equation opens its editor, as a click does.
          editor.tf.select(at);
          return true;
        },
      },
    })
    .withComponent(InlineEquationElement),
  EquationPlugin.withComponent(EquationElement),
];
