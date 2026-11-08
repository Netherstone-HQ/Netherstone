import { describe, expect, it } from "vitest";

import { foldThinking } from "./thinking";

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
