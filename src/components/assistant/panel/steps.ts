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

/**
 * Each answer's whole text, by the seq of its last message with text,
 * where its Copy row goes.
 */
export function answerTexts(messages: (Step & { seq: number })[]): Map<number, string> {
  const answers = new Map<number, string>();
  let texts: string[] = [];
  let last: number | null = null;
  const endAnswer = () => {
    if (last !== null) answers.set(last, texts.join("\n\n"));
    texts = [];
    last = null;
  };
  for (const message of messages) {
    if (message.role === "user") endAnswer();
    else if (message.text) {
      texts.push(message.text);
      last = message.seq;
    }
  }
  endAnswer();
  return answers;
}
