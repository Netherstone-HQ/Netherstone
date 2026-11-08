// @vitest-environment jsdom
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnswerText, useParsedAnswer } from "./AnswerText";

afterEach(cleanup);

const ANSWER = [
  "The trip starts on May 3 [Trip plan](Travel/Trip%20plan.md#Day%201).",
  "- Train to Lisbon [Trip plan](Travel/Trip%20plan.md).\n- Back by bus [Budget](Budget.md).",
  "| Day | Where |\n| --- | --- |\n| 1 | Lisbon |",
  "As [Budget](Budget.md) says, it fits.",
  "The route: ![map][route]",
  "Train times are on the board.",
  "[route]: https://pictures.example/route.png",
].join("\n\n");

/** The tree without where each node came from, to compare two parses. */
function shape(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, field) => (key === "position" ? undefined : field)),
  );
}

describe("AnswerText", () => {
  it("shows a cite as its shard's name, then its number", () => {
    const onOpenShard = vi.fn();
    const { result } = renderHook(() => useParsedAnswer(ANSWER));
    render(
      <AnswerText answer={result.current} onOpenShard={onOpenShard} onOpenLink={vi.fn()} />,
    );
    const cites = screen.getAllByRole("button", { name: /^Open / });
    expect(cites.map((cite) => cite.textContent)).toEqual([
      "Trip plan1",
      "Trip plan1",
      "Budget2",
    ]);
    // A shard named in a sentence stays its name, with no number.
    expect(screen.getByRole("button", { name: "Budget" }).textContent).toBe("Budget");
    cites[2].click();
    expect(onOpenShard).toHaveBeenCalledWith({ path: "Budget.md", section: null });
  });

  it("parses an answer streaming in as it parses the whole, keeping finished blocks", () => {
    const { result, rerender } = renderHook(({ text }) => useParsedAnswer(text), {
      initialProps: { text: "" },
    });
    let previous = result.current;
    // Every few characters, as batches come.
    for (let end = 1; end <= ANSWER.length; end += 7) {
      const text = ANSWER.slice(0, end);
      rerender({ text });
      const whole = renderHook(() => useParsedAnswer(text)).result.current;
      expect(shape(result.current.tree)).toEqual(shape(whole.tree));
      expect(result.current.cited).toEqual(whole.cited);
      // All but the last block are the very nodes of the batch before,
      // until a definition comes.
      const before = previous.tree.children ?? [];
      const now = result.current.tree.children ?? [];
      if (!text.includes("[route]:")) {
        for (let index = 0; index < before.length - 1; index += 1) {
          expect(now[index]).toBe(before[index]);
        }
      }
      previous = result.current;
    }
    rerender({ text: ANSWER });
    const whole = renderHook(() => useParsedAnswer(ANSWER)).result.current;
    expect(shape(result.current.tree)).toEqual(shape(whole.tree));
    // The image above its definition reads as an image once it comes.
    render(<AnswerText answer={result.current} onOpenShard={vi.fn()} onOpenLink={vi.fn()} />);
    expect(screen.getByText(/https:\/\/pictures\.example\/route\.png/)).toBeTruthy();
    expect(screen.queryByText(/!\[map\]/)).toBeNull();
  });
});
