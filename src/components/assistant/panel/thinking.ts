/** A message, or a step of an answer still coming in. */
type Step = { role?: "user" | "assistant"; text: string; reasoning?: string };

/**
 * `steps` with thinking that has no text after it, before another step of
 * the same answer, shown with that step: an answer that thinks between
 * tools shows one Thinking, not one per tool.
 */
export function foldThinking<T extends Step>(steps: T[]): T[] {
  const folded: T[] = [];
  let carried = "";
  steps.forEach((step, index) => {
    const next = steps[index + 1];
    const reasoning = joinThinking(carried, step.reasoning ?? "");
    const answers = step.role !== "user";
    if (answers && !step.text && next && next.role !== "user") {
      carried = reasoning;
      return;
    }
    folded.push(answers && carried ? { ...step, reasoning } : step);
    carried = "";
  });
  return folded;
}

/** Thinking in one step, then the next. */
export function joinThinking(before: string, after: string) {
  return [before, after].filter(Boolean).join("\n\n");
}
