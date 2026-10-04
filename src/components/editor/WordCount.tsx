import { useEffect, useState } from "react";
import { NodeApi } from "platejs";

import { useEditorStore, useSettingsStore } from "@/store";

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}

/** The open shard's word count, when turned on in Settings. */
export function WordCount() {
  const enabled = useSettingsStore((s) => s.showWordCount);
  const editor = useEditorStore((s) => s.plateEditor);
  const editTick = useEditorStore((s) => s.editTick);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || !editor) {
      setCount(null);
      return;
    }
    // Counting walks the whole document, so wait for a pause in typing.
    const timer = window.setTimeout(() => {
      const text = editor.children
        .map((node) => NodeApi.string(node))
        .join("\n");
      setCount(countWords(text));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [enabled, editor, editTick]);

  if (count === null) return null;

  return (
    <span className="text-muted-foreground text-xs tabular-nums">
      {count.toLocaleString()} {count === 1 ? "word" : "words"}
    </span>
  );
}
