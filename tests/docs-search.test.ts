// Prose-doc search over docs/content/**/*.md (the shared module backing both
// `rolecall docs search` and the GET /mcp/docs agent tool). Covers: real-term hits,
// empty/whitespace-query rejection, unmatched terms, limit enforcement, case
// insensitivity, and nearest-heading recording.

import { expect, test } from "bun:test";
import { searchDocs } from "../src/docs/search";

test("finds hits for a known term present in docs/content", async () => {
  const res = await searchDocs("templating");
  expect(res.count).toBeGreaterThan(0);
  expect(res.query).toBe("templating");
  // Every returned hit must be structurally valid and actually match the term.
  for (const h of res.hits) {
    expect(h.file.endsWith(".md")).toBe(true);
    expect(typeof h.line).toBe("number");
    expect(h.line).toBeGreaterThanOrEqual(1);
    expect(h.snippet).toBe(h.snippet.trim());
    expect(h.snippet.toLowerCase()).toContain("templating");
  }
});

test("empty and whitespace-only queries throw", async () => {
  await expect(searchDocs("")).rejects.toThrow();
  await expect(searchDocs("   ")).rejects.toThrow();
});

test("an unmatched term returns zero hits without throwing", async () => {
  const res = await searchDocs("zzznomatchxyzzy");
  expect(res.count).toBe(0);
  expect(res.hits).toEqual([]);
});

test("limit caps the number of returned hits", async () => {
  const capped = await searchDocs("templating", { limit: 3 });
  expect(capped.count).toBe(3);
  expect(capped.hits.length).toBeLessThanOrEqual(3);
  // Default (no opts) never exceeds the hard ceiling of 100.
  const def = await searchDocs("templating");
  expect(def.count).toBeLessThanOrEqual(100);
});

test("matching is case-insensitive", async () => {
  const lower = await searchDocs("templating");
  const upper = await searchDocs("TEMPLATING");
  expect(upper.count).toBe(lower.count);
});

test("records the nearest preceding markdown heading", async () => {
  const res = await searchDocs("group hosts together");
  expect(res.count).toBeGreaterThanOrEqual(1);
  const headingHit = res.hits.find(
    (h) => h.heading === "## An inventory defines your targets",
  );
  expect(headingHit).toBeDefined();
  expect(headingHit!.file).toBe("guide/first-playbook.md");
  // Structural invariant: every hit carries either "(no heading)" or a "#"-prefixed heading.
  for (const h of res.hits) {
    expect(h.heading === "(no heading)" || h.heading.startsWith("#")).toBe(true);
  }
});
