import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";

import { registerAllModules } from "../src/modules/builtins";
import { searchModules } from "../src/modules/search";
import { lintTemplateRefs } from "../src/config/loader";
import type { NormalizedPlaybook, NormalizedTask } from "../src/config/schema";

registerAllModules();
const REGISTERED = new Set(searchModules("").map((m) => m.name));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function extractYamlBlocks(md: string): string[] {
  const blocks: string[] = [];
  const re = /```ya?ml\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) blocks.push(m[1]);
  return blocks;
}

function toPlaybook(parsed: unknown): NormalizedPlaybook {
  let tasks: any[] = [];
  let vars: Record<string, unknown> = {};
  let hosts: string[] = ["all"];
  let name: string | undefined;

  if (Array.isArray(parsed)) {
    const first = parsed[0];
    const looksLikeTask =
      first && (first.module !== undefined || (first.name !== undefined && first.args !== undefined));
    if (looksLikeTask) {
      tasks = parsed;
    } else if (first && typeof first === "object") {
      tasks = first.tasks ?? [];
      vars = first.vars ?? {};
      hosts = Array.isArray(first.hosts) ? first.hosts : typeof first.hosts === "string" ? [first.hosts] : ["all"];
      name = first.name;
    }
  } else if (parsed && typeof parsed === "object") {
    if ((parsed as any).tasks) {
      tasks = (parsed as any).tasks ?? [];
      vars = (parsed as any).vars ?? {};
      const h = (parsed as any).hosts;
      hosts = Array.isArray(h) ? h : typeof h === "string" ? [h] : ["all"];
      name = (parsed as any).name;
    } else if (
      (parsed as any).module !== undefined ||
      ((parsed as any).name !== undefined && (parsed as any).args !== undefined)
    ) {
      tasks = [parsed];
    }
  }

  const ntasks: NormalizedTask[] = tasks.map((t: any) => ({
    name: t?.name ?? "example",
    ...(t?.module !== undefined ? { module: String(t.module) } : {}),
    args: t?.args ?? {},
    ...(t?.when !== undefined ? { when: t.when } : {}),
    ...(t?.loop !== undefined ? { loop: t.loop } : {}),
    notify: Array.isArray(t?.notify) ? t.notify : [],
    ...(t?.register !== undefined ? { register: t.register } : {}),
    ...(t?.delegate_to !== undefined ? { delegate_to: t.delegate_to } : {}),
    ...(t?.listen !== undefined ? { listen: t.listen } : {}),
    ...(t?.tx !== undefined ? { tx: t.tx } : {}),
    ...(t?.checkpoint !== undefined ? { checkpoint: t.checkpoint } : {}),
  }));

  return { ...(name !== undefined ? { name } : {}), hosts, tasks: ntasks, vars };
}

function collectModules(parsed: unknown, out: string[] = []): string[] {
  if (Array.isArray(parsed)) parsed.forEach((i) => collectModules(i, out));
  else if (parsed && typeof parsed === "object") {
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.module === "string") out.push(rec.module);
    for (const v of Object.values(rec)) collectModules(v, out);
  }
  return out;
}

/** A play object at the document root (a mapping with `tasks`) is the rejected bare form. */
function isBarePlayObject(parsed: unknown): boolean {
  return (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    (parsed as Record<string, unknown>).tasks !== undefined
  );
}

function hardProblems(pb: NormalizedPlaybook) {
  return lintTemplateRefs(pb).filter((p) => p.kind === "jinja" || p.kind === "namespace-unknown");
}

interface Check {
  source: string;
  yaml: string;
  enforceModules: boolean;
  lint: boolean;
}

const checks: Check[] = [];

// Markdown docs tree: docs/content/** and design/**.
for (const root of ["docs/content", "design"]) {
  if (!existsSync(root)) continue;
  for (const f of walk(root)) {
    if (!f.endsWith(".md")) continue;
    const text = readFileSync(f, "utf8");
    const enforceModules = f.endsWith("first-playbook.md");
    // design/** and templating.md are conceptual ref-syntax illustrations; they are
    // parse-checked only. The templating.md loop example uses a loop variable
    // `$var: item` that `lintTemplateRefs` flags (it cannot see loop scope), so lint
    // is scoped to the executable examples where real ref mistakes would ship.
    const lint = enforceModules;
    for (const block of extractYamlBlocks(text)) {
      checks.push({ source: f, yaml: block, enforceModules, lint });
    }
  }
}

// Example playbooks: real .yaml files under examples/** that declare tasks/modules.
if (existsSync("examples")) {
  for (const f of walk("examples")) {
    if (!f.endsWith(".yaml") && !f.endsWith(".yml")) continue;
    const text = readFileSync(f, "utf8");
    if (!/(^|\n)\s*(tasks:|module:)/.test(text)) continue;
    checks.push({ source: f, yaml: text, enforceModules: true, lint: true });
  }
}

describe("docs & example YAML stays valid and executable", () => {
  for (const c of checks) {
    test(`parses + lints: ${c.source}`, () => {
      let parsed: unknown;
      expect(() => {
        parsed = yamlLoad(c.yaml);
      }, `YAML failed to parse in ${c.source}`).not.toThrow();

      expect(parsed, `empty YAML document in ${c.source}`).not.toBeUndefined();

      expect(
        isBarePlayObject(parsed),
        `bare play object in ${c.source}: a playbook must be a top-level list of plays (each play starts with '- '); wrap the play in a list`,
      ).toBe(false);

      if (c.lint) {
        const problems = hardProblems(toPlaybook(parsed));
        expect(
          problems,
          `template-ref problems in ${c.source}: ${JSON.stringify(problems)}`,
        ).toEqual([]);
      }

      if (c.enforceModules) {
        for (const mod of collectModules(parsed)) {
          // Local module references (./foo, /abs/foo) resolve at runtime, not via the
          // registry, so they are exempt from the registered-set assertion.
          const ok = REGISTERED.has(mod) || mod.startsWith(".") || mod.startsWith("/");
          expect(ok, `module '${mod}' in ${c.source} is not a registered module`).toBe(true);
        }
      }
    });
  }
});
