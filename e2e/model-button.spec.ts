import { expect, mockVault, test } from "./vault";

/** The composer's model button: one row, all on one center line. */

const FILES = { "Trip.md": "# Trip\n\nLisbon in May, by train.\n" };

const READY = { provider: true, vaultAllowed: true, picked: true };

test("centers the model's name, dot, provider and chevron on one line", async ({
  page,
}) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const button = page
    .getByRole("complementary", { name: "Assistant" })
    .getByRole("button", { name: "Model" });
  await expect(button).toHaveText(/Claude Sonnet 5\.5\s*Anthropic/);

  const centers = await button.evaluate((element) => {
    const middle = (rect: DOMRect) => rect.top + rect.height / 2;
    const text = (node: Element) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return middle(range.getBoundingClientRect());
    };
    const [name, , provider] = [...element.children];
    const dot = element.querySelector(".rounded-full");
    const chevron = element.querySelector("svg");
    if (!dot || !chevron) throw new Error("No dot or chevron");
    return {
      button: middle(element.getBoundingClientRect()),
      name: text(name),
      dot: middle(dot.getBoundingClientRect()),
      provider: text(provider),
      chevron: middle(chevron.getBoundingClientRect()),
    };
  });
  for (const center of Object.values(centers)) {
    expect(Math.abs(center - centers.button)).toBeLessThanOrEqual(0.5);
  }
});
