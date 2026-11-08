// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnswerText, useParsedAnswer } from "@/components/assistant/AnswerText";

import { settledMarkdown } from "./streaming-markdown";

/** An answer with what can change form while it streams. */
const ANSWER = [
  "The trip starts on **May 3** [Trip plan](Travel/Trip%20plan.md#Day%201). Pack `light`.",
  "As [Budget](Budget.md) says, it fits, and [the board](https://trains.example) has times.",
  "Plan\n---",
  "- Train to Lisbon [Trip plan](Travel/Trip%20plan.md), then *the bus*.\n- Back by ~~plane~~ train.",
  "| Day | Where |\n| --- | --- |\n| 1 | Lisbon |\n| 2 | Sintra |",
  "1. Passports\n2. Chargers",
  "```\nParis 19:40 -> Hendaye [06:10]\n```",
  "Done [Budget](Budget.md)",
].join("\n\n");

/** Each top-level block's HTML, and the text shown. */
function shown(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  const blocks = [...(root.firstElementChild?.children ?? [])].map((block) => block.outerHTML);
  return { blocks, text: root.textContent ?? "" };
}

describe("settledMarkdown", () => {
  it("closes bold, italic and inline code that are still coming", () => {
    expect(settledMarkdown("It is **very")).toBe("It is **very**");
    expect(settledMarkdown("Run `pnpm te")).toBe("Run `pnpm te`");
  });

  it("holds back a link until it's complete and the next word decides cite or name", () => {
    expect(settledMarkdown("We go in May [Trip")).toBe("We go in May");
    expect(settledMarkdown("We go in May [Trip](Trip.md#Da")).toBe("We go in May");
    expect(settledMarkdown("We go in May [Trip](Trip.md)")).toBe("We go in May");
    expect(settledMarkdown("We go in May [Trip](Trip.md) ")).toBe("We go in May");
    expect(settledMarkdown("We go in May [Trip](Trip.md).")).toBe(
      "We go in May [Trip](Trip.md).",
    );
    // Two cites in a row wait for what follows the second.
    expect(settledMarkdown("In May [Trip](Trip.md) [Plan](Plan.md")).toBe("In May");
    expect(settledMarkdown("In May [Trip](Trip.md) [Plan](Plan.md),")).toBe(
      "In May [Trip](Trip.md) [Plan](Plan.md),",
    );
  });

  it("holds back a link with a title or an angle-bracket target the same way", () => {
    expect(settledMarkdown('See [Trip](Trip.md "The tr')).toBe("See");
    expect(settledMarkdown("See [Trip](<Trip plan.md")).toBe("See");
  });

  it("leaves brackets that aren't a link alone", () => {
    expect(settledMarkdown("Tick [x] done")).toBe("Tick [x] done");
  });

  it("holds back a table until its delimiter row is complete", () => {
    expect(settledMarkdown("Costs:\n\n| Item | Cost |")).toBe("Costs:\n");
    expect(settledMarkdown("Costs:\n\n| Item | Cost |\n| --- | -")).toBe("Costs:\n");
    // A table needs no pipe at the start of its lines.
    expect(settledMarkdown("Costs:\n\nItem | Cost\n")).toBe("Costs:\n");
    expect(settledMarkdown("Costs:\n\nItem | Cost\n--|--\nTrain | 3")).toBe(
      "Costs:\n\nItem | Cost\n--|--\nTrain | 3",
    );
    expect(settledMarkdown("Costs:\n\n| Item | Cost |\n| --- | --- |\n| Tra")).toBe(
      "Costs:\n\n| Item | Cost |\n| --- | --- |\n| Tra",
    );
  });

  it("holds back a line that may still become a list item, a rule or an underline", () => {
    expect(settledMarkdown("Plan\n-")).toBe("Plan\n");
    expect(settledMarkdown("Plan\n==")).toBe("Plan\n");
    expect(settledMarkdown("Steps:\n\n1.")).toBe("Steps:\n\n");
    expect(settledMarkdown("Steps:\n\n1. Pack")).toBe("Steps:\n\n1. Pack");
  });

  it("holds back a code fence until it's sure, and its closing line", () => {
    expect(settledMarkdown("Times:\n\n``")).toBe("Times:\n\n");
    expect(settledMarkdown("Times:\n\n```te")).toBe("Times:\n\n");
    expect(settledMarkdown("Times:\n\n```\nParis 19:40\n``")).toBe("Times:\n\n```\nParis 19:40");
    expect(settledMarkdown("Times:\n\n```\nParis 19:40\n")).toBe("Times:\n\n```\nParis 19:40");
    // A fence with an info string opens one, it doesn't close one.
    expect(settledMarkdown("```md\n```js\nfoo [x")).toBe("```md\n```js\nfoo [x");
    // Brackets and pipes in code are code.
    expect(settledMarkdown("```\nlist[0\n| a")).toBe("```\nlist[0\n| a");
  });
});

describe("an answer streaming in", () => {
  it("only grows: no text goes away and no block above the last changes", () => {
    const { result, rerender } = renderHook(
      ({ text }) => useParsedAnswer(settledMarkdown(text)),
      { initialProps: { text: "" } },
    );
    const render = () =>
      shown(
        renderToStaticMarkup(
          <AnswerText answer={result.current} onOpenShard={() => {}} onOpenLink={() => {}} />,
        ),
      );
    let before = render();
    for (let end = 1; end <= ANSWER.length; end += 1) {
      rerender({ text: ANSWER.slice(0, end) });
      const now = render();
      const at = JSON.stringify(ANSWER.slice(0, end));
      expect(now.text.startsWith(before.text), at).toBe(true);
      expect(now.blocks.slice(0, before.blocks.length - 1), at).toEqual(
        before.blocks.slice(0, -1),
      );
      before = now;
    }
    // Saved, the answer only adds what was held back at its end: here,
    // the cite that ends it.
    const saved = renderHook(() => useParsedAnswer(ANSWER)).result.current;
    const whole = shown(
      renderToStaticMarkup(
        <AnswerText answer={saved} onOpenShard={() => {}} onOpenLink={() => {}} />,
      ),
    );
    expect(whole.text).toBe(`${before.text} Budget2`);
    expect(whole.blocks.slice(0, -1)).toEqual(before.blocks.slice(0, -1));
  });
});
