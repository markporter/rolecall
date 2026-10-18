// Play-level `handlers:` sugar tests (ADR 0009 / ansible-compatibility-roadmap P2).
//
// Verifies a play's top-level `handlers:` list is lowered at load time into tasks
// carrying `listen` (defaulting to the handler's name), that tasks can `notify`
// those handlers by name, that notified handlers flush once at end of play, that
// unnotified handlers never run, and that duplicate handler names fail the schema.
import { expect, test } from "bun:test";
import { ZodError } from "zod";

import { loadPlaybook } from "../src/config/loader";
import type { NormalizedInventory } from "../src/config/schema";
import { registerModule, runPlaybook } from "../src/executor";

function inventory(hosts: string[]): NormalizedInventory {
  return { groups: { all: { hosts, vars: {} } } };
}

function recordingModule(
  outcome: { changed?: boolean; failed?: boolean } = {},
): { name: string; events: string[] } {
  const events: string[] = [];
  const name = `__ph_rec_${Math.random().toString(36).slice(2)}`;
  registerModule({
    name,
    run: async (ctx) => {
      events.push(ctx.args["label"] as string);
      return { changed: outcome.changed ?? false, failed: outcome.failed ?? false };
    },
  });
  return { name, events };
}

test("loadPlaybook lowers play-level handlers into listen tasks", () => {
  const pb = loadPlaybook(`
- hosts: all
  tasks:
    - name: configure
      module: debug
      args:
        msg: configure
      notify: restart nginx
  handlers:
    - name: restart nginx
      module: debug
      args:
        msg: restarting
`);
  const play = pb[0]!;
  expect(play.tasks.map((t) => t.name)).toEqual(["configure", "restart nginx"]);
  const handler = play.tasks.find((t) => t.name === "restart nginx")!;
  expect(handler.listen).toBe("restart nginx");
  expect(handler.module).toBe("debug");
  expect(handler.args).toEqual({ msg: "restarting" });
});

test("handlers accept the collapsed task form and preserve an explicit listen topic", () => {
  const pb = loadPlaybook(`
- hosts: all
  tasks:
    - name: t
      module: debug
      args: {}
  handlers:
    - name: reload
      debug:
        msg: reloaded
    - name: sudoers
      listen: security
      module: debug
      args: {}
`);
  const play = pb[0]!;
  const reload = play.tasks.find((t) => t.name === "reload")!;
  expect(reload.module).toBe("debug");
  expect(reload.args).toEqual({ msg: "reloaded" });
  expect(reload.listen).toBe("reload");
  const sudoers = play.tasks.find((t) => t.name === "sudoers")!;
  expect(sudoers.listen).toBe("security");
});

test("an unchanged task does not notify; its handler stays dormant (Ansible semantics)", async () => {
  const m = recordingModule({ changed: false });
  const pb = loadPlaybook(`
- hosts: all
  tasks:
    - name: no-op
      module: ${m.name}
      args:
        label: task
      notify: restart nginx
  handlers:
    - name: restart nginx
      module: ${m.name}
      args:
        label: restart
`);
  const res = await runPlaybook(pb, inventory(["h1"]));
  // a no-change run must not fire notify -> the handler never flushes
  expect(res.handlers).toEqual([]);
  expect(m.events).toEqual(["task"]);
  // handlers are not part of the main task loop
  expect(res.hosts["h1"]!.length).toBe(1);
});

test("a changed task notifies its handler, which flushes at end of play; an unnotified handler never runs", async () => {
  const m = recordingModule({ changed: true });
  const pb = loadPlaybook(`
- hosts: all
  tasks:
    - name: change
      module: ${m.name}
      args:
        label: task
      notify: restart nginx
  handlers:
    - name: restart nginx
      module: ${m.name}
      args:
        label: restart
    - name: never run
      module: ${m.name}
      args:
        label: never
`);
  const res = await runPlaybook(pb, inventory(["h1"]));
  expect(res.handlers.map((h) => h.handler)).toEqual(["restart nginx"]);
  // handler executes after the normal task (flush-at-end), and the unnotified one never runs
  expect(m.events).toEqual(["task", "restart"]);
  // handlers are not part of the main task loop
  expect(res.hosts["h1"]!.length).toBe(1);
});

test("a failed task does not notify its handler", async () => {
  const m = recordingModule({ changed: true, failed: true });
  const pb = loadPlaybook(`
- hosts: all
  tasks:
    - name: fails
      module: ${m.name}
      args:
        label: task
      notify: restart nginx
  handlers:
    - name: restart nginx
      module: ${m.name}
      args:
        label: restart
`);
  const res = await runPlaybook(pb, inventory(["h1"]));
  // changed-but-failed must not fire notify
  expect(res.handlers).toEqual([]);
  expect(m.events).toEqual(["task"]);
});

test("multiple notifies flush their handlers once, in first-notified order", async () => {
  const m = recordingModule({ changed: true });
  const pb = loadPlaybook(`
- hosts: all
  tasks:
    - name: one
      module: ${m.name}
      args:
        label: one
      notify: restart nginx
    - name: two
      module: ${m.name}
      args:
        label: two
      notify: reload app
    - name: three
      module: ${m.name}
      args:
        label: three
      notify: restart nginx
  handlers:
    - name: restart nginx
      module: debug
      args: {}
    - name: reload app
      module: debug
      args: {}
    - name: unused
      module: debug
      args: {}
`);
  const res = await runPlaybook(pb, inventory(["h1"]));
  expect(res.handlers.map((h) => h.handler)).toEqual(["restart nginx", "reload app"]);
});

test("duplicate handler names are rejected by the schema", () => {
  let error: unknown;
  try {
    loadPlaybook(`
- hosts: all
  tasks:
    - name: t
      module: debug
      args: {}
  handlers:
    - name: restart nginx
      module: debug
      args: {}
    - name: restart nginx
      module: debug
      args: {}
`);
  } catch (err) {
    error = err;
  }
  expect(error).toBeInstanceOf(ZodError);
  const issues = (error as ZodError).issues;
  expect(issues.some((i) => i.path.join(".").endsWith("handlers.1.name"))).toBe(true);
  expect(issues.some((i) => /duplicate handler name/.test(i.message))).toBe(true);
});

test("a handler without a name is rejected", () => {
  let error: unknown;
  try {
    loadPlaybook(`
- hosts: all
  tasks:
    - name: t
      module: debug
      args: {}
  handlers:
    - module: debug
      args: {}
`);
  } catch (err) {
    error = err;
  }
  expect(error).toBeInstanceOf(ZodError);
  // The nested path surfaces in the error message.
  const msg = String((error as Error).message);
  expect(msg).toContain("handlers");
  expect(msg).toContain("name");
});
