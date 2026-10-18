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
