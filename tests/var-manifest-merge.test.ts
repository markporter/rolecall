// Layered var-manifest merge + conflict detection (Phase 2).
import { describe, expect, it } from "bun:test";

import { mergeManifests } from "../src/config/var-manifest/merge";
import type { VarManifestEntry } from "../src/config/var-manifest/types";

const entry = (over: Partial<VarManifestEntry> & Pick<VarManifestEntry, "name">): VarManifestEntry => ({
  kind: "var",
  source: "declared",
  type: "string",
  ...over,
}) as VarManifestEntry;

describe("mergeManifests (Phase 2)", () => {
  it("returns [] for no entries", () => {
    expect(mergeManifests([])).toEqual([]);
  });

  it("de-duplicates by name and lets a later default win (no conflict)", () => {
    const merged = mergeManifests([
      entry({ name: "x", default: "base" }),
      entry({ name: "x", default: "late" }),
      entry({ name: "y", default: "only" }),
    ]);
    expect(merged).toHaveLength(2);
    const x = merged.find((e) => e.name === "x")!;
    expect(x.default).toBe("late");
    expect(merged.find((e) => e.name === "y")!.default).toBe("only");
  });

  it("treats differing default-only as non-conflicting (higher layer wins)", () => {
    expect(() =>
      mergeManifests([
        entry({ name: "x", type: "number", default: 80 }),
        entry({ name: "x", type: "number", default: 8080 }),
      ]),
    ).not.toThrow();
  });

  it("hard-fails on conflicting type across layers", () => {
    expect(() =>
      mergeManifests([
        entry({ name: "x", type: "string" }),
        entry({ name: "x", type: "number" }),
      ]),
    ).toThrow(/conflicting var declarations/);
  });

  it("hard-fails on conflicting source across layers", () => {
    expect(() =>
      mergeManifests([
        entry({ name: "x", source: "declared" }),
        entry({ name: "x", source: "observed" }),
      ]),
    ).toThrow(/conflicting var declarations/);
  });
});
