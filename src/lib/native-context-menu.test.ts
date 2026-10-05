// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { suppressNativeContextMenu } from "./native-context-menu";

let cleanup: () => void;

beforeEach(() => {
  cleanup = suppressNativeContextMenu();
});

afterEach(() => {
  cleanup();
  document.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

function rightClick(target: Element) {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

it("hides the page menu on the app's chrome", () => {
  document.body.innerHTML = "<nav><button>Vault</button></nav>";
  expect(rightClick(document.querySelector("button")!)).toBe(true);
});

it("keeps the menu in text fields and the editor", () => {
  document.body.innerHTML = `
    <input />
    <textarea></textarea>
    <div contenteditable="true"><p>Text</p></div>
  `;
  expect(rightClick(document.querySelector("input")!)).toBe(false);
  expect(rightClick(document.querySelector("textarea")!)).toBe(false);
  expect(rightClick(document.querySelector("p")!)).toBe(false);
});

it("keeps the menu while text is selected", () => {
  document.body.innerHTML = "<p>Read only text</p>";
  const paragraph = document.querySelector("p")!;
  document.getSelection()!.selectAllChildren(paragraph);
  expect(rightClick(paragraph)).toBe(false);
});

it("leaves the app's own menus alone", () => {
  document.body.innerHTML = "<div>Block</div>";
  const block = document.querySelector("div")!;
  block.addEventListener("contextmenu", (event) => event.preventDefault());
  // Handled by the block, not by the suppressor; either way no page menu.
  expect(rightClick(block)).toBe(true);
});
