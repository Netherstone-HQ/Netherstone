import { caretAfter, editor, expect, lastSave, mockVault, test } from "./vault";

const FENCE = "```mermaid\nflowchart LR\n  Draft --> Review\n```";

test("a mermaid code block opens on its diagram and saves as it was written", async ({
  page,
}) => {
  await mockVault(page, {
    files: { "Plan.md": `# Plan\n\n${FENCE}\n` },
    open: "Plan.md",
  });

  const diagram = editor(page).getByRole("img", { name: "Diagram" });
  const code = editor(page).getByText("Draft --> Review");
  await expect(diagram.getByText("Review")).toBeVisible();
  await expect(code).toBeHidden();

  // The code can be edited with the diagram still showing.
  await editor(page).getByRole("radio", { name: "Both" }).click();
  await expect(code).toBeVisible();
  await caretAfter(page, "Draft --> Review");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Review --> Done");
  await expect(diagram.getByText("Done")).toBeVisible();

  const saved = await lastSave(page, "Plan.md");
  expect(saved).toContain(
    "```mermaid\nflowchart LR\n  Draft --> Review\n  Review --> Done\n```",
  );

  await editor(page).getByRole("radio", { name: "Code" }).click();
  await expect(diagram).toHaveCount(0);
  await expect(code).toBeVisible();
});

test("a diagram with a mistake says so instead of drawing", async ({ page }) => {
  await mockVault(page, {
    files: { "Plan.md": "# Plan\n\n```mermaid\nflowchart LR\n  A -->\n```\n" },
    open: "Plan.md",
  });

  await expect(editor(page).getByText("This diagram can't be drawn.")).toBeVisible();
  await expect(editor(page).getByRole("img", { name: "Diagram" })).toHaveCount(0);
});

test("a diagram from the / menu starts with its code and drawing, and saves as a mermaid block", async ({
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
  await expect(editor(page).getByText("A --> B")).toBeVisible();

  const saved = await lastSave(page, "Note.md");
  expect(saved).toContain("```mermaid\nflowchart LR\n  A --> B\n```");
});
