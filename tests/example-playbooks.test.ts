import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadPlaybook, lintTemplateRefs } from "../src/config/loader";

// Example playbooks that must be execute-ready: they parse against the real
// playbook schema AND lint clean (no legacy `{{ }}` jinja or non-namespaced `$var`).
const EXAMPLES = [
  "examples/nginx-baseline/playbooks/site.yaml",
  "examples/lxd-lab/playbooks/configure.yaml",
];

describe("example playbooks load + lint clean (execute-ready)", () => {
  for (const rel of EXAMPLES) {
    test(`parses + lints: ${rel}`, () => {
      const text = readFileSync(join(process.cwd(), rel), "utf8");

      // Real parser: validates against PlaybookSchema and runs the strict-mode
      // template-ref lint (throws on any jinja / unprefixed-var problem).
      let plays: ReturnType<typeof loadPlaybook>;
      expect(
        () => {
          plays = loadPlaybook(text);
        },
        `playbook failed to parse/lint: ${rel}`,
      ).not.toThrow();

      plays = plays!;
      expect(plays.length, `expected at least one play in ${rel}`).toBeGreaterThan(0);

      // Explicit assertion: every play is template-ref clean.
      for (const pb of plays) {
        expect(
          lintTemplateRefs(pb),
          `template-ref problems in ${rel}: ${JSON.stringify(lintTemplateRefs(pb))}`,
        ).toEqual([]);
      }

      // Spot-check the modern conventions are actually present (not just valid).
      const joined = JSON.stringify(plays);
      expect(
        joined.includes("$template") || joined.includes("$eq"),
        `example ${rel} should demonstrate typed when / $template`,
      ).toBe(true);
    });
  }
});
