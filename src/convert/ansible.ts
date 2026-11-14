// Ansible -> RoleCall mechanical converter (ADR 0024 MVP).
//
// The analyzer + rewriter run in one pass over YAML documents. Mechanical
// rewrites are applied when semantics are clear; everything else is recorded as
// a review/handoff item so a converted tree never silently changes behavior.
// Jinja never lands in a playbook scalar: expressions are wrapped in `$jinja`
// (the sole Jinja escape hatch) or translated to structured refs.

import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { dump as yamlDump, load as yamlLoad } from "js-yaml";

import { loadPlaybook } from "../config/loader";
import type { ConvertFileResult, ConvertFinding, ConvertResult } from "../cli/types";

const STRUCTURAL_KEYS = new Set([
  "name",
  "module",
  "args",
  "when",
  "loop",
  "with_items",
  "with_dict",
  "with_first_found",
  "with_together",
  "with_nested",
  "notify",
  "register",
  "delegate_to",
  "delegate_facts",
  "run_once",
  "become",
  "become_user",
  "become_method",
  "connection",
  "ignore_errors",
  "changed_when",
  "failed_when",
  "block",
  "rescue",
  "always",
  "vars",
  "environment",
  "tags",
  "until",
  "retries",
  "delay",
  "async",
  "poll",
  "loop_control",
  "check_mode",
  "local_action",
  "no_log",
  "any_errors_fatal",
  "listen",
  "include_tasks",
  "import_tasks",
  "include_role",
  "import_role",
  "include_vars",
  "import_playbook",
]);

const PLAY_KEYS = new Set([
  "name",
  "hosts",
  "vars",
  "vars_files",
  "roles",
  "tags",
  "strategy",
  "gather_facts",
  "gather_subset",
  "serial",
  "pre_tasks",
  "tasks",
  "post_tasks",
  "handlers",
  "tx",
  "checkpoint",
  "become",
  "become_user",
  "become_method",
  "connection",
  "environment",
  "run_once",
  "remote_user",
  "order",
  "ignore_errors",
  "when",
  "any_errors_fatal",
  "force_handlers",
  "max_fail_percentage",
  "vars_prompt",
]);

const MODULE_REMAP: Record<string, string> = {
  template: "copy",
  apt: "package",
  yum: "package",
  dnf: "package",
  systemd: "service",
};

const JINJA_RE = /\{\{|\}\}|\{%|%\}|\{#|#\}/;

/** Options accepted by {@link convertAnsible}. */
export interface ConvertAnsibleOptions {
  /** Output directory; required to write converted files. */
  out?: string;
  /** Handoff directory (defaults to `<out>/handoff` or `./handoff`). */
  handoff?: string;
  /** Write converted files to disk. */
  write?: boolean;
  /** Fail (exit non-zero) when any review/handoff item remains. */
  strict?: boolean;
  /** Report format hint (json|md); the CLI handles rendering. */
  report?: string;
}

interface ConvertState {
  findings: ConvertFinding[];
  blockCounter: number;
  /** Play var names collected from `vars:` so bare Ansible refs can be qualified. */
  knownVars?: Set<string>;
}

const SCALAR_MODULE_ARG: Record<string, string> = {
  shell: "command",
  command: "command",
  raw: "cmd",
  script: "src",
  apt: "name",
  yum: "name",
  dnf: "name",
  package: "name",
  systemd: "name",
  service: "name",
  user: "name",
  group: "name",
  file: "path",
};

function finding(
  state: ConvertState,
  file: string,
  path: string,
  construct: string,
  disposition: ConvertFinding["disposition"],
  message: string,
): void {
  state.findings.push({ file, path, construct, disposition, message });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasJinja(value: unknown): boolean {
  return typeof value === "string" && JINJA_RE.test(value);
}

/** Qualify bare Ansible play-var references as `vars.<name>` inside an expression. */
function qualifyVars(expr: string, names: Set<string> | undefined): string {
  if (names === undefined || names.size === 0) return expr;
  let out = "";
  let quote: "'" | "\"" | null = null;
  for (let i = 0; i < expr.length; ) {
    const ch = expr[i]!;
    if (quote !== null) {
      out += ch;
      if (ch === "\\" && i + 1 < expr.length) {
        out += expr[i + 1]!;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < expr.length && /[A-Za-z0-9_]/.test(expr[j]!)) j += 1;
      const ident = expr.slice(i, j);
      const prev = out.replace(/\s+$/, "").slice(-1);
      const next = expr.slice(j).trimStart()[0] ?? "";
      if (ident === "item" && prev !== "." && next !== "(") {
        out += "loop.item";
      } else if (names.has(ident) && prev !== "." && next !== "(" && !["and", "or", "not", "in", "is", "if", "else", "true", "false", "none"].includes(ident)) {
        out += `vars.${ident}`;
      } else {
        out += ident;
      }
      i = j;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Rewrite Ansible magic variables to RoleCall namespaces inside a Jinja expression. */
function rewriteAnsibleExpr(expr: string, knownVars?: Set<string>): { text: string; unresolved: string[] } {
  let text = expr;
  const fixes: Array<[RegExp, string]> = [
    [/ansible_facts\[['"]?([A-Za-z0-9_]+)['"]?\]/g, "facts.$1"],
    [/ansible_facts\.([A-Za-z0-9_]+)/g, "facts.$1"],
    [/\binventory_hostname\b/g, "play.host"],
    [/\bgroups\[/g, "inv.groups["],
    [/\bhostvars\[/g, "inv.hosts["],
    [/\bplaybook_dir\b/g, "run.playbook_path"],
    [/\brole_path\b/g, "role.path"],
    [/\bansible_os_family\b/g, "facts.os_family"],
    [/\bansible_architecture\b/g, "facts.arch"],
    [/\bansible_hostname\b/g, "facts.hostname"],
    [/\bansible_fqdn\b/g, "facts.hostname"],
    [/\bansible_pkg_mgr\b/g, "facts.pkg_mgr"],
    [/\bansible_service_mgr\b/g, "facts.service_mgr"],
    [/\bansible_default_ipv4\.address\b/g, "facts.default_ipv4.address"],
    [/\bansible_default_ipv4\.interface\b/g, "facts.default_ipv4.interface"],
    [/\bansible_all_ipv4_addresses\b/g, "facts.ip_addresses"],
  ];
  for (const [re, replacement] of fixes) text = text.replace(re, replacement);
  text = qualifyVars(text, knownVars);
  const unresolved: string[] = [];
  for (const m of text.matchAll(/\bansible_[A-Za-z0-9_]+/g)) unresolved.push(m[0]);
  if (/\b(?:lookup|query)\s*\(/.test(text)) unresolved.push("lookup/query");
  if (/\bomit\b/.test(text)) unresolved.push("omit");
  return { text, unresolved };
}

/** Convert one Ansible `when` guard into a RoleCall boolean/structured guard. */
function convertWhen(value: unknown, state: ConvertState, file: string, path: string): unknown {
  if (typeof value === "boolean" || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    const parts = value.map((v, i) => convertWhen(v, state, file, `${path}[${i}]`));
    return { $and: parts };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "true" || trimmed === "false") return trimmed === "true";
    const { text, unresolved } = rewriteAnsibleExpr(trimmed, state.knownVars);
    if (unresolved.length > 0) {
      finding(
        state,
        file,
        path,
        "when",
        "handoff",
        `expression references unsupported inputs (${unresolved.join(", ")}); review the generated $jinja or rewrite it as a structured predicate`,
      );
    }
    const expr = JINJA_RE.test(trimmed) ? text : `{{ ${text} }}`;
    finding(state, file, path, "when", "mapped", "wrapped in $jinja (strict Nunjucks)");
    return { $jinja: expr };
  }
  return value;
}

/** Convert one scalar/array/mapping, wrapping any Jinja string in `$jinja`. */
function convertValue(value: unknown, state: ConvertState, file: string, path: string): unknown {
  if (typeof value === "string") {
    if (!hasJinja(value)) return value;
    const { text, unresolved } = rewriteAnsibleExpr(value, state.knownVars);
    if (unresolved.length > 0) {
      finding(
        state,
        file,
        path,
        "jinja-value",
        "handoff",
        `value references unsupported inputs (${unresolved.join(", ")}); review the generated $jinja`,
      );
    }
    finding(state, file, path, "jinja-value", "mapped", "wrapped in $jinja");
    return { $jinja: text };
  }
  if (Array.isArray(value)) return value.map((v, i) => convertValue(v, state, file, `${path}[${i}]`));
  const rec = asRecord(value);
  if (rec !== undefined) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = convertValue(v, state, file, `${path}.${k}`);
    return out;
  }
  return value;
}

/** Extract `[moduleName, moduleArgs]` from an Ansible task. */
function taskModule(task: Record<string, unknown>): { module?: string; args: Record<string, unknown>; scalar?: string } {
  if (typeof task.module === "string") {
    const value = task.args;
    if (typeof value === "string") {
      const field = SCALAR_MODULE_ARG[task.module] ?? "name";
      return { module: task.module, args: { [field]: value }, scalar: task.module };
    }
    return { module: task.module, args: asRecord(value) ?? {} };
  }
  for (const [key, value] of Object.entries(task)) {
    if (STRUCTURAL_KEYS.has(key)) continue;
    if (typeof value === "string") {
      const field = SCALAR_MODULE_ARG[key] ?? "name";
      return { module: key, args: { [field]: value }, scalar: key };
    }
    return { module: key, args: asRecord(value) ?? {} };
  }
  return { args: {} };
}

/** Convert a `template` task into an RC `copy` task with a Jinja template_file. */
function convertTemplateTask(
  task: Record<string, unknown>,
  args: Record<string, unknown>,
  state: ConvertState,
  file: string,
  path: string,
): { module: string; args: Record<string, unknown> } | undefined {
  const src = typeof args.src === "string" ? args.src : undefined;
  const dest = typeof args.dest === "string" ? args.dest : undefined;
  if (src === undefined || dest === undefined) {
    finding(state, file, `${path}.template`, "template", "handoff", "template task needs static `src` and `dest`");
    return undefined;
  }
  const copyArgs: Record<string, unknown> = {
    dest,
    content: { template_file: src, engine: "jinja" },
  };
  for (const key of ["mode", "owner", "group", "backup", "validate", "force", "remote_src"]) {
    if (args[key] !== undefined) copyArgs[key] = convertValue(args[key], state, file, `${path}.${key}`);
  }
  finding(state, file, `${path}.template`, "template", "review", "mapped to copy + content.template_file (engine: jinja); verify the .j2 asset moved with the playbook");
  void task;
  return { module: "copy", args: copyArgs };
}

/** Convert one Ansible task into zero or more RoleCall tasks. */
function convertTask(
  raw: unknown,
  state: ConvertState,
  file: string,
  path: string,
  inherited: Record<string, unknown> = {},
): Record<string, unknown>[] {
  const task = asRecord(raw);
  if (task === undefined) return [];

  const block = task.block;
  if (Array.isArray(block)) {
    const tx = `rc-block-${++state.blockCounter}`;
    finding(state, file, `${path}.block`, "block", "mapped", `flattened into tx: ${tx}; review transaction boundaries`);
    if (task.rescue !== undefined) {
      finding(state, file, `${path}.rescue`, "rescue", "handoff", "rescue semantics are not mechanically equivalent to tx/checkpoint");
    }
    if (task.always !== undefined) {
      finding(state, file, `${path}.always`, "always", "handoff", "`always` has no tx/checkpoint equivalent; add an explicit final task");
    }
    const blockInherited: Record<string, unknown> = { ...inherited };
    for (const key of ["when", "become", "become_user", "tags", "environment", "connection", "run_once"]) {
      if (task[key] !== undefined) blockInherited[key] = task[key];
    }
    const out: Record<string, unknown>[] = [];
    block.forEach((child, i) => {
      for (const converted of convertTask(child, state, file, `${path}.block[${i}]`, blockInherited)) {
        out.push({ ...converted, tx: (converted.tx as string | undefined) ?? tx });
      }
    });
    return out;
  }

  if (task.include_tasks !== undefined || task.import_tasks !== undefined) {
    const value = task.include_tasks ?? task.import_tasks;
    if (typeof value === "string" && hasJinja(value)) {
      finding(state, file, path, "include_tasks", "handoff", "dynamic include paths are not load-time expandable");
      return [];
    }
    if (task.import_tasks !== undefined) {
      finding(state, file, path, "import_tasks", "mapped", "mapped to include_tasks (load-time expansion)");
    }
    const out: Record<string, unknown> = {};
    if (typeof task.name === "string") out.name = task.name;
    out.include_tasks = value;
    if (task.when !== undefined) out.when = convertWhen(task.when, state, file, `${path}.when`);
    return [out];
  }
  if (task.include_role !== undefined || task.import_role !== undefined) {
    finding(state, file, path, "include_role", "handoff", "task-level role includes have no RoleCall equivalent; add the role to the play `roles:` list");
    return [];
  }
  if (task.include_vars !== undefined) {
    finding(state, file, path, "include_vars", "handoff", "move static var files to play `vars_files:`; dynamic include_vars is unsupported");
    return [];
  }
  if (task.import_playbook !== undefined) {
    finding(state, file, path, "import_playbook", "handoff", "import_playbook must become a separate top-level playbook or an `imports:` entry");
    return [];
  }
  if (task.local_action !== undefined) {
    const la = task.local_action;
    const rec = asRecord(la);
    const laModule = rec !== undefined ? Object.keys(rec).find((k) => !STRUCTURAL_KEYS.has(k)) : undefined;
    const laArgs = rec !== undefined && laModule !== undefined ? rec[laModule] : la;
    const out: Record<string, unknown> = {};
    if (typeof task.name === "string") out.name = task.name;
    if (laModule !== undefined) out[laModule] = convertValue(laArgs, state, file, `${path}.local_action`);
    else finding(state, file, `${path}.local_action`, "local_action", "handoff", "could not identify the local_action module");
    out.delegate_to = "localhost";
    out.connection = "local";
    if (task.when !== undefined) out.when = convertWhen(task.when, state, file, `${path}.when`);
    finding(state, file, `${path}.local_action`, "local_action", "review", "mapped to delegate_to: localhost + connection: local");
    return [out];
  }

  const { module: rawModule, args: rawArgs, scalar } = taskModule(task);
  if (scalar !== undefined) {
    finding(state, file, path, scalar, "review", `scalar module argument mapped to { ${SCALAR_MODULE_ARG[scalar] ?? "name"}: ... }; verify the module accepts it`);
  }
  if (rawModule === undefined) {
    finding(state, file, path, "task", "handoff", "could not identify a module key");
    return [];
  }
  if (rawModule === "setup" || rawModule === "gather_facts") {
    finding(state, file, path, rawModule, "mapped", "dropped: RoleCall gathers facts lazily");
    return [];
  }

  let module = MODULE_REMAP[rawModule] ?? rawModule;
  let args = convertValue(rawArgs, state, file, `${path}.${rawModule}`);
  if (rawModule === "template") {
    const converted = convertTemplateTask(task, rawArgs, state, file, path);
    if (converted === undefined) return [];
    module = converted.module;
    args = converted.args;
  }
  if (rawModule !== module) {
    finding(state, file, path, rawModule, "mapped", `module renamed to ${module}`);
  }

  const out: Record<string, unknown> = {};
  if (typeof task.name === "string") out.name = task.name;
  out[module] = args;

  const taskWhen = task.when;
  const inheritedWhen = inherited.when;
  if (taskWhen !== undefined && inheritedWhen !== undefined) {
    out.when = {
      $and: [
        convertWhen(inheritedWhen, state, file, `${path}.inherited-when`),
        convertWhen(taskWhen, state, file, `${path}.when`),
      ],
    };
  } else if (taskWhen !== undefined) {
    out.when = convertWhen(taskWhen, state, file, `${path}.when`);
  } else if (inheritedWhen !== undefined) {
    out.when = convertWhen(inheritedWhen, state, file, `${path}.inherited-when`);
  }

  const withItems = task.with_items;
  if (withItems !== undefined) {
    if (Array.isArray(withItems)) {
      out.loop = withItems.map((v, i) => convertValue(v, state, file, `${path}.with_items[${i}]`));
    } else if (typeof withItems === "string" && hasJinja(withItems)) {
      const { text } = rewriteAnsibleExpr(withItems, state.knownVars);
      out.loop = { $each: { $jinja: `${text} | to_json` } };
      finding(state, file, `${path}.with_items`, "with_items", "mapped", "mapped to loop + $each/$jinja");
    } else {
      finding(state, file, `${path}.with_items`, "with_items", "review", "literal with_items converted to loop");
      out.loop = withItems;
    }
  } else if (task.loop !== undefined) {
    if (typeof task.loop === "string" && hasJinja(task.loop)) {
      const { text } = rewriteAnsibleExpr(task.loop, state.knownVars);
      out.loop = { $each: { $jinja: `${text} | to_json` } };
      finding(state, file, `${path}.loop`, "loop", "mapped", "mapped to $each/$jinja");
    } else {
      out.loop = convertValue(task.loop, state, file, `${path}.loop`);
    }
  } else if (task.with_dict !== undefined || task.with_first_found !== undefined || task.with_together !== undefined || task.with_nested !== undefined) {
    const key = task.with_dict !== undefined ? "with_dict" : task.with_first_found !== undefined ? "with_first_found" : task.with_together !== undefined ? "with_together" : "with_nested";
    finding(state, file, `${path}.${key}`, key, "handoff", "loop form has no mechanical $each equivalent");
  }

  for (const key of ["register", "delegate_to", "run_once", "become", "become_user", "no_log"]) {
    const value = task[key] ?? inherited[key];
    if (value !== undefined) out[key] = convertValue(value, state, file, `${path}.${key}`);
  }
  if (task.listen !== undefined) out.listen = convertValue(task.listen, state, file, `${path}.listen`);
  if (task.tags !== undefined) out.tags = task.tags;
  const environment = task.environment ?? inherited.environment;
  if (environment !== undefined) {
    out.environment = convertValue(environment, state, file, `${path}.environment`);
  }
  const notify = task.notify;
  if (notify !== undefined) {
    const list = Array.isArray(notify) ? notify : [notify];
    if (list.some((n) => hasJinja(n))) {
      finding(state, file, `${path}.notify`, "notify", "handoff", "dynamic handler names are not supported; make notify static");
    } else {
      out.notify = list;
    }
  }
  const connection = task.connection ?? inherited.connection;
  if (typeof connection === "string") {
    if (["ssh", "local", "network"].includes(connection)) out.connection = connection;
    else finding(state, file, `${path}.connection`, "connection", "handoff", `connection '${connection}' has no RoleCall transport`);
  }

  const delegatedKeys: Array<[string, string]> = [
    ["ignore_errors", "ignore_errors"],
    ["changed_when", "changed_when"],
    ["failed_when", "failed_when"],
    ["async", "async"],
    ["poll", "poll"],
    ["until", "until"],
    ["retries", "retries"],
    ["delay", "delay"],
    ["vars", "vars"],
    ["loop_control", "loop_control"],
    ["delegate_facts", "delegate_facts"],
    ["check_mode", "check_mode"],
    ["become_method", "become_method"],
  ];
  for (const [key, label] of delegatedKeys) {
    if (task[key] !== undefined) {
      finding(state, file, `${path}.${key}`, label, "handoff", "no native RoleCall equivalent; rewrite with tx/checkpoint, shell_register, or an idempotent module");
    }
  }

  for (const key of Object.keys(task)) {
    if (key === rawModule || STRUCTURAL_KEYS.has(key)) continue;
    finding(state, file, `${path}.${key}`, key, "handoff", "unrecognized task key; review or remove it");
  }

  return [out];
}

/** Convert one play object. */
function convertPlay(raw: unknown, state: ConvertState, file: string, path: string): Record<string, unknown> | undefined {
  const play = asRecord(raw);
  if (play === undefined) return undefined;
  const previousVars = state.knownVars;
  const vars = asRecord(play.vars);
  if (vars !== undefined) {
    state.knownVars = new Set([...(previousVars ?? []), ...Object.keys(vars)]);
  }
  const out: Record<string, unknown> = {};
  for (const key of ["name", "hosts", "vars", "vars_files", "roles", "tags", "strategy", "gather_facts", "tx", "checkpoint"]) {
    if (play[key] !== undefined) out[key] = convertValue(play[key], state, file, `${path}.${key}`);
  }
  if (play.serial !== undefined) {
    if (typeof play.serial === "number") out.serial = play.serial;
    else finding(state, file, `${path}.serial`, "serial", "handoff", "percentage/string serial values need a concrete host count");
  }
  for (const key of ["remote_user", "order", "ignore_errors", "become_method", "any_errors_fatal", "force_handlers", "max_fail_percentage", "vars_prompt", "gather_subset"]) {
    if (play[key] !== undefined) {
      finding(state, file, `${path}.${key}`, key, "handoff", "no play-level RoleCall equivalent; apply it per task or review");
    }
  }
  if (typeof play.strategy === "string" && !["linear", "free"].includes(play.strategy)) {
    finding(state, file, `${path}.strategy`, "strategy", "handoff", `strategy '${play.strategy}' is not supported (linear|free)`);
  }
  const playWhen = play.when;
  const inherited: Record<string, unknown> = {};
  for (const key of ["when", "become", "become_user", "connection", "environment", "run_once"]) {
    if (play[key] !== undefined) inherited[key] = play[key];
  }
  for (const key of ["pre_tasks", "tasks", "post_tasks"] as const) {
    const list = play[key];
    if (!Array.isArray(list)) continue;
    const converted: Record<string, unknown>[] = [];
    list.forEach((task, i) => {
      converted.push(...convertTask(task, state, file, `${path}.${key}[${i}]`, inherited));
    });
    if (converted.length > 0) out[key] = converted;
  }
  if (Array.isArray(play.handlers)) {
    const handlers: Record<string, unknown>[] = [];
    play.handlers.forEach((task, i) => {
      handlers.push(...convertTask(task, state, file, `${path}.handlers[${i}]`, inherited));
    });
    if (handlers.length > 0) out.handlers = handlers;
  }
  if (playWhen !== undefined) {
    finding(state, file, `${path}.when`, "play-when", "mapped", "applied to each task as an inherited guard");
  }
  for (const key of Object.keys(play)) {
    if (!PLAY_KEYS.has(key)) {
      finding(state, file, `${path}.${key}`, key, "handoff", "unrecognized play key; review or remove it");
    }
  }
  state.knownVars = previousVars;
  return out;
}

function convertYamlDocument(doc: unknown, state: ConvertState, file: string): { converted: unknown; kind: "playbook" | "tasks" | "other" } {
  if (Array.isArray(doc) && doc.length > 0) {
    const first = asRecord(doc[0]);
    if (first !== undefined && first.import_playbook !== undefined) {
      finding(state, file, "[0].import_playbook", "import_playbook", "handoff", "import_playbook must become a separate top-level playbook or an `imports:` entry");
      return { converted: doc, kind: "other" };
    }
    if (first !== undefined && first.hosts !== undefined) {
      const plays = doc.map((play, i) => convertPlay(play, state, file, `[${i}]`)).filter((p): p is Record<string, unknown> => p !== undefined);
      return { converted: plays, kind: "playbook" };
    }
    if (first !== undefined && (first.module !== undefined || [...Object.keys(first)].some((k) => !STRUCTURAL_KEYS.has(k)))) {
      const tasks: Record<string, unknown>[] = [];
      doc.forEach((task, i) => tasks.push(...convertTask(task, state, file, `[${i}]`)));
      return { converted: tasks, kind: "tasks" };
    }
  }
  const play = asRecord(doc);
  if (play !== undefined && play.tasks !== undefined) {
    const converted = convertPlay(play, state, file, "{play}");
    return { converted: converted ? [converted] : [], kind: "playbook" };
  }
  return { converted: doc, kind: "other" };
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git") continue;
        walk(abs);
      } else if (entry.isFile()) {
        out.push(abs);
      }
    }
  };
  walk(root);
  return out.sort();
}

/**
 * @summary Analyze and mechanically convert an Ansible file or directory into RoleCall YAML, collecting review/handoff findings for anything not safely convertible.
 * @param source Source file or directory.
 * @param options Conversion options (`out`, `handoff`, `write`, `strict`).
 * @returns Structured conversion result, including per-file findings and written paths.
 */
export function convertAnsible(source: string, options: ConvertAnsibleOptions = {}): ConvertResult {
  const sourceAbs = source;
  const isDir = statSync(sourceAbs).isDirectory();
  const outDir = options.out ?? (isDir ? join(sourceAbs, "rolecall-converted") : `${sourceAbs}.rolecall`);
  const handoffDir = options.handoff ?? join(outDir, "handoff");
  const inside = (child: string, parent: string): boolean => {
    const rel = relative(parent, child);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  };
  const files = (isDir ? walkFiles(sourceAbs) : [sourceAbs]).filter(
    (abs) => !inside(abs, outDir) && !inside(abs, handoffDir),
  );
  const state: ConvertState = { findings: [], blockCounter: 0 };
  const fileResults: ConvertFileResult[] = [];
  const written: string[] = [];

  for (const abs of files) {
    const rel = isDir ? relative(sourceAbs, abs) : abs.split(/[\\/]/).pop()!;
    const relOut = join(outDir, rel);
    const ext = abs.slice(abs.lastIndexOf(".")).toLowerCase();
    if (ext !== ".yml" && ext !== ".yaml") {
      if (options.write) {
        mkdirSync(dirname(relOut), { recursive: true });
        copyFileSync(abs, relOut);
        written.push(relOut);
      }
      fileResults.push({ source: abs, output: relOut, written: options.write === true, findings: [] });
      continue;
    }
    const text = readFileSync(abs, "utf8");
    let doc: unknown;
    try {
      doc = yamlLoad(text);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      finding(state, abs, "", "yaml", "handoff", `could not parse YAML: ${detail}`);
      fileResults.push({ source: abs, output: relOut, written: false, findings: state.findings.filter((f) => f.file === abs), error: detail });
      continue;
    }
    const findingStart = state.findings.length;
    const converted = convertYamlDocument(doc, state, abs);
    const fileFindings = state.findings.slice(findingStart);
    let outputText: string | undefined;
    if (converted.kind !== "other") {
      outputText = yamlDump(converted.converted, { lineWidth: -1, noRefs: true, sortKeys: false });
      if (options.write) {
        mkdirSync(dirname(relOut), { recursive: true });
        writeFileSync(relOut, outputText, "utf8");
        written.push(relOut);
      }
    } else if (options.write) {
      mkdirSync(dirname(relOut), { recursive: true });
      copyFileSync(abs, relOut);
      written.push(relOut);
    }
    fileResults.push({
      source: abs,
      output: relOut,
      written: options.write === true && converted.kind !== "other",
      findings: fileFindings,
    });
  }

  const review = state.findings.filter((f) => f.disposition === "review").length;
  const handoff = state.findings.filter((f) => f.disposition === "handoff").length;
  const mapped = state.findings.filter((f) => f.disposition === "mapped").length;
  const result: ConvertResult = {
    command: "convert ansible",
    source: sourceAbs,
    out: outDir,
    handoff: handoffDir,
    applied: options.write === true,
    files: fileResults,
    written,
    totals: {
      files: fileResults.length,
      mapped,
      review,
      handoff,
      findings: state.findings.length,
    },
    findings: state.findings,
  };

  if (options.write === true && result.findings.length > 0) {
    writeHandoff(result, handoffDir);
  }
  return result;
}

/** Write the deterministic review/handoff bundle (`HANDOFF.md` + `manifest.json`). */
export function writeHandoff(result: ConvertResult, handoffDir: string): void {
  mkdirSync(handoffDir, { recursive: true });
  const lines: string[] = [
    "# RoleCall conversion handoff",
    "",
    `Source: \`${result.source}\``,
    `Converted: \`${result.out}\``,
    "",
    `Mapped: ${result.totals.mapped} · Review: ${result.totals.review} · Handoff: ${result.totals.handoff}`,
    "",
    "Review and handoff items are not mechanically equivalent. Fix each one before",
    "treating the converted tree as a faithful replacement.",
    "",
  ];
  for (const item of result.findings.filter((f) => f.disposition !== "mapped")) {
    lines.push(`## ${item.disposition}: ${item.construct}`, "", `- File: \`${item.file}\``, `- Path: \`${item.path}\``, "", item.message, "");
  }
  writeFileSync(join(handoffDir, "HANDOFF.md"), lines.join("\n"), "utf8");
  writeFileSync(
    join(handoffDir, "manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        source: result.source,
        out: result.out,
        totals: result.totals,
        findings: result.findings,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

/** Validate every playbook YAML in a converted tree with the strict loader. */
export function validateConvertedTree(dir: string): { file: string; ok: boolean; error?: string }[] {
  const out: { file: string; ok: boolean; error?: string }[] = [];
  for (const abs of walkFiles(dir)) {
    if (!/\.ya?ml$/i.test(abs)) continue;
    const text = readFileSync(abs, "utf8");
    try {
      const doc = yamlLoad(text);
      if (!Array.isArray(doc)) continue;
      const first = asRecord(doc[0]);
      if (first === undefined || first.hosts === undefined) continue;
      loadPlaybook(text);
      out.push({ file: abs, ok: true });
    } catch (error) {
      out.push({ file: abs, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return out;
}
