// FQCN resolver + scanner tests (ADR 0014 work items 1-2). Bun-primary (`bun:test`).
//
// Exercises the scanner (pure FS) and the resolver (FQCN / bare alias / builtin
// reservation / ambiguity) against fixtures under tests/fixtures/plugins.

import { beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { registerAllModules } from "../src/modules/builtins";
import {
  ModuleCollisionError,
  resolveModule,
  scanAndRegister,
  scanProject,
} from "../src/modules/resolver";

const FX = join(import.meta.dir, "fixtures");

beforeAll(async () => {
  // Builtins must be registered so the resolver's reserved-bare-name set includes
  // `copy` (used by the builtin-reservation test).
  registerAllModules();
  await scanAndRegister(FX);
});

test("scanProject derives FQCN from path and tags the plugin type", () => {
  const entries = scanProject({ root: FX });
  const fqcns = entries.map((e) => e.fqcn).sort();
  expect(fqcns).toEqual([
    "acme.notify",
    "myorg.copy",
    "myorg.firewall",
    "teamA.logger",
    "teamB.logger",
  ]);
  const fw = entries.find((e) => e.fqcn === "myorg.firewall")!;
  expect(fw.namespace).toBe("myorg");
  expect(fw.name).toBe("firewall");
  expect(fw.type).toBe("modules");
  expect(fw.filePath).toContain(join("myorg", "firewall.ts"));
});

test("FQCN reference resolves to the scanned module", () => {
  const r = resolveModule("myorg.firewall");
  expect(r.kind).toBe("module");
  if (r.kind === "module") {
    expect(r.fqcn).toBe("myorg.firewall");
    expect(r.module.name).toBe("myorg.firewall");
    expect(r.entry?.fqcn).toBe("myorg.firewall");
  }
});

test("unambiguous bare alias resolves to its single FQCN", () => {
  const r = resolveModule("notify");
  expect(r.kind).toBe("module");
  if (r.kind === "module") expect(r.module.name).toBe("acme.notify");
});

test("builtin bare name is reserved even when a user plugin shares the bare name", () => {
  const r = resolveModule("copy");
  expect(r.kind).toBe("module");
  if (r.kind === "module") {
    // bare `copy` must resolve to the BUILTIN, not the user `myorg.copy`.
    expect(r.module.name).toBe("copy");
    expect(r.fqcn).toBe("copy");
  }
  // The user plugin is still reachable by its FQCN.
  const fqcn = resolveModule("myorg.copy");
  expect(fqcn.kind).toBe("module");
  if (fqcn.kind === "module") expect(fqcn.module.name).toBe("myorg.copy");
});

test("ambiguous bare reference returns an ambiguous result listing candidates", () => {
  const r = resolveModule("logger");
  expect(r.kind).toBe("ambiguous");
  if (r.kind === "ambiguous") {
    expect(r.spec).toBe("logger");
    expect(r.candidates.slice().sort()).toEqual(["teamA.logger", "teamB.logger"]);
  }
});

test("rolecall.builtin.* prefix resolves to the builtin", () => {
  const r = resolveModule("rolecall.builtin.copy");
  expect(r.kind).toBe("module");
  if (r.kind === "module") expect(r.module.name).toBe("copy");
});

test("ansible.builtin.* prefix also resolves to the builtin", () => {
  const r = resolveModule("ansible.builtin.copy");
  expect(r.kind).toBe("module");
  if (r.kind === "module") expect(r.module.name).toBe("copy");
});

test("unknown FQCN returns notFound", () => {
  const r = resolveModule("nope.missing");
  expect(r.kind).toBe("notFound");
  if (r.kind === "notFound") expect(r.spec).toBe("nope.missing");
});

test("ModuleCollisionError carries spec and candidates", () => {
  const e = new ModuleCollisionError("logger", ["teamA.logger", "teamB.logger"]);
  expect(e.spec).toBe("logger");
  expect(e.candidates).toEqual(["teamA.logger", "teamB.logger"]);
  expect(e.message).toContain("ambiguous");
  expect(e).toBeInstanceOf(Error);
});
