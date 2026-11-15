// Ansible inventory connection-var conversion.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { convertAnsible } from "../src/convert/ansible";

const tmp = (suffix: string) => mkdtempSync(join(tmpdir(), `rolecall-inventory-${suffix}-`));

describe("inventory connection vars", () => {
  test("rewrites YAML inventory ansible_* vars", () => {
    const dir = tmp("yaml");
    const file = join(dir, "inventory.yml");
    writeFileSync(
      file,
      `all:\n  hosts:\n    web1:\n      ansible_host: 10.0.0.5\n      ansible_user: deploy\n      ansible_port: 2222\n      ansible_connection: local\n`,
      "utf8",
    );
    const result = convertAnsible(file, { write: true, out: join(dir, "out") });
    const out = readFileSync(join(dir, "out", "inventory.yml"), "utf8");
    expect(out).toContain("rolecall_host: 10.0.0.5");
    expect(out).toContain("rolecall_user: deploy");
    expect(out).toContain("rolecall_port: 2222");
    expect(out).toContain("rolecall_connection: local");
    expect(result.findings.some((f) => f.construct === "ansible_host" && f.disposition === "mapped")).toBe(true);
  });

  test("rewrites INI group vars and inline host vars", () => {
    const dir = tmp("ini");
    const file = join(dir, "hosts.ini");
    writeFileSync(
      file,
      `[web]\nweb1 ansible_host=10.0.0.5 ansible_user=deploy\n\n[web:vars]\nansible_port=2222\nansible_connection=local\n`,
      "utf8",
    );
    const result = convertAnsible(file, { write: true, out: join(dir, "out") });
    const out = readFileSync(join(dir, "out", "hosts.ini"), "utf8");
    expect(out).toContain("web1 rolecall_host=10.0.0.5 rolecall_user=deploy");
    expect(out).toContain("rolecall_port=2222");
    expect(out).toContain("rolecall_connection=local");
    expect(result.findings.filter((f) => f.disposition === "mapped").length).toBeGreaterThan(0);
  });

  test("flags unsupported connection values", () => {
    const dir = tmp("winrm");
    const file = join(dir, "inventory.yml");
    writeFileSync(file, `all:\n  hosts:\n    win1:\n      ansible_connection: winrm\n`, "utf8");
    const result = convertAnsible(file, { write: true, out: join(dir, "out") });
    expect(result.findings.some((f) => f.construct === "ansible_connection" && f.disposition === "gap")).toBe(true);
  });
});
