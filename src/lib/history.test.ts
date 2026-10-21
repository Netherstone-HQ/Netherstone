import { describe, expect, it } from "vitest";
import { describeVersion, groupByDay, type FileVersion } from "./history";

const now = new Date(2026, 9, 20, 18, 0);
const at = (days: number, hour = 10) =>
  new Date(2026, 9, 20 - days, hour, 5).getTime() / 1000;

const version = (overrides: Partial<FileVersion>): FileVersion => ({
  id: "c",
  blob: "b",
  time: at(0),
  kind: "edited",
  restoredFrom: null,
  path: "Notes/Plan.md",
  renamedFrom: null,
  added: 0,
  removed: 0,
  changed: 0,
  counted: true,
  ...overrides,
});

describe("describeVersion", () => {
  it("names a rename or move", () => {
    const renamed = (renamedFrom: string, path = "Notes/Plan.md") =>
      describeVersion(version({ kind: "renamed", renamedFrom, path }), false, now);
    expect(renamed("Notes/Draft.md")).toBe("Renamed from Draft");
    expect(renamed("Work/Plan.md")).toBe("Moved from Work");
    expect(renamed("Plan.md")).toBe("Moved into Notes");
    expect(renamed("Work/Draft.md")).toBe("Renamed from Draft");
  });

  it("names a rename saved with edits", () => {
    expect(
      describeVersion(
        version({ renamedFrom: "Notes/Draft.md", added: 12 }),
        false,
        now,
      ),
    ).toBe("Renamed from Draft, added 12 words");
  });

  it("says what changed in a shard, naming the unit once", () => {
    expect(
      describeVersion(version({ added: 14, removed: 2 }), false, now),
    ).toBe("Added 14 words, removed 2");
    expect(describeVersion(version({ removed: 1 }), false, now)).toBe(
      "Removed 1 word",
    );
    expect(describeVersion(version({}), false, now)).toBe("Changed formatting");
  });

  it("counts shapes in a drawing", () => {
    expect(describeVersion(version({ added: 3, removed: 1 }), true, now)).toBe(
      "Added 3 shapes, removed 1",
    );
    expect(describeVersion(version({ changed: 2 }), true, now)).toBe(
      "Changed 2 shapes",
    );
  });

  it("names versions that aren't plain edits", () => {
    expect(describeVersion(version({ kind: "created" }), false, now)).toBe(
      "Created",
    );
    expect(
      describeVersion(version({ kind: "outsideChange" }), false, now),
    ).toBe("Changed outside the app");
    expect(
      describeVersion(
        version({ kind: "restored", restoredFrom: at(8) }),
        false,
        now,
      ),
    ).toMatch(/^Restored from .*12.*, /);
  });
});

describe("groupByDay", () => {
  it("groups by Today, Yesterday and the date", () => {
    const days = groupByDay(
      [
        version({ time: at(0) }),
        version({ time: at(1) }),
        version({ time: at(1, 9) }),
        version({ time: at(8) }),
      ],
      now,
    );
    expect(days.map((day) => [day.label, day.versions.length])).toEqual([
      ["Today", 1],
      ["Yesterday", 2],
      [expect.stringContaining("12"), 1],
    ]);
  });
});
