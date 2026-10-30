import { caretAfter, editor, expect, lastSave, mockVault, test } from "./vault";

const FENCE = "```mermaid\nflowchart LR\n  Draft --> Review\n```";

test("a mermaid code block is drawn and saved as it was written", async ({
  page,
}) => {
  await mockVault(page, {
    files: { "Plan.md": `# Plan\n\n${FENCE}\n` },
    open: "Plan.md",
  });

  const diagram = editor(page).getByRole("img", { name: "Diagram" });
  await expect(diagram.getByText("Review")).toBeVisible();

  await caretAfter(page, "Draft --> Review");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Review --> Done");
  await expect(diagram.getByText("Done")).toBeVisible();

  const saved = await lastSave(page, "Plan.md");
  expect(saved).toContain(
    "```mermaid\nflowchart LR\n  Draft --> Review\n  Review --> Done\n```",
  );
});

test("a diagram with a mistake says so instead of drawing", async ({ page }) => {
  await mockVault(page, {
    files: { "Plan.md": "# Plan\n\n```mermaid\nflowchart LR\n  A -->\n```\n" },
    open: "Plan.md",
  });

  await expect(editor(page).getByText("This diagram can't be drawn.")).toBeVisible();
  await expect(editor(page).getByRole("img", { name: "Diagram" })).toHaveCount(0);
});

test("a diagram from the / menu starts drawn and saves as a mermaid block", async ({
  page,
}) => {
  await mockVault(page, {
    files: { "Note.md": "# Note\n\nStart\n" },
    open: "Note.md",
  });
  await caretAfter(page, "Start");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/diagram", { delay: 40 });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(
    editor(page).getByRole("img", { name: "Diagram" }).getByText("B", { exact: true }),
  ).toBeVisible();

  const saved = await lastSave(page, "Note.md");
  expect(saved).toContain("```mermaid\nflowchart LR\n  A --> B\n```");
});
