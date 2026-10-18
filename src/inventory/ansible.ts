// Ansible inventory parser (ansible-compatibility-roadmap P6).
//
// Parses the two Ansible inventory text formats into RoleCall's native
// normalized inventory (the shape consumed by `src/config/loader.ts` and
// `src/inventory/engine.ts`):
//
//   • INI  — `[group]` host lists (inline `host key=value` vars),
//            `[group:children]` subgroups, `[group:vars]` group vars.
//   • YAML — `all.children` / `all.vars` nesting (and top-level
//            `children:`/`vars:`/`hosts:`), preserving each group's descendants
//            as `children:` rather than flattening them.
//
// The native schema carries the Ansible tree faithfully: `children:` on a
// group (no flattening) and a document-root `host_vars:` map. Per-host vars from
// an Ansible source — inline INI `host key=value` pairs and YAML
// `hosts: {host: {vars}}` — become entries under `host_vars`, and the engine
// resolves them at host precedence (above all group vars).
//
// The loader (`src/config/loader.ts`) auto-detects the format and calls these
// parsers directly, so `--inventory ansible.ini` works without a conversion
// command. This module is pure: it never reads or writes files or the store.

import { load as yamlLoad } from "js-yaml";

import type { NormalizedInventory } from "../config/schema";

// ---------------------------------------------------------------------------
// Shared types + helpers
// ---------------------------------------------------------------------------

/**
 * @summary Error raised for a malformed Ansible inventory (bad INI syntax, an
 * unrecognized group shape, or a group-hierarchy cycle). Messages carry the
 * offending line number where one is known. The loader surfaces it unchanged.
 */
export class AnsibleInventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnsibleInventoryError";
  }
}

/** Mutable group accumulator shared by both parsers. */
interface GroupAccumulator {
  hosts: Set<string>;
  vars: Record<string, unknown>;
  children: string[];
}

function emptyAccumulator(): GroupAccumulator {
  return { hosts: new Set<string>(), vars: {}, children: [] };
}

/** Sort var keys so serialized output is deterministic across runs. */
function sortVars(vars: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(vars).sort()) out[key] = vars[key];
  return out;
}

/** Ensure a group accumulator exists, creating an empty one on first use. */
function ensureGroup(
  groups: Map<string, GroupAccumulator>,
  name: string,
): GroupAccumulator {
  let group = groups.get(name);
  if (!group) {
    group = emptyAccumulator();
    groups.set(name, group);
  }
  return group;
}

/** Ensure every name referenced as a child exists as an (empty) group. */
function materializeChildren(groups: Map<string, GroupAccumulator>): void {
  const referenced: string[] = [];
  for (const group of groups.values()) {
    for (const child of group.children) referenced.push(child);
  }
  for (const name of referenced) ensureGroup(groups, name);
}

/**
 * @summary Assert the parent→child group hierarchy has no cycle, throwing an
 * {@link AnsibleInventoryError} naming the cycle path when a group is reachable
 * from itself. The schema validates this too; the parser fails early so parse
 * errors stay precise.
 * @param groups Group accumulators keyed by name.
 */
function assertNoCycle(groups: Map<string, GroupAccumulator>): void {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const visit = (name: string): void => {
    const c = color.get(name) ?? WHITE;
    if (c === BLACK) return;
    if (c === GRAY) {
      const idx = stack.indexOf(name);
      const cycle = [...stack.slice(idx), name];
      throw new AnsibleInventoryError(
        `group hierarchy cycle detected: ${cycle.join(" -> ")}`,
      );
    }
    color.set(name, GRAY);
    stack.push(name);
    for (const child of groups.get(name)?.children ?? []) visit(child);
    stack.pop();
    color.set(name, BLACK);
  };
  for (const name of groups.keys()) visit(name);
}

/**
 * @summary Build the native normalized inventory, preserving the Ansible group
 * tree (`children`) and per-host vars instead of flattening. Group names, host
 * lists, child lists, and var keys are all sorted for deterministic output.
 * @param groups Group accumulators keyed by name.
 * @param hostVars Per-host var maps discovered in the source.
 * @returns The normalized inventory (`hostVars` present only when non-empty).
 */
function buildInventory(
  groups: Map<string, GroupAccumulator>,
  hostVars: Record<string, Record<string, unknown>>,
): NormalizedInventory {
  const inventoryGroups: NormalizedInventory["groups"] = {};
  for (const name of [...groups.keys()].sort()) {
    const group = groups.get(name) ?? emptyAccumulator();
    const entry: NormalizedInventory["groups"][string] = {
      hosts: [...group.hosts].sort(),
      vars: sortVars(group.vars),
    };
    if (group.children.length > 0) entry.children = [...group.children].sort();
    inventoryGroups[name] = entry;
  }

  const sortedHostVars: Record<string, Record<string, unknown>> = {};
  for (const host of Object.keys(hostVars).sort()) {
    const vars = hostVars[host];
    if (vars && Object.keys(vars).length > 0) sortedHostVars[host] = sortVars(vars);
  }

  const inventory: NormalizedInventory = { groups: inventoryGroups };
  if (Object.keys(sortedHostVars).length > 0) inventory.hostVars = sortedHostVars;
  return inventory;
}

/** Finalize parsed accumulators into a normalized inventory: materialize referenced children, reject cycles, then build. */
function finalize(
  groups: Map<string, GroupAccumulator>,
  hostVars: Record<string, Record<string, unknown>>,
): NormalizedInventory {
  materializeChildren(groups);
  assertNoCycle(groups);
  return buildInventory(groups, hostVars);
}

/** Case-insensitive scalar decoding approximating Ansible's `literal_eval` handling. */
function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (first === '"' && last === '"') {
      return value
        .slice(1, -1)
        .replace(/\\(["\\/bfnrt])/g, (_match, ch: string) => {
          switch (ch) {
            case "b":
              return "\b";
            case "f":
              return "\f";
            case "n":
              return "\n";
            case "r":
              return "\r";
            case "t":
              return "\t";
            default:
              return ch;
          }
        });
    }
    if (first === "'" && last === "'") {
      return value.slice(1, -1).replace(/''/g, "'");
    }
  }
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  if (/^(null|none)$/i.test(value)) return null;
  if (/^[+-]?\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : value;
  }
  if (/^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
    return Number(value);
  }
  // Pragmatic subset of Ansible's literal_eval: JSON arrays/objects.
  if (
    (value.startsWith("[") && value.endsWith("]")) ||
    (value.startsWith("{") && value.endsWith("}"))
  ) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/** Strip `#`/`;` comments outside single/double quotes. */
function stripInlineComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === undefined) continue;
    if (quote !== null) {
      if (quote === '"' && ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if ((ch === "#" || ch === ";") && (i === 0 || /\s/.test(line[i - 1] ?? ""))) {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Split on whitespace while keeping quoted segments (including quotes) intact. */
function tokenize(line: string, lineNo: number): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === undefined) continue;
    if (quote !== null) {
      current += ch;
      if (quote === '"' && ch === "\\" && i + 1 < line.length) {
        current += line[++i];
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (quote !== null) {
    throw new AnsibleInventoryError(
      `malformed INI inventory at line ${lineNo}: unterminated ${quote === '"' ? "double" : "single"} quote`,
    );
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Index of the first `=` outside quotes, or -1 when none exists. */
function findAssignment(token: string): number {
  let quote: string | null = null;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === undefined) continue;
    if (quote !== null) {
      if (quote === '"' && ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "=") return i;
  }
  return -1;
}

/** Parse one or more `key=value` tokens into a var map. */
function parseAssignments(
  tokens: string[],
  lineNo: number,
  context: string,
): Record<string, unknown> {
  const vars: Record<string, unknown> = {};
  for (const token of tokens) {
    const eq = findAssignment(token);
    if (eq <= 0) {
      throw new AnsibleInventoryError(
        `malformed INI inventory at line ${lineNo}: expected key=value in ${context} (found '${token}')`,
      );
    }
    const key = token.slice(0, eq).trim();
    const value = token.slice(eq + 1);
    if (key.length === 0) {
      throw new AnsibleInventoryError(
        `malformed INI inventory at line ${lineNo}: empty variable name in ${context}`,
      );
    }
    vars[key] = parseScalar(value);
  }
  return vars;
}

// ---------------------------------------------------------------------------
// INI parser
// ---------------------------------------------------------------------------

interface IniSection {
  kind: "hosts" | "children" | "vars";
  group: string;
}

/**
 * @summary Parse Ansible INI inventory text into RoleCall's normalized inventory.
 * Supports `[group]` host lines (including inline `host key=value` vars),
 * `[group:children]` subgroups, `[group:vars]` group vars, `#`/`;` comments,
 * blank lines, and quoted values.
 * @param text Raw INI inventory text.
 * @returns The normalized inventory (group `children` preserved, per-host vars
 *   under `hostVars`).
 * @throws {AnsibleInventoryError} On malformed content (e.g. a host line before
 *   any group header, an unterminated quote, or a group-hierarchy cycle).
 */
export function parseAnsibleIniInventory(text: string): NormalizedInventory {
  const groups = new Map<string, GroupAccumulator>();
  const hostVars: Record<string, Record<string, unknown>> = {};
  let section: IniSection | null = null;

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const lineNo = index + 1;
    const raw = lines[index] ?? "";
    const line = stripInlineComment(raw).trim();
    if (line.length === 0) continue;

    if (line.startsWith("[")) {
      const match = /^\[(.+)\]$/.exec(line);
      if (!match || match[1] === undefined) {
        throw new AnsibleInventoryError(
          `malformed INI inventory at line ${lineNo}: invalid group header '${line}'`,
        );
      }
      const inner = match[1].trim();
      let groupName = inner;
      let kind: IniSection["kind"] = "hosts";
      const colon = inner.lastIndexOf(":");
      if (colon > 0) {
        const suffix = inner.slice(colon + 1).toLowerCase();
        if (suffix === "children" || suffix === "vars") {
          groupName = inner.slice(0, colon).trim();
          kind = suffix;
        }
      }
      if (groupName.length === 0) {
        throw new AnsibleInventoryError(
          `malformed INI inventory at line ${lineNo}: empty group name`,
        );
      }
      section = { kind, group: groupName };
      ensureGroup(groups, groupName);
      continue;
    }

    if (section === null) {
      throw new AnsibleInventoryError(
        `malformed INI inventory at line ${lineNo}: content before any group header ('${line}')`,
      );
    }

    const group = ensureGroup(groups, section.group);
    const tokens = tokenize(line, lineNo);

    if (section.kind === "children") {
      for (const child of tokens) {
        if (!group.children.includes(child)) group.children.push(child);
      }
      continue;
    }

    if (section.kind === "vars") {
      Object.assign(group.vars, parseAssignments(tokens, lineNo, `[${section.group}:vars]`));
      continue;
    }

    // `[group]` host line: first token is the host, the rest are inline vars.
    const host = tokens[0];
    if (host === undefined || host.length === 0) {
      throw new AnsibleInventoryError(
        `malformed INI inventory at line ${lineNo}: empty host entry`,
      );
    }
    group.hosts.add(host);
    if (tokens.length > 1) {
      const vars = parseAssignments(
        tokens.slice(1),
        lineNo,
        `host '${host}'`,
      );
      hostVars[host] = { ...(hostVars[host] ?? {}), ...vars };
    }
  }

  return finalize(groups, hostVars);
}

// ---------------------------------------------------------------------------
// YAML parser
// ---------------------------------------------------------------------------

/** Raw YAML group node before flattening into the accumulator map. */
interface YamlGroupNode {
  hosts: string[];
  hostVars: Record<string, Record<string, unknown>>;
  vars: Record<string, unknown>;
  children: Map<string, YamlGroupNode>;
}

function emptyYamlGroup(): YamlGroupNode {
  return { hosts: [], hostVars: {}, vars: {}, children: new Map() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate + parse a YAML group node (`hosts:` / `vars:` / `children:`). */
function parseYamlGroupNode(
  name: string,
  value: unknown,
  path: string,
): YamlGroupNode {
  const node = emptyYamlGroup();
  if (value === null || value === undefined) return node;
  if (Array.isArray(value)) {
    for (const host of value) {
      if (typeof host !== "string") {
        throw new AnsibleInventoryError(
          `malformed YAML inventory: group '${path}' has a non-string host entry`,
        );
      }
      node.hosts.push(host);
    }
    return node;
  }
  if (!isRecord(value)) {
    throw new AnsibleInventoryError(
      `malformed YAML inventory: group '${path}' must be a mapping (or a list of hosts)`,
    );
  }

  for (const [key, child] of Object.entries(value)) {
    switch (key) {
      case "hosts": {
        if (Array.isArray(child)) {
          for (const host of child) {
            if (typeof host !== "string") {
              throw new AnsibleInventoryError(
                `malformed YAML inventory: group '${path}' has a non-string host entry`,
              );
            }
            node.hosts.push(host);
          }
        } else if (isRecord(child)) {
          for (const [host, vars] of Object.entries(child)) {
            node.hosts.push(host);
            if (vars === null || vars === undefined) continue;
            if (!isRecord(vars)) {
              throw new AnsibleInventoryError(
                `malformed YAML inventory: host '${host}' in group '${path}' must map to a vars mapping`,
              );
            }
            node.hostVars[host] = { ...(node.hostVars[host] ?? {}), ...vars };
          }
        } else {
          throw new AnsibleInventoryError(
            `malformed YAML inventory: group '${path}'.hosts must be a list or mapping`,
          );
        }
        break;
      }
      case "vars": {
        if (!isRecord(child)) {
          throw new AnsibleInventoryError(
            `malformed YAML inventory: group '${path}'.vars must be a mapping`,
          );
        }
        node.vars = { ...node.vars, ...child };
        break;
      }
      case "children": {
        if (!isRecord(child)) {
          throw new AnsibleInventoryError(
            `malformed YAML inventory: group '${path}'.children must be a mapping`,
          );
        }
        for (const [childName, childValue] of Object.entries(child)) {
          node.children.set(
            childName,
            parseYamlGroupNode(childName, childValue, `${path}.children.${childName}`),
          );
        }
        break;
      }
      default:
        throw new AnsibleInventoryError(
          `malformed YAML inventory: unknown key '${key}' in group '${path}'`,
        );
    }
  }
  return node;
}

/** Flatten a raw YAML group tree into the shared accumulator map. */
function collectYamlGroups(
  name: string,
  node: YamlGroupNode,
  groups: Map<string, GroupAccumulator>,
  hostVars: Record<string, Record<string, unknown>>,
  visiting: Set<string>,
): void {
  if (visiting.has(name)) {
    throw new AnsibleInventoryError(
      `group hierarchy cycle detected at group '${name}'`,
    );
  }
  visiting.add(name);

  const group = ensureGroup(groups, name);
  for (const host of node.hosts) group.hosts.add(host);
  Object.assign(group.vars, node.vars);
  for (const [host, vars] of Object.entries(node.hostVars)) {
    hostVars[host] = { ...(hostVars[host] ?? {}), ...vars };
  }
  for (const [childName, childNode] of node.children) {
    if (!group.children.includes(childName)) group.children.push(childName);
    collectYamlGroups(childName, childNode, groups, hostVars, visiting);
  }

  visiting.delete(name);
}

/**
 * @summary Parse Ansible YAML inventory text into RoleCall's normalized inventory.
 * Supports `all.children` / `all.vars` nesting, top-level `children:`/`vars:`/
 * `hosts:`, and per-host var maps; child groups are preserved as `children:` on
 * the parent and per-host vars become document-root `hostVars` entries.
 * @param text Raw YAML inventory text.
 * @returns The normalized inventory (group `children` preserved, per-host vars
 *   under `hostVars`).
 * @throws {AnsibleInventoryError} On malformed YAML or an unrecognized group shape.
 */
export function parseAnsibleYamlInventory(text: string): NormalizedInventory {
  let data: unknown;
  try {
    data = yamlLoad(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AnsibleInventoryError(`malformed YAML inventory: ${reason}`);
  }
  if (!isRecord(data)) {
    throw new AnsibleInventoryError(
      "malformed YAML inventory: expected a top-level mapping",
    );
  }

  const groups = new Map<string, GroupAccumulator>();
  const hostVars: Record<string, Record<string, unknown>> = {};
  const visiting = new Set<string>();

  // Ansible's canonical shape is `all:`; `children:`/`vars:`/`hosts:` at the root
  // are treated as an implicit `all`. Anything else is a top-level group map.
  if (Object.prototype.hasOwnProperty.call(data, "all")) {
    collectYamlGroups("all", parseYamlGroupNode("all", data.all, "all"), groups, hostVars, visiting);
    for (const [name, value] of Object.entries(data)) {
      if (name === "all") continue;
      collectYamlGroups(name, parseYamlGroupNode(name, value, name), groups, hostVars, visiting);
    }
  } else if (
    Object.prototype.hasOwnProperty.call(data, "children") ||
    Object.prototype.hasOwnProperty.call(data, "vars") ||
    Object.prototype.hasOwnProperty.call(data, "hosts")
  ) {
    collectYamlGroups("all", parseYamlGroupNode("all", data, "all"), groups, hostVars, visiting);
  } else {
    for (const [name, value] of Object.entries(data)) {
      collectYamlGroups(name, parseYamlGroupNode(name, value, name), groups, hostVars, visiting);
    }
  }

  return finalize(groups, hostVars);
}

// ---------------------------------------------------------------------------
// Format sniffing helpers (consumed by the loader's detection function)
// ---------------------------------------------------------------------------

/**
 * @summary True when `text` opens with an Ansible INI group header — the first
 * non-blank, non-comment line begins with `[`. Used for content sniffing so an
 * extensionless (or unusual-extension) INI inventory is still recognized.
 * @param text Raw inventory text.
 * @returns Whether the text looks like an Ansible INI inventory.
 */
export function looksLikeIniInventory(text: string): boolean {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) continue;
    return line.startsWith("[");
  }
  return false;
}

/**
 * @summary True when already-parsed YAML is Ansible's canonical root shape — a
 * mapping carrying an `all` key and no `groups` key. A `groups` root is
 * RoleCall's native schema, never Ansible.
 * @param data Parsed YAML value.
 * @returns Whether `data` is an Ansible YAML inventory root.
 */
export function isAnsibleYamlInventory(data: unknown): boolean {
  if (!isRecord(data)) return false;
  return (
    Object.prototype.hasOwnProperty.call(data, "all") &&
    !Object.prototype.hasOwnProperty.call(data, "groups")
  );
}
