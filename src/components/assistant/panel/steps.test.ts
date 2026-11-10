import { describe, expect, it } from "vitest";

import { answerTexts, foldThinking } from "./steps";

describe("foldThinking", () => {
  it("shows thinking between tools with the step after it", () => {
    expect(
      foldThinking([
        { role: "user", text: "Outline the vault" },
        { role: "assistant", text: "", reasoning: "List the folders." },
        { role: "assistant", text: "", reasoning: "Read the overview." },
        { role: "assistant", text: "Here it is.", reasoning: "Write it up." },
      ]),
    ).toEqual([
      { role: "user", text: "Outline the vault" },
      {
        role: "assistant",
        text: "Here it is.",
        reasoning: "List the folders.\n\nRead the overview.\n\nWrite it up.",
      },
    ]);
  });

  it("keeps thinking apart from text before it and from the next question", () => {
    const steps = [
      { role: "assistant" as const, text: "Let me look.", reasoning: "Look." },
      { role: "assistant" as const, text: "", reasoning: "Stopped here." },
      { role: "user" as const, text: "Go on" },
    ];
    expect(foldThinking(steps)).toEqual(steps);
  });
});

describe("answerTexts", () => {
  it("puts each answer's text on its last message with text", () => {
    const answers = answerTexts([
      { seq: 1, role: "user", text: "Is the return booked?" },
      { seq: 2, role: "assistant", text: "Let me look." },
      { seq: 4, role: "assistant", text: "Not yet." },
      // A step that only ran a tool, then stopped.
      { seq: 6, role: "assistant", text: "" },
      { seq: 7, role: "user", text: "Book it" },
      { seq: 8, role: "assistant", text: "" },
    ]);
    expect([...answers]).toEqual([[4, "Let me look.\n\nNot yet."]]);
  });
});
