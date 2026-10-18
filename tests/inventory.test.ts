// Inventory engine tests (Wave 1, Todo 4). Bun-only MVP (bun test).
//
// Coverage:
//   (a) precedence matrix fixture (overlapping host/group/defaults) -> exact snapshot
//   (b) wildcard + group + :children target expansion
//   (c) plugin registry loads built-ins + sample external (file/env) plugin
//   (d) cross-runtime stable ordering (sorted host + var keys)
//   (e) unknown variable access yields a clean result, NOT NaN/crash
import { expect, test } from "bun:test";
import { deepEqual } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadInventory,
  loadInventoryFile,
  resolveDirectoryVars,
} from "../src/config/loader";
import {
  createDynamicEnvPlugin,
  createDynamicFilePlugin,
  createStaticPlugin,
  getInventoryPlugin,
  listInventoryPlugins,
  registerInventoryPlugin,
} from "../src/inventory/plugin";
import {
  type ResolvedInventory,
  lookupVar,
  resolveTargets,
  sortedRecord,
} from "../src/inventory/engine";
import { FsProjectSource } from "../src/vfs/fs-project-source";

const fixtures = join(fileURLToPath(import.meta.url), "..", "fixtures");
const groupVarsInventory = join(fixtures, "groupvars", "inventory.yaml");

function isSorted(keys: string[]): boolean {
  for (let i = 1; i < keys.length; i++) {
    if (keys[i - 1]! > keys[i]!) return false;
  }
  return true;
}

// --- (a) precedence matrix: exact resolved snapshot ------------------------
test("precedence: host > group > group_all > defaults (exact snapshot)", async () => {
  const inv = loadInventory(`
groups:
  all:
    hosts: [web1, web2, db1]
    vars: { env: prod, region: us-east }
  web:
    hosts: [web1, web2]
    vars: { role: web, region: us-west, retries: 0 }
  db:
    hosts: [db1]
    vars: { role: db }
`);
  const resolved = await resolveTargets(inv, ["all"], {
    defaults: { env: "base", tier: "standard" },
    hostVars: { web1: { role: "web-primary", region: "eu-central" } },
  });

  deepEqual(resolved.matchedHosts, ["db1", "web1", "web2"]);
  deepEqual(resolved.hosts, {
    db1: { env: "prod", region: "us-east", role: "db", tier: "standard" },
    web1: {
      env: "prod",
      region: "eu-central",
      retries: 0,
      role: "web-primary",
      tier: "standard",
    },
    web2: {
      env: "prod",
      region: "us-west",
      retries: 0,
      role: "web",
      tier: "standard",
    },
  });
});

// --- (a2) hierarchical group precedence (Ansible child-over-parent) ----------
test("child group vars override parent group vars", async () => {
  // `web` sorts BEFORE `web_parent`, so the legacy sorted-name merge would let the
  // parent win. Hierarchy must make the child (`web`) override its parent.
  const inv = loadInventory(`
groups:
  web_parent:
    hosts: []
    vars: { env: parent }
    children: [web]
  web:
    hosts: [h1]
    vars: { env: child }
`);
  const resolved = await resolveTargets(inv, ["h1"]);
  expect(resolved.hosts.h1!.env).toBe("child");
});

test("host vars override group vars regardless of sorted-name order", async () => {
  // With the old synthetic-host-group scheme, host `web1.example.com` sorted before
  // group `web_edge` ('1' < '_') and the group won. Real host_vars must win.
  const inv = loadInventory(`
groups:
  web_edge:
    hosts: [web1.example.com]
    vars: { env: edge }
host_vars:
  web1.example.com:
    env: host
`);
  const resolved = await resolveTargets(inv, ["web1.example.com"]);
  expect(resolved.hosts["web1.example.com"]!.env).toBe("host");
});

test("multi-level hierarchy merges root-first (grandparent < parent < child)", async () => {
  // Sorted-name order would apply `a_deep` first and `zone` last (zone wins); the
  // hierarchy must apply the root `zone` first and the grandchild `a_deep` last.
  const inv = loadInventory(`
groups:
  zone:
    hosts: []
    children: [d_zone]
    vars: { tier: zone }
  d_zone:
    hosts: []
    children: [a_deep]
    vars: { tier: parent }
  a_deep:
    hosts: [h1]
    vars: { tier: deep }
`);
  const resolved = await resolveTargets(inv, ["h1"]);
  expect(resolved.hosts.h1!.tier).toBe("deep");
});

test("a host in sibling groups sharing an ancestor merges that ancestor once, root-first", async () => {
  // `prod` is a shared ancestor of `a` and `b`; if it were re-applied while walking
  // b's ancestry it would wrongly override `a`. Each group must merge exactly once,
  // root-first, so `a`'s env wins.
  const inv = loadInventory(`
groups:
  prod:
    hosts: []
    children: [a, b]
    vars: { env: prod, tier: base }
  a:
    hosts: [h1]
    vars: { env: a }
  b:
    hosts: [h1]
    vars: { b_only: true }
`);
  const resolved = await resolveTargets(inv, ["h1"]);
  expect(resolved.hosts.h1!.env).toBe("a");
  expect(resolved.hosts.h1!.tier).toBe("base");
  expect(resolved.hosts.h1!.b_only).toBe(true);
});

test("inventories without children/host_vars resolve exactly as before (regression)", async () => {
  const inv = await loadInventoryFile(join(fixtures, "inventory.valid.yaml"));
  const resolved = await resolveTargets(inv, ["all"]);
  deepEqual(resolved.matchedHosts, [
    "db1.example.com",
    "web1.example.com",
    "web2.example.com",
  ]);
  deepEqual(resolved.hosts, {
    "db1.example.com": {},
    "web1.example.com": { role: "web" },
    "web2.example.com": { role: "web" },
  });
});

// --- (b) wildcard / group / children expansion ------------------------------
test("wildcard target expands to matching hosts", async () => {
  const inv = loadInventory(await Bun.file(join(fixtures, "inventory.wildcard.yaml")).text());
  const resolved = await resolveTargets(inv, ["web*"]);
  expect(resolved.matchedHosts).toEqual(["web1", "web2", "web3"]);
});

test("group-name target expands to its member hosts", async () => {
  const inv = loadInventory(await Bun.file(join(fixtures, "inventory.wildcard.yaml")).text());
  const resolved = await resolveTargets(inv, ["db"]);
  expect(resolved.matchedHosts).toEqual(["db1"]);
});

test("'all' target expands to every host", async () => {
  const inv = loadInventory(await Bun.file(join(fixtures, "inventory.wildcard.yaml")).text());
  const resolved = await resolveTargets(inv, ["all"]);
  expect(resolved.matchedHosts).toEqual(["db1", "lb1", "web1", "web2", "web3"]);
});

test("group:children expands group + descendant groups", async () => {
  const inv = loadInventory(await Bun.file(join(fixtures, "inventory.children.yaml")).text());
  const resolved = await resolveTargets(inv, ["web:children"], {
    children: { web: ["web_edge"] },
  });
  expect(resolved.matchedHosts).toEqual(["edge1", "web1", "web2"]);
});

test("unknown target pattern yields no hosts (no crash)", async () => {
  const inv = loadInventory(await Bun.file(join(fixtures, "inventory.wildcard.yaml")).text());
  const resolved = await resolveTargets(inv, ["ghost*"]);
  expect(resolved.matchedHosts).toEqual([]);
  expect(resolved.hosts).toEqual({});
});

// --- (c) plugin registry: built-ins + sample external plugin ----------------
test("registry loads built-in static + dynamic plugins", () => {
  const names = listInventoryPlugins();
  expect(names).toContain("static");
  expect(names).toContain("dynamic");
  expect(getInventoryPlugin("static")).toBeDefined();
  expect(getInventoryPlugin("dynamic")).toBeDefined();
});

test("static + external file plugin merge into one graph", async () => {
  const inv = loadInventory(`
groups:
  web:
    hosts: [web1, web2]
    vars: { role: web }
`);
  const filePlugin = createDynamicFilePlugin({
    source: join(fixtures, "dynamic.inventory.json"),
  });
  const resolved = await resolveTargets(inv, ["all"], { plugins: [filePlugin] });

  deepEqual(resolved.matchedHosts, ["dyn1", "dyn2", "web1", "web2"]);
  deepEqual(resolved.hosts, {
    dyn1: {
      env: "dyn",
      managed_by: "dynamic-plugin",
      role: "dyn-web",
      source: "dynamic",
    },
    dyn2: { env: "dyn", managed_by: "dynamic-plugin", source: "dynamic" },
    web1: { managed_by: "dynamic-plugin", role: "web" },
    web2: { managed_by: "dynamic-plugin", role: "web" },
  });
});

test("registered dynamic env plugin contributes when env is set", async () => {
  const payload = JSON.stringify({
    hosts: ["e1"],
    groupHosts: { eg: ["e1"] },
    groupVars: { eg: { tag: "env" } },
  });
  process.env.ROLECALL_DYNAMIC_INVENTORY = payload;
  try {
    const inv = loadInventory(`groups: {}`);
    const resolved = await resolveTargets(inv, ["all"]);
    expect(resolved.matchedHosts).toEqual(["e1"]);
    expect(resolved.hosts.e1).toEqual({ tag: "env" });
  } finally {
    delete process.env.ROLECALL_DYNAMIC_INVENTORY;
  }
});

test("registerInventoryPlugin adds an external plugin to the registry", () => {
  const before = listInventoryPlugins();
  registerInventoryPlugin(
    "external",
    createDynamicEnvPlugin({ name: "external", envVar: "ROLECALL_EXT_INV" }),
  );
  expect(listInventoryPlugins()).toContain("external");
  expect(getInventoryPlugin("external")?.name).toBe("external");
  // cleanup so other tests are unaffected
  // (registry is module-global; leave external registered — harmless, env unset)
  void before;
});

// --- (d) cross-runtime stable ordering (sorted keys) ------------------------
test("output host names and var keys are deterministically sorted", async () => {
  const inv = loadInventory(await Bun.file(join(fixtures, "inventory.precedence.yaml")).text());
  const resolved = await resolveTargets(inv, ["all"], {
    defaults: { env: "base", tier: "standard" },
    hostVars: { web1: { role: "web-primary", region: "eu-central" } },
  });

  expect(isSorted(resolved.matchedHosts)).toBe(true);
  for (const host of resolved.matchedHosts) {
    expect(isSorted(Object.keys(resolved.hosts[host]!))).toBe(true);
  }
  // sortedRecord helper is itself stable
  deepEqual(
    sortedRecord({ b: 1, a: 2, c: 3 }),
    { a: 2, b: 1, c: 3 },
  );
});

test("resolution is deterministic across repeated calls", async () => {
  const inv = loadInventory(await Bun.file(join(fixtures, "inventory.precedence.yaml")).text());
  const opts = {
    defaults: { env: "base", tier: "standard" },
    hostVars: { web1: { role: "web-primary", region: "eu-central" } },
  };
  const a = await resolveTargets(inv, ["all"], opts);
  const b = await resolveTargets(inv, ["all"], opts);
  deepEqual(a, b);
});

// --- (e) unknown variable access: clean result, no NaN/crash -----------------
test("lookupVar returns unknown_variable (not NaN) for missing key", async () => {
  const inv = loadInventory(await Bun.file(join(fixtures, "inventory.precedence.yaml")).text());
  const resolved: ResolvedInventory = await resolveTargets(inv, ["web1"]);
  const r = lookupVar(resolved, "web1", "does_not_exist");
  expect(r).toEqual({ found: false, reason: "unknown_variable" });
});

test("lookupVar returns unknown_host for an unmatched host", async () => {
  const inv = loadInventory(await Bun.file(join(fixtures, "inventory.precedence.yaml")).text());
  const resolved = await resolveTargets(inv, ["web1"]);
  const r = lookupVar(resolved, "ghost", "env");
  expect(r).toEqual({ found: false, reason: "unknown_host" });
});

test("numeric zero var resolves to 0, never NaN", async () => {
  const inv = loadInventory(await Bun.file(join(fixtures, "inventory.precedence.yaml")).text());
  const resolved = await resolveTargets(inv, ["web1"]);
  // web group sets retries: 0 — must survive resolution as the number 0.
  const r = lookupVar(resolved, "web1", "retries");
  expect(r).toEqual({ found: true, value: 0 });
  if (r.found) expect(r.value).toBe(0);
});

test("lookupVar returns the exact raw value for a present key", async () => {
  const inv = loadInventory(await Bun.file(join(fixtures, "inventory.precedence.yaml")).text());
  const resolved = await resolveTargets(inv, ["web1"]);
  const r = lookupVar(resolved, "web1", "env");
  expect(r).toEqual({ found: true, value: "prod" });
});

// --- (f) directory group_vars / host_vars layers (T4) -----------------------
// Discovery reads `group_vars/<group>.yaml` and `host_vars/<host>.yaml` adjacent to
// the inventory through the VFS seam and injects them as precedence layers:
// host > group > group_all > defaults.

test("resolveDirectoryVars discovers group_vars + host_vars next to an inventory", async () => {
  const source = new FsProjectSource(dirname(groupVarsInventory));
  const dirVars = await resolveDirectoryVars(groupVarsInventory, source);
  deepEqual(dirVars.groupVarsByGroup, {
    all: { tier: "g_all_tier", datacenter: "dc1" },
    web: { role: "web_dir", web_specific: "yes" },
  });
  deepEqual(dirVars.hostVarsByHost, {
    web1: { region: "host_region", role: "host_role", host_specific: "yes" },
  });
});

test("directory layers honor precedence host > group > group_all > defaults", async () => {
  const source = new FsProjectSource(dirname(groupVarsInventory));
  const inventory = await loadInventoryFile(groupVarsInventory, source);
  const dirVars = await resolveDirectoryVars(groupVarsInventory, source);
  const resolved = await resolveTargets(inventory, ["all"], {
    defaults: { env: "base", tier: "default_tier" },
    groupVars: dirVars.groupVarsByGroup,
    hostVars: dirVars.hostVarsByHost,
  });

  deepEqual(resolved.matchedHosts, ["db1", "web1", "web2"]);
  deepEqual(resolved.hosts, {
    db1: { datacenter: "dc1", env: "prod", region: "us-east", tier: "g_all_tier" },
    web1: {
      datacenter: "dc1",
      env: "prod",
      host_specific: "yes",
      region: "host_region",
      retries: 0,
      role: "host_role",
      tier: "g_all_tier",
      web_specific: "yes",
    },
    web2: {
      datacenter: "dc1",
      env: "prod",
      region: "us-west",
      retries: 0,
      role: "web_dir",
      tier: "g_all_tier",
      web_specific: "yes",
    },
  });
});

test("directory-var resolution is deterministic across repeated calls", async () => {
  const source = new FsProjectSource(dirname(groupVarsInventory));
  const inventory = await loadInventoryFile(groupVarsInventory, source);
  const dirVars = await resolveDirectoryVars(groupVarsInventory, source);
  const opts = {
    defaults: { env: "base", tier: "default_tier" },
    groupVars: dirVars.groupVarsByGroup,
    hostVars: dirVars.hostVarsByHost,
  };
  const a = await resolveTargets(inventory, ["all"], opts);
  const b = await resolveTargets(inventory, ["all"], opts);
  deepEqual(a, b);
});

test("lookupVar resolves a var contributed by a host_vars directory file", async () => {
  const source = new FsProjectSource(dirname(groupVarsInventory));
  const inventory = await loadInventoryFile(groupVarsInventory, source);
  const dirVars = await resolveDirectoryVars(groupVarsInventory, source);
  const resolved = await resolveTargets(inventory, ["web1"], {
    groupVars: dirVars.groupVarsByGroup,
    hostVars: dirVars.hostVarsByHost,
  });
  const r = lookupVar(resolved, "web1", "host_specific");
  expect(r).toEqual({ found: true, value: "yes" });
});

test("directory-var resolution yields deterministically sorted hosts and var keys", async () => {
  const source = new FsProjectSource(dirname(groupVarsInventory));
  const inventory = await loadInventoryFile(groupVarsInventory, source);
  const dirVars = await resolveDirectoryVars(groupVarsInventory, source);
  const resolved = await resolveTargets(inventory, ["all"], {
    defaults: { env: "base", tier: "default_tier" },
    groupVars: dirVars.groupVarsByGroup,
    hostVars: dirVars.hostVarsByHost,
  });

  expect(isSorted(resolved.matchedHosts)).toBe(true);
  for (const host of resolved.matchedHosts) {
    expect(isSorted(Object.keys(resolved.hosts[host]!))).toBe(true);
  }
});

test("resolveDirectoryVars is graceful when no group_vars/host_vars dir exists", async () => {
  const source = new FsProjectSource(process.cwd());
  const dirVars = await resolveDirectoryVars("inventory.yaml", source);
  deepEqual(dirVars.groupVarsByGroup, {});
  deepEqual(dirVars.hostVarsByHost, {});
});
