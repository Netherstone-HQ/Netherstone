import { describe, expect, it } from "vitest";

import { countWords } from "./WordCount";

describe("countWords", () => {
  it("counts words, not punctuation or spacing", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  Hello,   world!  ")).toBe(2);
    expect(countWords("It's a well-known fact — 42 times.")).toBe(6);
    expect(countWords("Café crème\nnaïve")).toBe(3);
  });
});
