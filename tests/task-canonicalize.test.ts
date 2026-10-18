// Ansible-style collapsed task support (see src/config/schema.ts canonicalizeTask).
// RoleCall accepts BOTH task shapes and normalizes the collapsed form to explicit.

import { expect, test } from "bun:test";
import { CanonicalTaskSchema, normalizeTask } from "../src/config/schema";
import { loadPlaybook } from "../src/config/loader";

test("collapsed task is rewritten to explicit module/args", () => {
  const result = CanonicalTaskSchema.safeParse({ name: "copy file", copy: { src: "a", dest: "b" } });
  expect(result.success).toBe(true);
  if (!result.success) return;
  const nt = normalizeTask(result.data);
  expect(nt.module).toBe("copy");
  expect(nt.args).toEqual({ src: "a", dest: "b" });
  expect(nt.name).toBe("copy file");
});

test("collapsed task with extra structural keys is rewritten", () => {
  const result = CanonicalTaskSchema.safeParse({ name: "n", copy: { src: "a" }, notify: "restart" });
  expect(result.success).toBe(true);
  if (!result.success) return;
  const nt = normalizeTask(result.data);
  expect(nt.module).toBe("copy");
  expect(nt.args).toEqual({ src: "a" });
  expect(nt.notify).toEqual(["restart"]);
});

test("explicit module/args passes through unchanged", () => {
  const result = CanonicalTaskSchema.safeParse({ name: "x", module: "copy", args: { src: "a" } });
  expect(result.success).toBe(true);
  if (!result.success) return;
  const nt = normalizeTask(result.data);
  expect(nt.module).toBe("copy");
  expect(nt.args).toEqual({ src: "a" });
});

test("include_tasks directive passes through without a module", () => {
  const result = CanonicalTaskSchema.safeParse({ name: "include", include_tasks: "other.yaml" });
  expect(result.success).toBe(true);
});

test("ambiguous collapsed task (two module keys) fails validation", () => {
  const result = CanonicalTaskSchema.safeParse({ copy: { src: "a" }, file: { path: "b" } });
  expect(result.success).toBe(false);
});

test("collapsed task whose module key maps to a non-object fails validation", () => {
  const result = CanonicalTaskSchema.safeParse({ copy: "src" });
  expect(result.success).toBe(false);
});

test("unknown module key fails validation", () => {
  const result = CanonicalTaskSchema.safeParse({ bogus: 1 });
  expect(result.success).toBe(false);
});

test("loadPlaybook accepts Ansible-style collapsed tasks end-to-end", () => {
  const yaml = `
- name: demo
  hosts:
    - web1
  tasks:
    - name: copy config
      copy:
        src: /tmp/a
        dest: /etc/a
    - name: explicit
      module: service
      args:
        name: nginx
        state: started
`;
  const plays = loadPlaybook(yaml);
  expect(plays).toHaveLength(1);
  const tasks = plays[0]!.tasks;
  expect(tasks).toHaveLength(2);
  expect(tasks[0]!.module).toBe("copy");
  expect(tasks[0]!.args).toEqual({ src: "/tmp/a", dest: "/etc/a" });
  expect(tasks[1]!.module).toBe("service");
  expect(tasks[1]!.args).toEqual({ name: "nginx", state: "started" });
});
