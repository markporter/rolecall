import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  globalRolecallDir,
  listPlugins,
  registerPlugin,
  removePlugin,
  type PluginManifestEntry,
} from "../src/store/plugin-store";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "rolecall-store-"));
}

test("register then list round-trips an entry", () => {
  const root = tmp();
  const glob = tmp();
  try {
    const entry: PluginManifestEntry = { type: "module", name: "demo", path: "/abs/demo.ts" };
    registerPlugin(entry, { root });
    const listed = listPlugins({ root, globalRoot: glob });
    expect(listed).toHaveLength(1);
    expect(listed[0]!.name).toBe("demo");
    expect(listed[0]!.type).toBe("module");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(glob, { recursive: true, force: true });
  }
});

test("project entry overrides a global entry with the same (name, type)", () => {
  const proj = tmp();
  const glob = tmp();
  try {
    registerPlugin({ type: "module", name: "x", path: "/global/x.ts" }, { globalRoot: glob });
    registerPlugin({ type: "module", name: "x", path: "/proj/x.ts" }, { root: proj });
    const merged = listPlugins({ root: proj, globalRoot: glob });
    const x = merged.find((e) => e.name === "x");
    expect(x!.path).toBe("/proj/x.ts");
  } finally {
    rmSync(proj, { recursive: true, force: true });
    rmSync(glob, { recursive: true, force: true });
  }
});

test("listPlugins tolerates a missing manifest", () => {
  const root = tmp();
  const glob = tmp();
  try {
    expect(listPlugins({ root, globalRoot: glob })).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(glob, { recursive: true, force: true });
  }
});

test("removePlugin deletes an entry and reports misses", () => {
  const root = tmp();
  const glob = tmp();
  try {
    registerPlugin({ type: "module", name: "y", path: "/y.ts" }, { root });
    expect(removePlugin("y", "module", { root })).toBe(true);
    expect(listPlugins({ root, globalRoot: glob })).toEqual([]);
    expect(removePlugin("y", "module", { root })).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(glob, { recursive: true, force: true });
  }
});

test("globalRolecallDir honours $ROLECALL_HOME", () => {
  process.env.ROLECALL_HOME = "/tmp/rolecallhome";
  try {
    expect(globalRolecallDir()).toBe("/tmp/rolecallhome/.rolecall");
  } finally {
    delete process.env.ROLECALL_HOME;
  }
});
