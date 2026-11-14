// ADR 0024 converter MVP + Cycle-2 strict templating primitives.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { load as yamlLoad } from "js-yaml";

import { convertAnsible, validateConvertedTree } from "../src/convert/ansible";
import { MODULE_REMAP, TASK_RULES } from "../src/convert/matrix";
import { resolveValue } from "../src/templating/refs";
import { evalWhen } from "../src/executor/context";

const tmp = (suffix: string) => mkdtempSync(join(tmpdir(), `rolecall-convert-${suffix}-`));

describe("$jinja / $exists / $length primitives", () => {
  test("$jinja renders strictly", () => {
    expect(resolveValue({ $jinja: "{{ vars.port }}" }, { vars: { port: 8080 } })).toBe("8080");
    expect(() => resolveValue({ $jinja: "{{ vars.missing }}" }, { vars: {} })).toThrow();
  });

  test("$exists and $length", () => {
    expect(resolveValue({ $exists: { $var: "vars.missing" } }, { vars: {} })).toBe(false);
    expect(resolveValue({ $exists: { $var: "vars.present" } }, { vars: { present: 0 } })).toBe(true);
    expect(resolveValue({ $length: { $var: "vars.items" } }, { vars: { items: [1, 2, 3] } })).toBe(3);
    expect(resolveValue({ $length: { $var: "vars.name" } }, { vars: { name: "abc" } })).toBe(3);
  });

  test("derived structured vars resolve lazily", () => {
    const vars = { vars: { port: 8080, url: { $concat: ["http://x:", { $var: "vars.port" }] } } };
    expect(resolveValue({ $var: "vars.url" }, vars)).toBe("http://x:8080");
  });

  test("$jinja resolves derived vars in the scope", () => {
    const vars = {
      vars: {
        port: 8080,
        url: { $jinja: "http://x:{{ vars.port }}" },
        msg: { $jinja: "{{ vars.url }}" },
      },
    };
    expect(resolveValue({ $jinja: "{{ vars.url }}" }, vars)).toBe("http://x:8080");
    expect(resolveValue({ $var: "vars.msg" }, vars)).toBe("http://x:8080");
  });

  test("indexed $var paths", () => {
    expect(resolveValue({ $var: "vars.items[1]" }, { vars: { items: ["a", "b"] } })).toBe("b");
    expect(resolveValue({ $var: "vars.items.length" }, { vars: { items: [1, 2] } })).toBe(2);
    expect(resolveValue({ $var: "vars.name.length" }, { vars: { name: "abc" } })).toBe(3);
  });

  test("evalWhen accepts $jinja and lists as AND", () => {
    const scope = { vars: { flag: false }, facts: {}, reg: {}, loop: { item: undefined, index: 0 }, play: {}, inv: {}, role: {}, run: {}, rolecall: {} } as never;
    expect(evalWhen({ $jinja: "{{ vars.flag }}" }, scope)).toBe(false);
    expect(evalWhen([{ $eq: [{ $var: "vars.flag" }, false] }, { $jinja: "{{ true }}" }], scope)).toBe(true);
  });
});

describe("convert ansible MVP", () => {
  test("mechanically converts modules/when/loop/template/block and writes handoff", () => {
    const dir = tmp("src");
    const file = join(dir, "site.yml");
    writeFileSync(
      file,
      `- name: Web
  hosts: web
  vars:
    http_port: 80
  tasks:
    - name: Install nginx
      apt:
        name: nginx
        state: present
      when: ansible_os_family == "Debian"
    - name: Template config
      template:
        src: nginx.conf.j2
        dest: /etc/nginx/nginx.conf
        mode: "0644"
      with_items:
        - a
        - b
    - name: Ignore a failure
      shell: /bin/false
      ignore_errors: true
    - name: Block
      block:
        - name: inner
          debug:
            msg: "{{ http_port }}"
      rescue:
        - name: recover
          debug:
            msg: failed
`,
      "utf8",
    );

    const out = join(dir, "out");
    const result = convertAnsible(file, { write: true, out });
    expect(result.totals.mapped).toBeGreaterThan(0);
    expect(result.totals.handoff).toBeGreaterThan(0);

    const converted = yamlLoad(readFileSync(join(out, "site.yml"), "utf8")) as Array<Record<string, unknown>>;
    const tasks = converted[0]!.tasks as Array<Record<string, unknown>>;
    expect(tasks[0]!.package).toBeDefined();
    expect(tasks[0]!.when).toEqual({ $jinja: '{{ facts.os_family == "Debian" }}' });
    expect((tasks[1]!.copy as Record<string, unknown>).content).toEqual({
      template_file: "nginx.conf.j2",
      engine: "jinja",
    });
    expect(tasks[1]!.loop).toEqual(["a", "b"]);
    expect((tasks[2]!.shell as Record<string, unknown>).command).toBe("/bin/false");
    expect(tasks[3]!.tx).toBe("rc-block-1");
    expect((tasks[3]!.debug as Record<string, unknown>).msg).toEqual({ $jinja: "{{ vars.http_port }}" });

    expect(readFileSync(join(out, "handoff", "HANDOFF.md"), "utf8")).toContain("ignore_errors");
    // Single-file conversion does not copy sibling assets; stage the .j2 to
    // exercise the template-reference validation path.
    writeFileSync(join(out, "nginx.conf.j2"), "server {}");
    const validated = validateConvertedTree(out);
    expect(validated.every((entry) => entry.ok)).toBe(true);
  });

  test("Jinja loop expressions become $each + $jinja", () => {
    const dir = tmp("loop");
    const file = join(dir, "site.yml");
    writeFileSync(file, `- hosts: web\n  vars:\n    items:\n      - a\n      - b\n  tasks:\n    - name: t\n      debug:\n        msg: "{{ item }}"\n      loop: "{{ items }}"\n`, "utf8");
    const result = convertAnsible(file, { write: true, out: join(dir, "out") });
    const converted = yamlLoad(readFileSync(join(result.out, "site.yml"), "utf8")) as Array<Record<string, unknown>>;
    const task = (converted[0]!.tasks as Array<Record<string, unknown>>)[0]!;
    expect(task.loop).toEqual({ $each: { $jinja: "{{ vars.items }} | to_json" } });
    expect((task.debug as Record<string, unknown>).msg).toEqual({ $jinja: "{{ loop.item }}" });
  });

  test("with_dict Jinja becomes $each + dict2items", () => {
    const dir = tmp("dict");
    const file = join(dir, "site.yml");
    writeFileSync(file, `- hosts: web\n  vars:\n    users:\n      alice: 1000\n  tasks:\n    - name: t\n      debug:\n        msg: "{{ item.key }}={{ item.value }}"\n      with_dict: "{{ users }}"\n`, "utf8");
    const result = convertAnsible(file, { write: true, out: join(dir, "out") });
    const converted = yamlLoad(readFileSync(join(result.out, "site.yml"), "utf8")) as Array<Record<string, unknown>>;
    const task = (converted[0]!.tasks as Array<Record<string, unknown>>)[0]!;
    expect(task.loop).toEqual({ $each: { $jinja: "{{ vars.users }} | dict2items | to_json" } });
    expect((task.debug as Record<string, unknown>).msg).toEqual({ $jinja: "{{ loop.item.key }}={{ loop.item.value }}" });
  });

  test("static include_vars moves to vars_files", () => {
    const dir = tmp("include-vars");
    const file = join(dir, "site.yml");
    writeFileSync(file, `- hosts: web\n  tasks:\n    - name: load vars\n      include_vars:\n        file: vars.yml\n    - name: t\n      debug:\n        msg: ok\n`, "utf8");
    const result = convertAnsible(file, { write: true, out: join(dir, "out") });
    const converted = yamlLoad(readFileSync(join(result.out, "site.yml"), "utf8")) as Array<Record<string, unknown>>;
    expect(converted[0]!.vars_files).toEqual(["vars.yml"]);
    expect((converted[0]!.tasks as Array<Record<string, unknown>>).length).toBe(1);
  });

  test("hostvars and groups bracket access gain .vars/.hosts", () => {
    const dir = tmp("hostvars");
    const file = join(dir, "site.yml");
    writeFileSync(file, `- hosts: web\n  tasks:\n    - name: t\n      debug:\n        msg: ok\n      when: hostvars[item].foo == "bar" and groups['web'] | length > 0\n`, "utf8");
    const result = convertAnsible(file, { write: true, out: join(dir, "out") });
    const converted = yamlLoad(readFileSync(join(result.out, "site.yml"), "utf8")) as Array<Record<string, unknown>>;
    const task = (converted[0]!.tasks as Array<Record<string, unknown>>)[0]!;
    expect(task.when).toEqual({ $jinja: "{{ inv.hosts[loop.item].vars.foo == \"bar\" and inv.groups['web'].hosts | length > 0 }}" });
  });

  test("import_playbook inlines imported plays", () => {
    const dir = tmp("imports");
    writeFileSync(join(dir, "child.yml"), `- name: Child\n  hosts: web\n  tasks:\n    - name: t\n      debug:\n        msg: ok\n`, "utf8");
    const file = join(dir, "site.yml");
    writeFileSync(file, `- import_playbook: child.yml\n`, "utf8");
    const result = convertAnsible(file, { write: true, out: join(dir, "out") });
    const converted = yamlLoad(readFileSync(join(result.out, "site.yml"), "utf8")) as Array<Record<string, unknown>>;
    expect(converted).toHaveLength(1);
    expect(converted[0]!.name).toBe("Child");
  });

  test("directory mode converts var-file Jinja and flags role dependencies", () => {
    const dir = tmp("tree");
    mkdirSync(join(dir, "group_vars"), { recursive: true });
    mkdirSync(join(dir, "roles", "web", "meta"), { recursive: true });
    writeFileSync(join(dir, "group_vars", "all.yml"), `port: 80\nurl: "http://{{ inventory_hostname }}:{{ port }}"\n`, "utf8");
    writeFileSync(join(dir, "roles", "web", "meta", "main.yml"), `dependencies:\n  - common\n`, "utf8");
    writeFileSync(join(dir, "site.yml"), `- hosts: web\n  roles:\n    - web\n  tasks:\n    - name: t\n      debug:\n        msg: ok\n`, "utf8");
    const result = convertAnsible(dir, { write: true, out: join(dir, "out") });
    const vars = yamlLoad(readFileSync(join(result.out, "group_vars", "all.yml"), "utf8")) as Record<string, unknown>;
    expect(vars.url).toEqual({ $jinja: "http://{{ play.host }}:{{ vars.port }}" });
    expect(result.findings.some((f) => f.construct === "role-dependencies")).toBe(false);
  });

  test("changed_when on shell maps to run_mode", () => {
    const dir = tmp("changed-when");
    const file = join(dir, "site.yml");
    writeFileSync(file, `- hosts: web\n  tasks:\n    - name: check\n      shell: /bin/true\n      changed_when: false\n`, "utf8");
    const result = convertAnsible(file, { write: true, out: join(dir, "out") });
    const converted = yamlLoad(readFileSync(join(result.out, "site.yml"), "utf8")) as Array<Record<string, unknown>>;
    const task = (converted[0]!.tasks as Array<Record<string, unknown>>)[0]!;
    expect(task.shell).toEqual({ command: "/bin/true", run_mode: "readonly" });
    expect(result.findings.some((f) => f.construct === "changed_when" && f.disposition === "handoff")).toBe(false);
  });

  test("percentage serial is preserved", () => {
    const dir = tmp("serial");
    const file = join(dir, "site.yml");
    writeFileSync(file, `- hosts: web\n  serial: "30%"\n  tasks:\n    - name: t\n      debug:\n        msg: ok\n`, "utf8");
    const result = convertAnsible(file, { write: true, out: join(dir, "out") });
    const converted = yamlLoad(readFileSync(join(result.out, "site.yml"), "utf8")) as Array<Record<string, unknown>>;
    expect(converted[0]!.serial).toBe("30%");
    expect(result.findings.some((f) => f.construct === "serial" && f.disposition === "handoff")).toBe(false);
  });

  test("with_together and with_nested map to zip/product", () => {
    const dir = tmp("together");
    const file = join(dir, "site.yml");
    writeFileSync(file, `- hosts: web\n  vars:\n    a: [1, 2]\n    b: [3, 4]\n  tasks:\n    - name: together\n      debug:\n        msg: "{{ item[0] }}-{{ item[1] }}"\n      with_together:\n        - "{{ a }}"\n        - "{{ b }}"\n    - name: nested\n      debug:\n        msg: "{{ item[0] }}-{{ item[1] }}"\n      with_nested:\n        - "{{ a }}"\n        - "{{ b }}"\n`, "utf8");
    const result = convertAnsible(file, { write: true, out: join(dir, "out") });
    const converted = yamlLoad(readFileSync(join(result.out, "site.yml"), "utf8")) as Array<Record<string, unknown>>;
    const tasks = converted[0]!.tasks as Array<Record<string, unknown>>;
    expect(tasks[0]!.loop).toEqual({ $each: { $jinja: "{{ vars.a | zip(vars.b) | to_json }}" } });
    expect(tasks[1]!.loop).toEqual({ $each: { $jinja: "{{ vars.a | product(vars.b) | to_json }}" } });
  });

  test("handoff bundle can be written without --write", () => {
    const dir = tmp("handoff-only");
    const file = join(dir, "site.yml");
    writeFileSync(file, `- hosts: web\n  tasks:\n    - name: t\n      shell: /bin/false\n      ignore_errors: true\n`, "utf8");
    const handoff = join(dir, "handoff");
    const result = convertAnsible(file, { handoff });
    expect(result.applied).toBe(false);
    expect(existsSync(join(handoff, "HANDOFF.md"))).toBe(true);
    expect(existsSync(join(handoff, "manifest.json"))).toBe(true);
  });

  test("with_first_found maps to copy/template candidates", () => {
    const dir = tmp("first-found");
    const file = join(dir, "site.yml");
    writeFileSync(file, `- hosts: web\n  tasks:\n    - name: template\n      template:\n        src: "{{ item }}"\n        dest: /etc/app.conf\n      with_first_found:\n        - "{{ ansible_distribution }}.j2"\n        - default.j2\n    - name: copy\n      copy:\n        src: "{{ item }}"\n        dest: /etc/app.raw\n      with_first_found:\n        - "{{ ansible_distribution }}.conf"\n        - default.conf\n`, "utf8");
    const result = convertAnsible(file, { write: true, out: join(dir, "out") });
    const converted = yamlLoad(readFileSync(join(result.out, "site.yml"), "utf8")) as Array<Record<string, unknown>>;
    const tasks = converted[0]!.tasks as Array<Record<string, unknown>>;
    expect((tasks[0]!.copy as Record<string, unknown>).content).toEqual({
      template_file: [{ $jinja: "{{ facts.distribution }}.j2" }, "default.j2"],
      engine: "jinja",
    });
    expect((tasks[1]!.copy as Record<string, unknown>).src).toEqual([
      { $jinja: "{{ facts.distribution }}.conf" },
      "default.conf",
    ]);
  });

  test("play order is preserved", () => {
    const dir = tmp("order");
    const file = join(dir, "site.yml");
    writeFileSync(file, `- hosts: web\n  order: reverse_inventory\n  tasks:\n    - name: t\n      debug:\n        msg: ok\n`, "utf8");
    const result = convertAnsible(file, { write: true, out: join(dir, "out") });
    const converted = yamlLoad(readFileSync(join(result.out, "site.yml"), "utf8")) as Array<Record<string, unknown>>;
    expect(converted[0]!.order).toBe("reverse_inventory");
    expect(result.findings.some((f) => f.construct === "order" && f.disposition === "handoff")).toBe(false);
  });

  test("--project scaffolds a blank project and populates it", () => {
    const dir = tmp("project");
    const source = join(dir, "ansible");
    mkdirSync(join(source, "playbooks"), { recursive: true });
    writeFileSync(join(source, "playbooks", "site.yml"), `- hosts: web\n  tasks:\n    - name: t\n      debug:\n        msg: ok\n`, "utf8");
    const project = join(dir, "my-project");
    const result = convertAnsible(source, { write: true, project });
    expect(result.project?.root).toBe(project);
    expect(result.out).toBe(project);
    expect(existsSync(join(project, "rolecall.yaml"))).toBe(true);
    expect(existsSync(join(project, "inventory", "inventory.yaml"))).toBe(true);
    expect(existsSync(join(project, "plugins", "modules", "my-project"))).toBe(true);
    expect(existsSync(join(project, "playbooks", "site.yml"))).toBe(true);
    expect(validateConvertedTree(join(project, "playbooks")).every((entry) => entry.ok)).toBe(true);
  });

  test("strict mode flags remaining handoff items", () => {
    const dir = tmp("strict");
    const file = join(dir, "site.yml");
    writeFileSync(file, `- hosts: web\n  tasks:\n    - name: bad\n      shell: /bin/false\n      ignore_errors: true\n`, "utf8");
    const result = convertAnsible(file, { strict: true });
    expect(result.totals.handoff).toBeGreaterThan(0);
  });
});

describe("compatibility matrix", () => {
  test("rules are unique and actionable", () => {
    const ids = Object.keys(TASK_RULES);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of Object.values(TASK_RULES)) {
      expect(rule.message.length).toBeGreaterThan(10);
      expect(rule.disposition).toBe("handoff");
    }
    expect(MODULE_REMAP.template).toBe("copy");
    expect(MODULE_REMAP.apt).toBe("package");
  });
});
