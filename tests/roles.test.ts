// Role composition tests (ADR 0009 #3 / ansible-compatibility-roadmap P1).
//
// Verifies a play's `roles:` list is expanded at load time: role tasks are
// spliced BEFORE the play's own tasks, role handlers ride along as `listen`
// tasks, and role defaults < role vars < play vars precedence is honored (D1).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadPlaybookFile } from "../src/config/loader";
import { FsProjectSource } from "../src/vfs/fs-project-source";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rolecall-roles-"));
  const roleDir = join(dir, "roles", "myrole");
  mkdirSync(join(roleDir, "tasks"), { recursive: true });
  mkdirSync(join(roleDir, "handlers"), { recursive: true });
  mkdirSync(join(roleDir, "defaults"), { recursive: true });
  mkdirSync(join(roleDir, "vars"), { recursive: true });

  writeFileSync(
    join(roleDir, "tasks", "main.yml"),
    `- name: role task
  module: debug
  args:
    msg: { $var: vars.role_msg }
`,
  );
  writeFileSync(
    join(roleDir, "handlers", "main.yml"),
    `- name: reload nginx
  listen: reload nginx
  module: service
  args: { name: nginx, state: restarted }
`,
  );
  writeFileSync(
    join(roleDir, "defaults", "main.yml"),
    `role_msg: from-default
shared: default-shared
`,
  );
  writeFileSync(
    join(roleDir, "vars", "main.yml"),
    `role_var: from-vars
shared: vars-shared
`,
  );

  writeFileSync(
    join(roleDir, "defaults", "var-manifest.yml"),
    `vars:
  - kind: var
    source: declared
    name: manifested_var
    type: string
    required: false
    default: manifest-default
  - kind: var
    source: declared
    name: role_msg
    type: string
    required: false
    default: manifest-role-msg
`,
  );

  writeFileSync(
    join(dir, "playbook.yml"),
    `- hosts: all
  roles: [myrole]
  vars:
    shared: play-shared
  tasks:
    - name: play task
      module: debug
      args: { msg: hi }
`,
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("role composition (ADR 0009 #3)", () => {
  it("splices role tasks before play tasks and keeps handler tasks", async () => {
    const plays = await loadPlaybookFile("playbook.yml", new FsProjectSource(dir));
    const play = plays[0]!;
    const names = play.tasks.map((t) => t.name);
    expect(names[0]).toBe("role task");
    expect(names).toContain("play task");
    const handler = play.tasks.find((t) => t.listen === "reload nginx");
    expect(handler).toBeDefined();
    expect(handler!.module).toBe("service");
    expect(play.roles).toBeUndefined();
  });

  it("merges role defaults < role vars < play vars (D1 precedence)", async () => {
    const plays = await loadPlaybookFile("playbook.yml", new FsProjectSource(dir));
    const play = plays[0]!;
    // Role defaults are kept in the separate `roleDefaults` tier (lowest precedence),
    // not folded into play.vars — the executor layers them below inventory vars.
    expect(play.roleDefaults?.role_msg).toBe("from-default");
    expect(play.vars.role_var).toBe("from-vars");
    expect(play.vars.shared).toBe("play-shared");
  });

  it("applies role meta dependencies before the role", async () => {
    const root = mkdtempSync(join(tmpdir(), "rolecall-role-deps-"));
    try {
      mkdirSync(join(root, "roles", "base", "tasks"), { recursive: true });
      mkdirSync(join(root, "roles", "base", "defaults"), { recursive: true });
      mkdirSync(join(root, "roles", "child", "tasks"), { recursive: true });
      mkdirSync(join(root, "roles", "child", "meta"), { recursive: true });
      writeFileSync(join(root, "roles", "base", "tasks", "main.yml"), `- name: base task\n  module: debug\n  args:\n    msg: base\n`);
      writeFileSync(join(root, "roles", "base", "defaults", "main.yml"), `base_var: from-base\n`);
      writeFileSync(join(root, "roles", "child", "tasks", "main.yml"), `- name: child task\n  module: debug\n  args:\n    msg: child\n`);
      writeFileSync(join(root, "roles", "child", "meta", "main.yml"), `dependencies:\n  - base\n`);
      writeFileSync(join(root, "playbook.yml"), `- hosts: all\n  roles: [child]\n  tasks: []\n`);
      const plays = await loadPlaybookFile("playbook.yml", new FsProjectSource(root));
      expect(plays[0]!.tasks.map((t) => t.name)).toEqual(["base task", "child task"]);
      expect(plays[0]!.roleDefaults?.base_var).toBe("from-base");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("detects cyclic role dependencies", async () => {
    const root = mkdtempSync(join(tmpdir(), "rolecall-role-cycle-"));
    try {
      for (const name of ["a", "b"]) {
        mkdirSync(join(root, "roles", name, "tasks"), { recursive: true });
        mkdirSync(join(root, "roles", name, "meta"), { recursive: true });
        writeFileSync(join(root, "roles", name, "tasks", "main.yml"), `- name: ${name}\n  module: debug\n  args:\n    msg: ${name}\n`);
      }
      writeFileSync(join(root, "roles", "a", "meta", "main.yml"), `dependencies:\n  - b\n`);
      writeFileSync(join(root, "roles", "b", "meta", "main.yml"), `dependencies:\n  - a\n`);
      writeFileSync(join(root, "playbook.yml"), `- hosts: all\n  roles: [a]\n  tasks: []\n`);
      await expect(loadPlaybookFile("playbook.yml", new FsProjectSource(root))).rejects.toThrow(/cyclic role dependency/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("discovers role var-manifest: seeds declared defaults and registers entries (Phase 1)", async () => {
    const plays = await loadPlaybookFile("playbook.yml", new FsProjectSource(dir));
    const play = plays[0]!;
    // Declared manifest default seeds the roleDefaults tier when no defaults/main.yml entry exists.
    expect(play.roleDefaults?.manifested_var).toBe("manifest-default");
    // An explicit defaults/main.yml entry still wins over the manifest default.
    expect(play.roleDefaults?.role_msg).toBe("from-default");
    // The registry is collected for later strict-validation phases.
    expect(play.varManifests).toBeDefined();
    const names = (play.varManifests ?? []).map((e) => e.name);
    expect(names).toContain("manifested_var");
    expect(names).toContain("role_msg");
  });
});
