// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Heading } from "@platejs/toc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorStore } from "@/store/editor";
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
    useUIStore.setState({ collapsedSections: {} });
  });
  afterEach(cleanup);

  it("lists the shard's headings, indented from the shallowest one", () => {
    useEditorStore.setState({
      tocHeadings: [heading("a", 2, "Goals"), heading("b", 3, "This week")],
    });
    render(<OutlineSection />);

    const goals = screen.getByRole("button", { name: "Goals" });
    const week = screen.getByRole("button", { name: "This week" });
    expect(goals.style.paddingLeft).toBe("8px");
    expect(week.style.paddingLeft).toBe("22px");
  });

  it("collapses and remembers it", () => {
    useEditorStore.setState({ tocHeadings: [heading("a", 1, "Goals")] });
    render(<OutlineSection />);

    fireEvent.click(screen.getByRole("button", { name: /Outline/ }));

    expect(screen.queryByRole("button", { name: "Goals" })).toBeNull();
    expect(useUIStore.getState().collapsedSections.outline).toBe(true);
  });
});
