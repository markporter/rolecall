// `vars list` / `vars trace` command tests (Splunk-btool-style var provenance).
//
// Verifies the CLI surfaces declared var manifests (with `declaredIn` file) and
// traces precedence overrides through role-default < inv-group < inv-host < play < extra.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runVarsCommand } from "../src/cli/commands/vars";
import type { GlobalFlags } from "../src/cli/types";
import type { VarsListResult, VarsTraceResult } from "../src/cli/types";

let dir: string;

function flags(over: Partial<GlobalFlags> = {}): GlobalFlags {
  return {
    limit: undefined,
    force: false,
    check: false,
    diff: false,
    forks: undefined,
    output: "json",
    inventory: undefined,
    trace: false,
    profile: false,
    resume: undefined,
    extraVars: undefined,
    ...over,
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rolecall-vars-"));
  const roleDir = join(dir, "roles", "myrole");
  mkdirSync(join(roleDir, "tasks"), { recursive: true });
  mkdirSync(join(roleDir, "defaults"), { recursive: true });
  writeFileSync(
    join(roleDir, "tasks", "main.yml"),
    `- name: t
  module: debug
  notify: []
  args:
    msg: hi
`,
  );
  writeFileSync(
    join(roleDir, "defaults", "var-manifest.yml"),
    `vars:
  - kind: var
    source: declared
    name: foo
    type: string
    required: false
    default: role-default-value
  - kind: var
    source: declared
    name: bar
    type: string
    required: false
    default: bar-default
`,
  );
  writeFileSync(
    join(dir, "site.yaml"),
    `- name: demo
  hosts: [web1]
  vars:
    foo: play-value
  roles:
    - myrole
  tasks: []
`,
  );
  writeFileSync(
    join(dir, "inv.yaml"),
    `groups:
  web:
    hosts: [web1]
`,
  );
  mkdirSync(join(dir, "group_vars"), { recursive: true });
  mkdirSync(join(dir, "host_vars"), { recursive: true });
  writeFileSync(
    join(dir, "group_vars", "web.yaml"),
    `foo: group-value
baz: group-baz
`,
  );
  writeFileSync(join(dir, "host_vars", "web1.yaml"), `foo: host-value\n`);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("vars list", () => {
  it("surfaces every declared var tagged with its declaring file", async () => {
    const res = (await runVarsCommand("list", [join(dir, "site.yaml")], flags())) as VarsListResult;
    expect(res.command).toBe("vars list");
    const names = res.declared.flatMap((g) => g.entries.map((e) => e.name));
    expect(names.sort()).toEqual(["bar", "foo"]);
    const foo = res.declared
      .flatMap((g) => g.entries)
      .find((e) => e.name === "foo")!;
    expect(foo.declaredIn).toBe(join(roleDir0(), "defaults", "var-manifest.yml"));
    expect(foo.default).toBe("role-default-value");
  });

  it("reports fact capability per connection kind", async () => {
    const res = (await runVarsCommand("list", [join(dir, "site.yaml")], flags())) as VarsListResult;
    const kinds = Object.keys(res.factsByKind);
    expect(kinds).toContain("ssh");
    expect(kinds).toContain("local");
    expect(res.factsByKind.ssh.length).toBeGreaterThan(0);
  });
});

describe("vars trace", () => {
  it("resolves the winning value + full override chain across precedence tiers", async () => {
    const res = (await runVarsCommand("trace", [join(dir, "site.yaml")], flags({ inventory: join(dir, "inv.yaml") }))) as VarsTraceResult;
    expect(res.command).toBe("vars trace");
    const vars = res.plays[0]!.hosts["web1"]!;
    // play `vars:` sits above inventory host/group in RoleCall precedence → play-value wins.
    expect(vars.foo.value).toBe("play-value");
    expect(vars.foo.tier).toBe("play");
    const chain = vars.foo.chain.map((c) => c.tier);
    expect(chain).toEqual(["role-default", "inv-group", "inv-host", "play"]);
    // bar only declared at role-default; baz only from group_vars.
    expect(vars.bar.value).toBe("bar-default");
    expect(vars.baz.value).toBe("group-baz");
    expect(vars.baz.tier).toBe("inv-group");
  });

  it("lets --extra-vars win as the highest tier", async () => {
    const res = (await runVarsCommand(
      "trace",
      [join(dir, "site.yaml")],
      flags({ inventory: join(dir, "inv.yaml"), extraVars: "foo=extra-value" }),
    )) as VarsTraceResult;
    const vars = res.plays[0]!.hosts["web1"]!;
    expect(vars.foo.value).toBe("extra-value");
    expect(vars.foo.tier).toBe("extra");
    expect(vars.foo.chain.map((c) => c.tier).at(-1)).toBe("extra");
  });

  it("honors --limit to restrict traced hosts", async () => {
    const res = (await runVarsCommand(
      "trace",
      [join(dir, "site.yaml")],
      flags({ inventory: join(dir, "inv.yaml"), limit: "nope" }),
    )) as VarsTraceResult;
    expect(Object.keys(res.plays[0]!.hosts)).toEqual([]);
  });
});

function roleDir0(): string {
  return join(dir, "roles", "myrole");
}
