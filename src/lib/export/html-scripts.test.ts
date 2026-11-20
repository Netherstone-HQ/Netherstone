// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { FIT_TABLES } from "./html-scripts";

const fitTables = new Function(`${FIT_TABLES}; return fitTables;`)() as (onPaper: boolean) => void;

/**
 * A table box as a browser lays it out, in its own zoomed pixels: the room
 * is the page's width, the text scales with the zoom, and the rules stay
 * whole device pixels.
 */
function tableWrap(room: number, text: number, rules: number) {
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const zoom = () => Number(wrap.style.zoom || 1);
  Object.defineProperty(wrap, "clientWidth", { get: () => room / zoom() });
  Object.defineProperty(wrap, "scrollWidth", { get: () => Math.max(room / zoom(), text + rules / zoom()) });
  document.body.appendChild(wrap);
  return wrap;
}

describe("fitting tables to paper", () => {
  it("zooms a table wider than the page until it fits, rules included", () => {
    const wrap = tableWrap(600, 900, 12);
    fitTables(true);
    const zoom = Number(wrap.style.zoom);
    // Just small enough: the text takes the room the rules leave.
    expect(zoom).toBeCloseTo((600 - 12) / 900, 3);
    expect(900 * zoom + 12).toBeLessThanOrEqual(600 + 1e-9);
  });

  it("leaves tables that fit alone, and lets the web page scroll them again", () => {
    const fits = tableWrap(600, 400, 12);
    const wide = tableWrap(600, 900, 12);
    fitTables(true);
    expect(fits.style.zoom).toBe("");
    expect(wide.style.zoom).not.toBe("");
    fitTables(false);
    expect(wide.style.zoom).toBe("");
  });
});
