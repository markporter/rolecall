// Ansible inventory loader tests (roadmap P6).
//
// The Ansible parsers now feed the loader's format auto-detection, so these tests
// exercise the LOADER entry points (`loadInventoryFile` / `loadInventory`) rather
// than a removed `inventory import` command.
//
// Coverage:
//   (a) INI parse: [group] hosts + inline vars, [group:children], [group:vars]
//   (b) YAML parse: all.children / all.vars nesting + per-host vars
//   (c) top-level children/vars treated as an implicit `all`
//   (d) detection: extension + content sniffing (ini vs ansible-yaml vs native)
//   (e) loader round-trip: Ansible fixtures load + resolve through the engine
//       with correct precedence (child over parent, host over group)
//   (f) errors: malformed INI (line number) via loader + parser, cycle,
//       malformed YAML, unrecognized garbage
import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { detectInventoryFormat, loadInventory, loadInventoryFile } from "../src/config/loader";
import { resolveTargets } from "../src/inventory/engine";
import {
  AnsibleInventoryError,
  parseAnsibleIniInventory,
  parseAnsibleYamlInventory,
} from "../src/inventory/ansible";
import { FsProjectSource } from "../src/vfs/fs-project-source";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");

const iniFixture = join(fixtures, "ansible-inventory.ini");
const yamlFixture = join(fixtures, "ansible-inventory.yaml");
const badIniFixture = join(fixtures, "ansible-inventory.bad.ini");

/** Load a fixture through the same VFS seam the CLI uses (source rooted at the file's dir). */
function loadFixture(path: string) {
  return loadInventoryFile(path, new FsProjectSource(dirname(path)));
}

// --- (a) INI -----------------------------------------------------------------
test("INI parses groups, children, group vars, and inline host vars", async () => {
  const inv = parseAnsibleIniInventory(await Bun.file(iniFixture).text());
  expect(Object.keys(inv.groups).sort()).toEqual([
    "all",
    "db",
    "web",
    "web_edge",
  ]);
  // web: only its DIRECT hosts; web_edge is preserved as a child, not flattened.
  expect(inv.groups.web!.hosts).toEqual([
    "web1.example.com",
    "web2.example.com",
  ]);
  expect(inv.groups.web!.children).toEqual(["web_edge"]);
  expect(inv.groups.web!.vars).toEqual({
    env: "production",
    retries: 3,
    role: "web",
  });
  expect(inv.groups.web_edge!.hosts).toEqual(["edge1.example.com"]);
  // The implicit all group carries [all:vars]; it has no direct hosts.
  expect(inv.groups.all!.vars).toEqual({ region: "us-east" });
  expect(inv.groups.all!.hosts).toEqual([]);
  // Inline host vars land in the document-root host_vars map, not a synthetic group.
  expect(inv.hostVars).toEqual({
    "web1.example.com": { ansible_user: "deploy", http_port: 80 },
  });
});

test("INI ignores comments and blank lines and honors quoted values", () => {
  const inv = parseAnsibleIniInventory(
    [
      "# leading comment",
      "",
      "[web]  # inline comment",
      "web1 key=\"a b\" flag=true count=2",
      "",
      "[web:vars]",
      "motd='hello world'  ; trailing comment",
    ].join("\n"),
  );
  expect(inv.groups.web!.hosts).toEqual(["web1"]);
  expect(inv.hostVars).toEqual({
    web1: { flag: true, count: 2, key: "a b" },
  });
  expect(inv.groups.web!.vars).toEqual({ motd: "hello world" });
});

// --- (b) YAML ----------------------------------------------------------------
test("YAML parses all.children / all.vars nesting with per-host vars", async () => {
  const inv = parseAnsibleYamlInventory(await Bun.file(yamlFixture).text());
  expect(Object.keys(inv.groups).sort()).toEqual([
    "all",
    "db",
    "web",
    "web_edge",
  ]);
  expect(inv.groups.all!.vars).toEqual({ env: "production" });
  expect(inv.groups.all!.children).toEqual(["db", "web"]);
  // web keeps its own direct hosts and its child group reference.
  expect(inv.groups.web!.hosts).toEqual([
    "web1.example.com",
    "web2.example.com",
  ]);
  expect(inv.groups.web!.children).toEqual(["web_edge"]);
  expect(inv.groups.web!.vars).toEqual({ retries: 3, role: "web" });
  expect(inv.groups.web_edge!.hosts).toEqual(["edge1.example.com"]);
  expect(inv.hostVars).toEqual({
    "web1.example.com": { ansible_user: "deploy", http_port: 80 },
  });
});

// --- (c) top-level children / vars -------------------------------------------
test("YAML top-level children/vars behave as an implicit all group", () => {
  const inv = parseAnsibleYamlInventory(
    [
      "vars:",
      "  env: staging",
      "children:",
      "  web:",
      "    hosts:",
      "      web1:",
      "      web2:",
    ].join("\n"),
  );
  expect(Object.keys(inv.groups).sort()).toEqual(["all", "web"]);
  expect(inv.groups.all!.vars).toEqual({ env: "staging" });
  expect(inv.groups.all!.children).toEqual(["web"]);
  expect(inv.groups.all!.hosts).toEqual([]);
  expect(inv.groups.web!.hosts).toEqual(["web1", "web2"]);
});

// --- (d) detection -----------------------------------------------------------
test("detectInventoryFormat recognizes Ansible INI, Ansible YAML, and native YAML", async () => {
  const iniText = await Bun.file(iniFixture).text();
  const yamlText = await Bun.file(yamlFixture).text();
  expect(detectInventoryFormat(iniText, iniFixture)).toBe("ini");
  expect(detectInventoryFormat(yamlText, yamlFixture)).toBe("ansible-yaml");
  // Content sniffing works without a helpful extension.
  expect(detectInventoryFormat("[web]\nweb1", "noext")).toBe("ini");
  // A native `groups:` root is never Ansible.
  expect(detectInventoryFormat("groups:\n  web:\n    hosts:\n      - web1", "native.yaml")).toBe(
    "native",
  );
  // Garbage that is not YAML falls through to the native path.
  expect(detectInventoryFormat("not: [valid", "junk.yaml")).toBe("native");
});

// --- (e) loader round-trip through the existing engine -----------------------
test("loader resolves an Ansible INI fixture with Ansible precedence", async () => {
  const inventory = await loadFixture(iniFixture);
  const resolved = await resolveTargets(inventory, ["all"]);
  expect(resolved.matchedHosts).toEqual([
    "db1.example.com",
    "edge1.example.com",
    "web1.example.com",
    "web2.example.com",
  ]);
  // all.vars (region) < web (env/retries/role) < host vars (http_port/ansible_user).
  expect(resolved.hosts["web1.example.com"]).toEqual({
    ansible_user: "deploy",
    env: "production",
    http_port: 80,
    region: "us-east",
    retries: 3,
    role: "web",
  });
  expect(resolved.hosts["edge1.example.com"]).toEqual({
    env: "production",
    region: "us-east",
    retries: 3,
    role: "web",
  });
  expect(resolved.hosts["db1.example.com"]).toEqual({ region: "us-east" });
});

test("loader resolves an Ansible YAML fixture through the engine", async () => {
  const inventory = await loadFixture(yamlFixture);
  const resolved = await resolveTargets(inventory, ["web:children"]);
  expect(resolved.matchedHosts).toEqual([
    "edge1.example.com",
    "web1.example.com",
    "web2.example.com",
  ]);
  expect(resolved.hosts["web1.example.com"]).toEqual({
    ansible_user: "deploy",
    env: "production",
    http_port: 80,
    retries: 3,
    role: "web",
  });
});

test("loaded hierarchy honors Ansible precedence (child over parent, host over group)", async () => {
  // Parent `web` sets env=prod; child `web_edge` sets env=edge. With the legacy
  // sorted-name merge a host's synthetic group (web1.example.com) sorted BEFORE
  // web_edge ('1' < '_'), so the edge group wrongly beat the host. The hierarchy
  // model must give: no host var -> env=edge (child over parent); host var -> env=host.
  const parentChild = [
    "[web]",
    "web2.example.com",
    "[web:children]",
    "web_edge",
    "[web:vars]",
    "env=prod",
    "[web_edge]",
    "web1.example.com",
    "[web_edge:vars]",
    "env=edge",
  ].join("\n");
  const withHostVar = [
    "[web]",
    "web2.example.com",
    "[web:children]",
    "web_edge",
    "[web:vars]",
    "env=prod",
    "[web_edge]",
    "web1.example.com env=host",
    "[web_edge:vars]",
    "env=edge",
  ].join("\n");

  const noHost = await resolveTargets(loadInventory(parentChild, "inline.ini"), ["web1.example.com"]);
  expect(noHost.hosts["web1.example.com"]!.env).toBe("edge");

  const hostWins = await resolveTargets(loadInventory(withHostVar, "inline.ini"), ["web1.example.com"]);
  expect(hostWins.hosts["web1.example.com"]!.env).toBe("host");
});

test("loader output is deterministic across repeated loads", async () => {
  const first = await loadFixture(iniFixture);
  const second = await loadFixture(iniFixture);
  expect(first).toEqual(second);
  // db has no vars.
  expect(first.groups.db).toEqual({ hosts: ["db1.example.com"], vars: {} });
});

// --- (f) errors --------------------------------------------------------------
test("INI rejects content before any group header (parser)", () => {
  expect(() =>
    parseAnsibleIniInventory("web1.example.com\n[web]\nweb2.example.com"),
  ).toThrow(/before any group header/);
});

test("INI rejects an unterminated quote", () => {
  expect(() => parseAnsibleIniInventory('[web]\nweb1 key="oops')).toThrow(
    /unterminated double quote/,
  );
});

test("INI rejects a group hierarchy cycle", () => {
  expect(() =>
    parseAnsibleIniInventory("[a:children]\nb\n[b:children]\na"),
  ).toThrow(/cycle detected/);
});

test("YAML rejects a non-mapping root and unknown group keys", () => {
  expect(() => parseAnsibleYamlInventory("just a string")).toThrow(/top-level mapping/);
  expect(() =>
    parseAnsibleYamlInventory(["web:", "  bogus: true"].join("\n")),
  ).toThrow(/unknown key 'bogus'/);
});

test("loader surfaces malformed INI with the offending line number", async () => {
  await expect(loadFixture(badIniFixture)).rejects.toThrow(AnsibleInventoryError);
  await expect(loadFixture(badIniFixture)).rejects.toThrow(/line 1.*before any group header/);
});

test("loader rejects unrecognized garbage clearly", () => {
  expect(() => loadInventory("this file is not a RoleCall or Ansible inventory", "junk.txt")).toThrow();
});
