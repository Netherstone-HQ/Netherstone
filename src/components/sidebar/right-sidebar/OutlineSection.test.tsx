// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Heading } from "@platejs/toc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "@/store/ui";
import { OutlineSection } from "./OutlineSection";

vi.mock("@/lib/plate-toc-headings", () => ({ scrollPlateToHeading: vi.fn() }));

const heading = (id: string, depth: number, title: string): Heading => ({
  id,
  depth,
  title,
  path: [0],
  type: `h${depth}`,
});

describe("OutlineSection", () => {
  beforeEach(() => {
    useUIStore.setState({
      rightSidebarSections: { outline: true, metadata: true },
    });
  });
  afterEach(cleanup);

  it("lists the shard's headings, indented from the shallowest one", () => {
    render(
      <OutlineSection
        currentFilePath="C:/Notes/Plan.md"
        plateEditor={null}
        tocHeadings={[heading("a", 2, "Goals"), heading("b", 3, "This week")]}
      />,
    );

    const goals = screen.getByRole("button", { name: "Goals" });
    const week = screen.getByRole("button", { name: "This week" });
    expect(goals.style.paddingLeft).toBe("6px");
    expect(week.style.paddingLeft).toBe("18px");
  });

  it("collapses and remembers it", () => {
    render(
      <OutlineSection
        currentFilePath="C:/Notes/Plan.md"
        plateEditor={null}
        tocHeadings={[heading("a", 1, "Goals")]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Outline/ }));

    expect(screen.queryByRole("button", { name: "Goals" })).toBeNull();
    expect(useUIStore.getState().rightSidebarSections.outline).toBe(false);
  });
});
