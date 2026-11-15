// Ansible -> RoleCall mechanical converter (ADR 0024 MVP).
//
// The analyzer + rewriter run in one pass over YAML documents. Mechanical
// rewrites are applied when semantics are clear; everything else is recorded as
// a review/gap item so a converted tree never silently changes behavior.
// Jinja never lands in a playbook scalar: expressions are wrapped in `$jinja`
// (the sole Jinja escape hatch) or translated to structured refs.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { dump as yamlDump, load as yamlLoad } from "js-yaml";

import { loadPlaybook } from "../config/loader";
import { ensureProjectScaffold } from "../project/scaffold";
import { MODULE_REMAP, TASK_RULES } from "./matrix";
import { analyzeTemplate, generateEta, generateEtaDraft } from "./templates";
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

const JINJA_RE = /\{\{|\}\}|\{%|%\}|\{#|#\}/;

/** Options accepted by {@link convertAnsible}. */
export interface ConvertAnsibleOptions {
  /** Output directory; required to write converted files. */
  out?: string;
  /** Conversion gaps directory (defaults to `<out>/conversion_gaps`). */
  gaps?: string;
  /** Write converted files to disk. */
  write?: boolean;
  /** Fail (exit non-zero) when any review/gap item remains. */
  strict?: boolean;
  /** Report format hint (json|md); the CLI handles rendering. */
  report?: string;
  /** Ensure a blank RoleCall project exists at this root and convert into it. */
  project?: string;
  /** Template pass: keep Jinja (default) or analyze for ADR 0031 Eta conversion. */
  templates?: "keep" | "eta";
  /** Accept review constructs for Eta codegen (default reject). */
  templatesReview?: "accept" | "reject";
}

interface ConvertState {
  findings: ConvertFinding[];
  blockCounter: number;
  /** Play var names collected from `vars:` so bare Ansible refs can be qualified. */
  knownVars?: Set<string>;
  /** Role defaults/vars collected while expanding task-level include_role. */
  roleDefaults?: Record<string, unknown>;
  roleVars?: Record<string, unknown>;
  roleHandlers?: unknown[];
  includeStack?: string[];
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

/** Turn a dynamic Ansible name into a static, schema-valid RoleCall name. */
function staticName(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  if (!hasJinja(value)) return value;
  const stripped = value.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, "").trim();
  return stripped.length > 0 ? stripped : fallback;
}

/** Normalize Ansible's string/array tags into RoleCall's string[]. */
function normalizeTags(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

/** Normalize Ansible's yes/no/true/false into a boolean. */
function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["yes", "true", "1", "on"].includes(v)) return true;
    if (["no", "false", "0", "off"].includes(v)) return false;
  }
  return undefined;
}

function normalizeGatherFacts(value: unknown): boolean | undefined {
  return normalizeBoolean(value);
}

/** Qualify bare Ansible play-var references as `vars.<name>` inside an expression. */
function qualifyVars(expr: string, names: Set<string> | undefined): string {
  const known = names ?? new Set<string>();
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
      } else if (known.has(ident) && prev !== "." && next !== "(" && !["and", "or", "not", "in", "is", "if", "else", "true", "false", "none"].includes(ident)) {
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


/** Rewrite `name[...]` to `replacement[...]suffix`, balancing nested brackets/quotes. */
function rewriteBracketAccess(text: string, name: string, replacement: string, suffix: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf(name, i);
    if (idx === -1) {
      out += text.slice(i);
      break;
    }
    const prev = idx > 0 ? text[idx - 1]! : "";
    const after = text[idx + name.length] ?? "";
    if (/[A-Za-z0-9_]/.test(prev) || /[A-Za-z0-9_]/.test(after)) {
      out += text.slice(i, idx + name.length);
      i = idx + name.length;
      continue;
    }
    let j = idx + name.length;
    while (text[j] === " " || text[j] === "\t") j += 1;
    if (text[j] !== "[") {
      out += text.slice(i, idx + name.length);
      i = idx + name.length;
      continue;
    }
    out += text.slice(i, idx) + replacement;
    let depth = 0;
    let quote: "'" | '"' | null = null;
    for (; j < text.length; j += 1) {
      const ch = text[j]!;
      if (quote !== null) {
        if (ch === "\\") {
          j += 1;
          continue;
        }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
        continue;
      }
      if (ch === "[") depth += 1;
      else if (ch === "]") {
        depth -= 1;
        if (depth === 0) {
          j += 1;
          break;
        }
      }
    }
    out += text.slice(idx + name.length, j) + suffix;
    i = j;
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
    [/\bplaybook_dir\b/g, "run.playbook_dir"],
    [/\brole_path\b/g, "role.path"],
    [/\bansible_lsb\.major_release\b/g, "facts.distribution_major_version"],
    [/\bansible_lsb\.release\b/g, "facts.distribution_version"],
    [/\bansible_lsb\.codename\b/g, "facts.distribution_release"],
    [/\bansible_lsb\.id\b/g, "facts.distribution"],
    [/\bansible_lsb\b/g, "facts.distribution"],
    [/\bansible_domain\b/g, "facts.dns.domain"],
    [/\bansible_play_hosts\b/g, "play.hosts"],
    [/\bansible_limit\b/g, "run.limit"],
    [/\bansible_host\b/g, "inv.host_vars[play.host].rolecall_host | default(play.host)"],
    [/\bansible_ssh_pass\b/g, "inv.host_vars[play.host].rolecall_ssh_pass"],
    [/\bansible_password\b/g, "inv.host_vars[play.host].rolecall_ssh_pass"],
    [/\bansible_ssh_user\b/g, "inv.host_vars[play.host].rolecall_user"],
    [/\bansible_user\b/g, "inv.host_vars[play.host].rolecall_user"],
    [/\bansible_ssh_port\b/g, "inv.host_vars[play.host].rolecall_port"],
    [/\bansible_port\b/g, "inv.host_vars[play.host].rolecall_port"],
    [/\bansible_connection\b/g, "inv.host_vars[play.host].rolecall_connection"],
    [/\bansible_ssh_private_key_file\b/g, "inv.host_vars[play.host].rolecall_ssh_private_key_file"],
    [/\bansible_os_family\b/g, "facts.os_family"],
    [/\bansible_distribution_major_version\b/g, "facts.distribution_major_version"],
    [/\bansible_distribution_version\b/g, "facts.distribution_version"],
    [/\bansible_distribution_release\b/g, "facts.distribution_release"],
    [/\bansible_distribution\b/g, "facts.distribution"],
    [/\bansible_date_time\b/g, "facts.date_time"],
    [/\bansible_dns\b/g, "facts.dns"],
    [/\bansible_architecture\b/g, "facts.arch"],
    [/\bansible_hostname\b/g, "facts.hostname"],
    [/\bansible_fqdn\b/g, "facts.hostname"],
    [/\bansible_pkg_mgr\b/g, "facts.pkg_mgr"],
    [/\bansible_service_mgr\b/g, "facts.service_mgr"],
    [/\bansible_default_ipv4\.address\b/g, "facts.default_ipv4.address"],
    [/\bansible_default_ipv4\.interface\b/g, "facts.default_ipv4.interface"],
    [/\bansible_default_ipv4\b/g, "facts.default_ipv4"],
    [/\bansible_all_ipv4_addresses\b/g, "facts.ip_addresses"],
  ];
  for (const [re, replacement] of fixes) text = text.replace(re, replacement);
  text = rewriteBracketAccess(text, "hostvars", "inv.host_vars", "");
  text = rewriteBracketAccess(text, "groups", "inv.group_hosts", "");
  text = qualifyVars(text, knownVars);
  const unresolved: string[] = [];
  const knownUnmapped = new Set([
    "ansible_become_pass",
    "ansible_become_user",
    "ansible_python_interpreter",
    "ansible_ssh_common_args",
    "ansible_ssh_extra_args",
    "ansible_winrm_transport",
  ]);
  for (const m of text.matchAll(/\bansible_[A-Za-z0-9_]+/g)) {
    if (knownUnmapped.has(m[0])) unresolved.push(m[0]);
  }
  if (/\b(?:lookup|query)\s*\(/.test(text)) unresolved.push("lookup/query");
  if (/\bpassword_hash\b/.test(text)) unresolved.push("password_hash (not crypt(3)-compatible)");
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
        "gap",
        `expression references unsupported inputs (${unresolved.join(", ")}); review the generated $jinja or rewrite it as a structured predicate`,
      );
    }
    const expr = JINJA_RE.test(trimmed) ? text : `{{ ${text} }}`;
    finding(state, file, path, "when", "mapped", "wrapped in $jinja (strict Nunjucks)");
    return { $jinja: expr };
  }
  return value;
}

/** Convert a changed_when/failed_when predicate, mapping Ansible `result` to `reg.result`. */
function convertResultCondition(value: unknown, state: ConvertState, file: string, path: string): unknown {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const withResult = value.replace(/\bresult\b/g, "reg.result");
    const { text, unresolved } = rewriteAnsibleExpr(withResult, state.knownVars);
    if (unresolved.length > 0) {
      finding(state, file, path, "result-condition", "gap", `expression references unsupported inputs (${unresolved.join(", ")})`);
    }
    const expr = JINJA_RE.test(withResult) ? text : `{{ ${text} }}`;
    finding(state, file, path, "result-condition", "mapped", "wrapped in $jinja against reg.result");
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
        "gap",
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
    finding(state, file, `${path}.template`, "template", "gap", "template task needs static `src` and `dest`");
    return undefined;
  }
  const copyArgs: Record<string, unknown> = {
    dest: convertValue(dest, state, file, `${path}.template.dest`),
    content: { template_file: convertValue(src, state, file, `${path}.template.src`), engine: "jinja" },
  };
  for (const key of ["mode", "owner", "group", "backup", "validate", "force", "remote_src"]) {
    if (args[key] !== undefined) copyArgs[key] = convertValue(args[key], state, file, `${path}.${key}`);
  }
  finding(state, file, `${path}.template`, "template", "mapped", "mapped to copy + content.template_file");
  void task;
  return { module: "copy", args: copyArgs };
}

/** Find the nearest `roles/` directory for a playbook or role task file. */
function findRolesRoot(file: string): string | undefined {
  let dir = dirname(file);
  for (;;) {
    if (basename(dir) === "roles") return dir;
    const candidate = join(dir, "roles");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
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
      finding(state, file, `${path}.rescue`, "rescue", "gap", "rescue semantics are not mechanically equivalent to tx/checkpoint");
    }
    if (task.always !== undefined) {
      finding(state, file, `${path}.always`, "always", "gap", "`always` has no tx/checkpoint equivalent; add an explicit final task");
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

  if (task.include_role !== undefined || task.import_role !== undefined) {
    const spec = task.include_role ?? task.import_role;
    const specRec = asRecord(spec);
    const name =
      typeof spec === "string"
        ? spec
        : typeof specRec?.["name"] === "string"
          ? specRec["name"]
          : undefined;
    if (name === undefined) {
      finding(state, file, `${path}.include_role`, "include_role", "gap", "include_role needs a role name");
      return [];
    }
    const rolesRoot = findRolesRoot(file);
    const roleDir = rolesRoot === undefined ? undefined : join(rolesRoot, name);
    if (roleDir === undefined || !existsSync(roleDir)) {
      finding(state, file, `${path}.include_role`, "include_role", "gap", `could not resolve role '${name}'`);
      return [];
    }
    const stack = state.includeStack ?? [];
    if (stack.includes(roleDir)) {
      finding(state, file, `${path}.include_role`, "include_role", "gap", `cyclic include_role '${name}'`);
      return [];
    }
    state.includeStack = [...stack, roleDir];
    try {
      const defaultsFrom = typeof specRec?.["defaults_from"] === "string" ? specRec["defaults_from"] : "main.yml";
      const varsFrom = typeof specRec?.["vars_from"] === "string" ? specRec["vars_from"] : "main.yml";
      const tasksFrom = typeof specRec?.["tasks_from"] === "string" ? specRec["tasks_from"] : "main.yml";
      const defaultsFile = join(roleDir, "defaults", defaultsFrom);
      const varsFile = join(roleDir, "vars", varsFrom);
      const loadMap = (target: string): Record<string, unknown> | undefined => {
        try {
          return asRecord(convertValue(yamlLoad(readFileSync(target, "utf8")), state, target, `${path}.include_role`));
        } catch (error) {
          finding(state, file, `${path}.include_role`, "include_role", "gap", `could not parse ${target}: ${error instanceof Error ? error.message : String(error)}`);
          return undefined;
        }
      };
      if (existsSync(defaultsFile)) {
        const defaults = loadMap(defaultsFile);
        if (defaults !== undefined) {
          state.roleDefaults = { ...(state.roleDefaults ?? {}), ...defaults };
          for (const key of Object.keys(defaults)) state.knownVars!.add(key);
        }
      }
      if (existsSync(varsFile)) {
        const vars = loadMap(varsFile);
        if (vars !== undefined) {
          state.roleVars = { ...(state.roleVars ?? {}), ...vars };
          for (const key of Object.keys(vars)) state.knownVars!.add(key);
        }
      }
      const tasksFile = join(roleDir, "tasks", tasksFrom);
      if (!existsSync(tasksFile)) {
        finding(state, file, `${path}.include_role`, "include_role", "gap", `role '${name}' has no tasks/${tasksFrom}`);
        return [];
      }
      let doc: unknown;
      try {
        doc = yamlLoad(readFileSync(tasksFile, "utf8"));
      } catch (error) {
        finding(state, file, `${path}.include_role`, "include_role", "gap", `could not parse ${tasksFile}: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
      if (!Array.isArray(doc)) {
        finding(state, file, `${path}.include_role`, "include_role", "gap", `role '${name}' tasks file is not a list`);
        return [];
      }
      const inherited: Record<string, unknown> = {};
      for (const key of ["when", "tags", "become", "become_user", "environment", "run_once", "ignore_errors", "connection"]) {
        if (task[key] !== undefined) inherited[key] = task[key];
      }
      const converted: Record<string, unknown>[] = [];
      doc.forEach((child, i) => {
        converted.push(...convertTask(child, state, tasksFile, `${path}.include_role[${i}]`, inherited));
      });
      const handlersFile = join(roleDir, "handlers", "main.yml");
      if (existsSync(handlersFile)) {
        let handlers: unknown;
        try {
          handlers = yamlLoad(readFileSync(handlersFile, "utf8"));
        } catch (error) {
          finding(state, file, `${path}.include_role`, "include_role", "gap", `could not parse ${handlersFile}: ${error instanceof Error ? error.message : String(error)}`);
          handlers = undefined;
        }
        if (Array.isArray(handlers)) {
          handlers.forEach((handler, i) => {
            state.roleHandlers!.push(...convertTask(handler, state, handlersFile, `${path}.include_role.handlers[${i}]`, inherited));
          });
        }
      }
      const unsupported = Object.keys(specRec ?? {}).filter(
        (key) => !["name", "tasks_from", "vars_from", "defaults_from"].includes(key),
      );
      if (unsupported.length > 0) {
        finding(state, file, `${path}.include_role`, "include_role", "review", `role options (${unsupported.join(", ")}) are not inlined`);
      }
      finding(state, file, `${path}.include_role`, "include_role", "mapped", `inlined role '${name}' tasks, defaults/vars, and handlers`);
      return converted;
    } finally {
      state.includeStack = stack;
    }
  }
  if (task.include_tasks !== undefined || task.import_tasks !== undefined) {
    const value = task.include_tasks ?? task.import_tasks;
    if (typeof value === "string" && hasJinja(value)) {
      finding(state, file, path, "include_tasks", "gap", "dynamic include paths are not load-time expandable");
      return [];
    }
    if (task.import_tasks !== undefined) {
      finding(state, file, path, "import_tasks", "mapped", "mapped to include_tasks (load-time expansion)");
    }
    const out: Record<string, unknown> = {};
    out.name = staticName(task.name, "include_tasks");
    out.include_tasks = value;
    if (task.when !== undefined) out.when = convertWhen(task.when, state, file, `${path}.when`);
    return [out];
  }
  if (task.include_vars !== undefined) {
    finding(state, file, path, "include_vars", "gap", "move static var files to play `vars_files:`; dynamic include_vars is unsupported");
    return [];
  }
  if (task.import_playbook !== undefined) {
    finding(state, file, path, "import_playbook", "gap", "import_playbook must become a separate top-level playbook or an `imports:` entry");
    return [];
  }
  if (task.local_action !== undefined) {
    const la = task.local_action;
    const rec = asRecord(la);
    let laModule: string | undefined;
    let laArgs: unknown = la;
    if (typeof la === "string") {
      const [moduleName, ...rest] = la.trim().split(/\s+/);
      laModule = moduleName;
      if (moduleName !== undefined) {
        laArgs = { [SCALAR_MODULE_ARG[moduleName] ?? "name"]: rest.join(" ") };
      }
    } else if (rec !== undefined) {
      laModule = Object.keys(rec).find((k) => !STRUCTURAL_KEYS.has(k));
      laArgs = laModule === undefined ? la : rec[laModule];
    }
    const out: Record<string, unknown> = {};
    out.name = staticName(task.name, laModule ?? "local_action");
    if (laModule !== undefined) out[laModule] = convertValue(laArgs, state, file, `${path}.local_action`);
    else finding(state, file, `${path}.local_action`, "local_action", "gap", "could not identify the local_action module");
    out.delegate_to = "localhost";
    out.connection = "local";
    if (task.when !== undefined) out.when = convertWhen(task.when, state, file, `${path}.when`);
    finding(state, file, `${path}.local_action`, "local_action", "review", "mapped to delegate_to: localhost + connection: local");
    return [out];
  }

  const { module: rawModule, args: rawArgs, scalar } = taskModule(task);
  if (scalar !== undefined) {
    finding(state, file, path, scalar, "mapped", `scalar module argument mapped to { ${SCALAR_MODULE_ARG[scalar] ?? "name"}: ... }`);
  }
  if (rawModule === undefined) {
    finding(state, file, path, "task", "gap", "could not identify a module key");
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
  if (rawModule === "authorized_key") {
    const a = asRecord(args) ?? {};
    const user = typeof a["user"] === "string" ? a["user"] : "root";
    const key = a["key"];
    const path =
      typeof a["path"] === "string"
        ? a["path"]
        : user === "root"
          ? "/root/.ssh/authorized_keys"
          : `/home/${user}/.ssh/authorized_keys`;
    if (key === undefined) {
      finding(state, file, path, "authorized_key", "gap", "authorized_key needs a static key");
      return [];
    }
    module = "lineinfile";
    args = {
      path,
      line: key,
      create: true,
      mode: "0600",
      owner: user,
      group: user,
      state: a["state"] === "absent" ? "absent" : "present",
    };
    finding(state, file, path, "authorized_key", "review", "mapped to lineinfile; verify the target user's home path");
  }
  if (rawModule !== module) {
    finding(state, file, path, rawModule, "mapped", `module renamed to ${module}`);
  }

  const out: Record<string, unknown> = {};
  const rawName = typeof task.name === "string" ? task.name : undefined;
  out.name = staticName(rawName, `${module} task`);
  if (rawName !== undefined && hasJinja(rawName)) {
    finding(state, file, `${path}.name`, "name", "review", "dynamic task name sanitized for schema validity");
  }
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
  } else if (task.with_dict !== undefined) {
    const value = task.with_dict;
    if (typeof value === "string" && hasJinja(value)) {
      const { text } = rewriteAnsibleExpr(value, state.knownVars);
      out.loop = { $each: { $jinja: `${text} | dict2items | to_json` } };
      finding(state, file, `${path}.with_dict`, "with_dict", "mapped", "mapped to $each + dict2items");
    } else {
      const rec = asRecord(value);
      if (rec !== undefined) {
        out.loop = Object.entries(rec).map(([key, val]) => ({
          key,
          value: convertValue(val, state, file, `${path}.with_dict.${key}`),
        }));
        finding(state, file, `${path}.with_dict`, "with_dict", "mapped", "literal dict mapped to key/value loop items");
      } else {
        finding(state, file, `${path}.with_dict`, "with_dict", "gap", "with_dict form has no mechanical $each equivalent");
      }
    }
  } else if (task.with_together !== undefined || task.with_nested !== undefined) {
    const key = task.with_together !== undefined ? "with_together" : "with_nested";
    const filter = key === "with_together" ? "zip" : "product";
    const value = task[key];
    if (!Array.isArray(value) || value.length === 0) {
      finding(state, file, `${path}.${key}`, key, "gap", "loop form needs a literal list of operands");
    } else {
      const operands = value.map((entry) => {
        if (typeof entry === "string" && hasJinja(entry)) {
          const { text } = rewriteAnsibleExpr(entry, state.knownVars);
          const match = text.match(/^\s*\{\{([\s\S]*)\}\}\s*$/);
          return match?.[1]?.trim();
        }
        if (typeof entry === "string") return qualifyVars(entry, state.knownVars);
        if (Array.isArray(entry) || typeof entry === "object") return JSON.stringify(entry);
        return JSON.stringify(entry);
      });
      if (operands.some((operand) => operand === undefined)) {
        finding(state, file, `${path}.${key}`, key, "gap", "could not build a mechanical zip/product expression");
      } else {
        out.loop = { $each: { $jinja: `{{ ${operands[0]} | ${filter}(${operands.slice(1).join(", ")}) | to_json }}` } };
        finding(state, file, `${path}.${key}`, key, "mapped", `mapped to $each + ${filter}`);
      }
    }
  } else if (task.with_first_found !== undefined) {
    const list = task.with_first_found;
    if (
      (rawModule === "copy" || rawModule === "template") &&
      Array.isArray(list) &&
      list.length > 0 &&
      list.every((entry) => typeof entry === "string")
    ) {
      const converted = list.map((entry, i) =>
        convertValue(entry, state, file, `${path}.with_first_found[${i}]`),
      );
      if (rawModule === "template") {
        const content = asRecord((args as Record<string, unknown>)["content"]);
        if (content !== undefined) {
          content["template_file"] = converted;
          finding(state, file, `${path}.with_first_found`, "with_first_found", "mapped", "mapped to copy template_file candidates");
        } else {
          finding(state, file, `${path}.with_first_found`, "with_first_found", "gap", "template conversion did not produce a content spec");
        }
      } else {
        (args as Record<string, unknown>)["src"] = converted;
        finding(state, file, `${path}.with_first_found`, "with_first_found", "mapped", "mapped to copy src candidates");
      }
    } else {
      finding(state, file, `${path}.with_first_found`, "with_first_found", "gap", "with_first_found is only mechanical for static copy/template candidates");
    }
  }

  for (const key of ["run_once", "become", "no_log"]) {
    const value = task[key] ?? inherited[key];
    if (value === undefined) continue;
    const normalized = normalizeBoolean(value);
    if (normalized === undefined) {
      finding(state, file, `${path}.${key}`, key, "gap", `unsupported ${key} value; review it`);
    } else {
      out[key] = normalized;
    }
  }
  if (task.become_user !== undefined || inherited.become_user !== undefined) {
    const value = task.become_user ?? inherited.become_user;
    if (typeof value === "string") out.become_user = value;
    else finding(state, file, `${path}.become_user`, "become_user", "gap", "dynamic become_user is unsupported");
  }
  for (const key of ["register", "delegate_to"]) {
    const value = task[key] ?? inherited[key];
    if (value === undefined) continue;
    if (typeof value === "string" && !hasJinja(value)) out[key] = value;
    else finding(state, file, `${path}.${key}`, key, "gap", `dynamic ${key} has no RoleCall equivalent; review it`);
  }
  if (task.listen !== undefined) out.listen = convertValue(task.listen, state, file, `${path}.listen`);
  const tags = normalizeTags(task.tags ?? inherited.tags);
  if (tags !== undefined) out.tags = tags;
  const environment = task.environment ?? inherited.environment;
  if (environment !== undefined) {
    out.environment = convertValue(environment, state, file, `${path}.environment`);
  }
  const notify = task.notify;
  if (notify !== undefined) {
    const list = Array.isArray(notify) ? notify : [notify];
    if (list.some((n) => hasJinja(n))) {
      finding(state, file, `${path}.notify`, "notify", "gap", "dynamic handler names are not supported; make notify static");
    } else {
      out.notify = list;
    }
  }
  const connection = task.connection ?? inherited.connection;
  if (typeof connection === "string") {
    if (["ssh", "local", "network"].includes(connection)) out.connection = connection;
    else finding(state, file, `${path}.connection`, "connection", "gap", `connection '${connection}' has no RoleCall transport`);
  }

  if (task.ignore_errors !== undefined || inherited.ignore_errors !== undefined) {
    const raw = task.ignore_errors ?? inherited.ignore_errors;
    const value = normalizeBoolean(raw);
    if (value === undefined) {
      finding(state, file, `${path}.ignore_errors`, "ignore_errors", "gap", "unsupported ignore_errors value; review it");
    } else {
      out.ignore_errors = value;
      finding(state, file, `${path}.ignore_errors`, "ignore_errors", "mapped", "mapped to the native ignore_errors task field");
    }
  }

  for (const key of ["changed_when", "failed_when"] as const) {
    if (task[key] !== undefined) {
      out[key] = convertResultCondition(task[key], state, file, `${path}.${key}`);
    }
  }
  if (task.retries !== undefined) {
    const retries = Number(task.retries);
    if (Number.isInteger(retries) && retries >= 0) out.retries = retries;
    else finding(state, file, `${path}.retries`, "retries", "gap", "retries must be a non-negative integer");
  }
  if (task.delay !== undefined) {
    const delay = Number(task.delay);
    if (Number.isFinite(delay) && delay >= 0) out.delay = delay;
    else finding(state, file, `${path}.delay`, "delay", "gap", "delay must be a non-negative number");
  }
  if (task.until !== undefined) {
    out.until = convertResultCondition(task.until, state, file, `${path}.until`);
  }

  for (const rule of Object.values(TASK_RULES)) {
    if (task[rule.id] !== undefined) {
      finding(state, file, `${path}.${rule.id}`, rule.id, rule.disposition, rule.message);
    }
  }

  for (const key of Object.keys(task)) {
    if (key === rawModule || STRUCTURAL_KEYS.has(key)) continue;
    finding(state, file, `${path}.${key}`, key, "gap", "unrecognized task key; review or remove it");
  }

  return [out];
}


/** Pull static top-level `include_vars` tasks into `vars_files`; leave the rest. */
function extractStaticIncludeVars(
  tasks: unknown[],
  state: ConvertState,
  file: string,
  path: string,
): { tasks: unknown[]; files: string[] } {
  const kept: unknown[] = [];
  const files: string[] = [];
  tasks.forEach((raw, i) => {
    const task = asRecord(raw);
    if (task === undefined || task.include_vars === undefined) {
      kept.push(raw);
      return;
    }
    if (task.when !== undefined || task.name === undefined || task.include_vars === null) {
      kept.push(raw);
      return;
    }
    const spec = task.include_vars;
    const rec = asRecord(spec);
    if (rec !== undefined && rec["name"] !== undefined) {
      kept.push(raw);
      return;
    }
    const rawFiles = rec !== undefined ? rec["file"] ?? rec["_raw_params"] : spec;
    const list = Array.isArray(rawFiles) ? rawFiles : [rawFiles];
    if (list.some((entry) => typeof entry !== "string" || hasJinja(entry))) {
      kept.push(raw);
      return;
    }
    files.push(...(list as string[]));
    finding(
      state,
      file,
      `${path}[${i}].include_vars`,
      "include_vars",
      "review",
      "moved to play vars_files; the variables become available earlier than the original task position",
    );
  });
  return { tasks: kept, files };
}

/** Convert one play object. */
function convertPlay(raw: unknown, state: ConvertState, file: string, path: string): Record<string, unknown> | undefined {
  const play = asRecord(raw);
  if (play === undefined) return undefined;
  const previousVars = state.knownVars;
  state.roleDefaults = {};
  state.roleVars = {};
  state.roleHandlers = [];
  const vars = asRecord(play.vars);
  if (vars !== undefined) {
    state.knownVars = new Set([...(previousVars ?? []), ...Object.keys(vars)]);
  }
  if (play.vars_files !== undefined) {
    for (const entry of Array.isArray(play.vars_files) ? play.vars_files : [play.vars_files]) {
      const ref = Array.isArray(entry) ? entry[0] : entry;
      if (typeof ref !== "string" || hasJinja(ref)) continue;
      for (const candidate of [join(dirname(file), ref), join(dirname(file), "vars", ref)]) {
        if (!existsSync(candidate)) continue;
        try {
          const doc = asRecord(yamlLoad(readFileSync(candidate, "utf8")));
          if (doc !== undefined) for (const key of Object.keys(doc)) state.knownVars!.add(key);
        } catch {
          /* parse errors are reported when the file is converted */
        }
        break;
      }
    }
  }
  const out: Record<string, unknown> = {};
  if (play.name !== undefined) {
    out.name = staticName(play.name, "play");
    if (hasJinja(play.name)) finding(state, file, `${path}.name`, "name", "review", "dynamic play name sanitized for schema validity");
  }
  for (const key of ["hosts", "vars", "roles", "strategy", "tx", "checkpoint"]) {
    if (play[key] !== undefined) out[key] = convertValue(play[key], state, file, `${path}.${key}`);
  }
  if (play.gather_facts !== undefined) {
    const gather = normalizeGatherFacts(play.gather_facts);
    if (gather === undefined) finding(state, file, `${path}.gather_facts`, "gather_facts", "gap", "unsupported gather_facts value; review it");
    else out.gather_facts = gather;
  }
  const playTags = normalizeTags(play.tags);
  if (playTags !== undefined) out.tags = playTags;
  if (play.vars_files !== undefined) {
    const files: string[] = [];
    for (const entry of Array.isArray(play.vars_files) ? play.vars_files : [play.vars_files]) {
      if (typeof entry === "string" && !hasJinja(entry)) files.push(entry);
      else if (Array.isArray(entry) && typeof entry[0] === "string" && !hasJinja(entry[0])) {
        files.push(entry[0]);
        finding(state, file, `${path}.vars_files`, "vars_files", "review", "first-found vars_files entry flattened to its first candidate");
      } else {
        finding(state, file, `${path}.vars_files`, "vars_files", "gap", "dynamic vars_files entry dropped; review it");
      }
    }
    if (files.length > 0) out.vars_files = files;
  }
  if (play.serial !== undefined) {
    if (typeof play.serial === "number") out.serial = play.serial;
    else if (typeof play.serial === "string" && /^\d+%$/.test(play.serial)) {
      out.serial = play.serial;
      finding(state, file, `${path}.serial`, "serial", "mapped", "percentage serial is supported natively");
    } else {
      finding(state, file, `${path}.serial`, "serial", "gap", "unsupported serial value; use a number or an integer percentage");
    }
  }
  for (const key of ["become_method", "any_errors_fatal", "force_handlers", "max_fail_percentage", "vars_prompt", "gather_subset"]) {
    if (play[key] !== undefined) {
      finding(state, file, `${path}.${key}`, key, "gap", "no play-level RoleCall equivalent; apply it per task or review");
    }
  }
  if (play.remote_user !== undefined) {
    if (typeof play.remote_user === "string" && !hasJinja(play.remote_user)) {
      out.remote_user = play.remote_user;
      finding(state, file, `${path}.remote_user`, "remote_user", "mapped", "applied to the play connection user");
    } else {
      finding(state, file, `${path}.remote_user`, "remote_user", "gap", "dynamic remote_user is unsupported");
    }
  }
  if (typeof play.strategy === "string" && !["linear", "free"].includes(play.strategy)) {
    finding(state, file, `${path}.strategy`, "strategy", "gap", `strategy '${play.strategy}' is not supported (linear|free)`);
  }
  if (play.order !== undefined) {
    if (["inventory", "sorted", "reverse_sorted", "reverse_inventory", "shuffle"].includes(String(play.order))) {
      out.order = play.order;
      finding(state, file, `${path}.order`, "order", "mapped", "host ordering is supported natively");
    } else {
      finding(state, file, `${path}.order`, "order", "gap", `order '${String(play.order)}' is not supported`);
    }
  }
  const playWhen = play.when;
  const inherited: Record<string, unknown> = {};
  for (const key of ["when", "become", "become_user", "connection", "environment", "run_once", "ignore_errors"]) {
    if (play[key] !== undefined) inherited[key] = play[key];
  }
  const includeVarsFiles: string[] = [];
  for (const key of ["pre_tasks", "tasks", "post_tasks"] as const) {
    const list = play[key];
    if (!Array.isArray(list)) continue;
    const extracted = extractStaticIncludeVars(list, state, file, `${path}.${key}`);
    includeVarsFiles.push(...extracted.files);
    const converted: Record<string, unknown>[] = [];
    extracted.tasks.forEach((task, i) => {
      converted.push(...convertTask(task, state, file, `${path}.${key}[${i}]`, inherited));
    });
    if (converted.length > 0) out[key] = converted;
  }
  if (includeVarsFiles.length > 0) {
    const existing = out.vars_files;
    const existingList = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing];
    out.vars_files = [...existingList, ...includeVarsFiles];
  }
  if (Array.isArray(play.handlers)) {
    const handlers: Record<string, unknown>[] = [];
    play.handlers.forEach((task, i) => {
      handlers.push(...convertTask(task, state, file, `${path}.handlers[${i}]`, inherited));
    });
    if (handlers.length > 0) out.handlers = handlers;
  }
  if (Object.keys(state.roleDefaults ?? {}).length > 0 || Object.keys(state.roleVars ?? {}).length > 0) {
    const playVars = asRecord(out.vars) ?? {};
    out.vars = { ...(state.roleDefaults ?? {}), ...playVars, ...(state.roleVars ?? {}) };
    finding(state, file, `${path}.vars`, "include_role", "review", "inlined role defaults/vars merged into play vars; verify precedence");
  }
  if ((state.roleHandlers ?? []).length > 0) {
    const handlers = [...(Array.isArray(out.handlers) ? out.handlers : [])];
    const seen = new Set(handlers.map((handler) => asRecord(handler)?.["name"]).filter((name): name is string => typeof name === "string"));
    for (const handler of state.roleHandlers ?? []) {
      const name = asRecord(handler)?.["name"];
      if (typeof name === "string" && seen.has(name)) {
        finding(state, file, `${path}.handlers`, "include_role", "review", `duplicate handler '${name}' skipped`);
        continue;
      }
      if (typeof name === "string") seen.add(name);
      handlers.push(handler);
    }
    out.handlers = handlers;
  }
  if (out.tasks === undefined) out.tasks = [];
  if (playWhen !== undefined) {
    finding(state, file, `${path}.when`, "play-when", "mapped", "applied to each task as an inherited guard");
  }
  for (const key of Object.keys(play)) {
    if (!PLAY_KEYS.has(key)) {
      finding(state, file, `${path}.${key}`, key, "gap", "unrecognized play key; review or remove it");
    }
  }
  state.knownVars = previousVars;
  return out;
}

function convertYamlDocument(
  doc: unknown,
  state: ConvertState,
  file: string,
  seen: Set<string> = new Set(),
): { converted: unknown; kind: "playbook" | "tasks" | "other" } {
  if (Array.isArray(doc) && doc.length > 0) {
    const first = asRecord(doc[0]);
    if (doc.some((entry) => asRecord(entry)?.import_playbook !== undefined)) {
      const plays: unknown[] = [];
      doc.forEach((entry, index) => {
        const rec = asRecord(entry);
        if (rec?.import_playbook === undefined) {
          const converted = convertPlay(entry, state, file, `[${index}]`);
          if (converted !== undefined) plays.push(converted);
          return;
        }
        const ref = String(rec.import_playbook);
        if (hasJinja(ref)) {
          finding(state, file, `[${index}].import_playbook`, "import_playbook", "gap", "dynamic import_playbook paths are not load-time expandable");
          return;
        }
        const target = isAbsolute(ref) ? ref : join(dirname(file), ref);
        if (seen.has(target) || !existsSync(target)) {
          finding(state, file, `[${index}].import_playbook`, "import_playbook", "gap", `could not expand import_playbook '${ref}' (missing or cyclic)`);
          return;
        }
        seen.add(target);
        try {
          const imported = convertYamlDocument(yamlLoad(readFileSync(target, "utf8")), state, target, seen);
          if (imported.kind === "playbook" && Array.isArray(imported.converted)) {
            plays.push(...imported.converted);
            finding(state, file, `[${index}].import_playbook`, "import_playbook", "mapped", `inlined plays from ${ref}`);
          } else {
            finding(state, file, `[${index}].import_playbook`, "import_playbook", "gap", `imported file '${ref}' is not a playbook`);
          }
        } catch (error) {
          finding(state, file, `[${index}].import_playbook`, "import_playbook", "gap", `could not parse imported file '${ref}': ${error instanceof Error ? error.message : String(error)}`);
        }
      });
      return { converted: plays, kind: "playbook" };
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


/** True for Ansible var files whose mappings should be converted in place. */
function isVarFile(rel: string): boolean {
  return (
    /(^|[\\/])(group_vars|host_vars)[\\/]/.test(rel) ||
    /(^|[\\/])roles[\\/][^\\/]+[\\/](defaults|vars)[\\/]/.test(rel)
  );
}


/** Rewrite `copy.content.template_file` references to converted `.eta` assets. */
function rewriteTemplateRefs(
  value: unknown,
  exact: Map<string, string>,
  base: Map<string, string>,
  state: ConvertState,
  file: string,
): void {
  if (Array.isArray(value)) {
    for (const entry of value) rewriteTemplateRefs(entry, exact, base, state, file);
    return;
  }
  const rec = asRecord(value);
  if (rec === undefined) return;
  const copy = asRecord(rec["copy"]);
  if (copy !== undefined) {
    const content = asRecord(copy["content"]);
    if (content !== undefined) {
      const ref = content["template_file"];
      const resolve = (entry: string): string | undefined => exact.get(entry) ?? base.get(basename(entry));
      if (typeof ref === "string") {
        const eta = resolve(ref);
        if (eta !== undefined) {
          content["template_file"] = exact.get(ref) ?? basename(eta);
          content["engine"] = "eta";
        }
      } else if (Array.isArray(ref)) {
        const mapped = ref.map((entry) => (typeof entry === "string" ? resolve(entry) : undefined));
        const any = mapped.some((entry) => entry !== undefined);
        const all = mapped.every((entry) => entry !== undefined);
        if (any && !all) {
          finding(
            state,
            file,
            "copy.content.template_file",
            "template",
            "review",
            "mixed .j2/.eta candidates cannot share one engine; task kept as Jinja",
          );
        } else if (all) {
          content["template_file"] = ref.map((entry, index) =>
            exact.get(String(entry)) ?? basename(mapped[index]!),
          );
          content["engine"] = "eta";
        }
      }
    }
  }
  for (const [key, child] of Object.entries(rec)) {
    if (key === "copy") continue;
    rewriteTemplateRefs(child, exact, base, state, file);
  }
}


/** Ansible inventory connection vars rewritten to RoleCall names. */
const CONNECTION_VAR_MAP: Record<string, string> = {
  ansible_host: "rolecall_host",
  ansible_user: "rolecall_user",
  ansible_ssh_user: "rolecall_user",
  ansible_port: "rolecall_port",
  ansible_ssh_port: "rolecall_port",
  ansible_connection: "rolecall_connection",
  ansible_ssh_private_key_file: "rolecall_ssh_private_key_file",
  ansible_ssh_pass: "rolecall_ssh_pass",
  ansible_password: "rolecall_ssh_pass",
};

const CONNECTION_VALUE_MAP: Record<string, string> = {
  ssh: "ssh",
  local: "local",
  network: "network",
  network_cli: "network",
  netconf: "network",
};

function isAnsibleYamlInventory(doc: unknown): boolean {
  const rec = asRecord(doc);
  if (rec === undefined || rec["all"] === undefined) return false;
  const all = asRecord(rec["all"]);
  return all !== undefined && (all["hosts"] !== undefined || all["children"] !== undefined || all["vars"] !== undefined);
}

/** Rewrite known Ansible connection vars anywhere in a YAML inventory tree. */
function convertInventoryValue(value: unknown, state: ConvertState, file: string, path: string): unknown {
  if (Array.isArray(value)) return value.map((entry, i) => convertInventoryValue(entry, state, file, `${path}[${i}]`));
  const rec = asRecord(value);
  if (rec === undefined) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(rec)) {
    const mapped = CONNECTION_VAR_MAP[key];
    if (mapped !== undefined) {
      if (key === "ansible_connection" && typeof child === "string") {
        const value = CONNECTION_VALUE_MAP[child];
        if (value === undefined) {
          finding(state, file, `${path}.${key}`, key, "gap", `connection '${child}' has no RoleCall transport`);
          out[key] = child;
          continue;
        }
        out[mapped] = value;
      } else {
        out[mapped] = convertValue(child, state, file, `${path}.${key}`);
      }
      finding(state, file, `${path}.${key}`, key, "mapped", `rewritten to ${mapped}`);
      continue;
    }
    if (key.startsWith("ansible_")) {
      finding(state, file, `${path}.${key}`, key, "review", "Ansible inventory variable is not rewritten; review it");
    }
    out[key] = convertInventoryValue(child, state, file, `${path}.${key}`);
  }
  return out;
}

/** Rewrite `ansible_*` connection keys in an Ansible INI inventory. */
function convertInventoryIni(text: string, state: ConvertState, file: string): string {
  let changed = false;
  const rewrite = (key: string, value: string): { key: string; value: string } | undefined => {
    const mapped = CONNECTION_VAR_MAP[key];
    if (mapped === undefined) {
      if (key.startsWith("ansible_")) {
        finding(state, file, key, key, "review", "Ansible inventory variable is not rewritten; review it");
      }
      return undefined;
    }
    if (key === "ansible_connection" && !Object.prototype.hasOwnProperty.call(CONNECTION_VALUE_MAP, value.trim())) {
      finding(state, file, key, key, "gap", `connection '${value.trim()}' has no RoleCall transport`);
      return undefined;
    }
    finding(state, file, key, key, "mapped", `rewritten to ${mapped}`);
    changed = true;
    return { key: mapped, value: key === "ansible_connection" ? CONNECTION_VALUE_MAP[value.trim()]! : value };
  };

  const out = text
    .split(/\r?\n/)
    .map((line) => {
      // Whole-line `key = value` (group:vars sections).
      const match = line.match(/^(\s*)([A-Za-z0-9_]+)(\s*=\s*)(.*)$/);
      if (match !== null) {
        const [, indent, key, eq, value] = match;
        const next = rewrite(key!, value!);
        if (next !== undefined) return `${indent}${next.key}${eq}${next.value}`;
        return line;
      }
      // Inline host vars: `host ansible_host=... ansible_user=...`.
      return line.replace(
        /(^|\s)(ansible_[A-Za-z0-9_]+)=(\S+)/g,
        (whole, prefix: string, key: string, value: string) => {
          const next = rewrite(key, value);
          return next === undefined ? whole : `${prefix}${next.key}=${next.value}`;
        },
      );
    })
    .join("\n");
  return changed ? out : text;
}

/**
 * @summary Analyze and mechanically convert an Ansible file or directory into RoleCall YAML, collecting review/gap findings for anything not safely convertible.
 * @param source Source file or directory.
 * @param options Conversion options (`out`, `gaps`, `write`, `strict`).
 * @returns Structured conversion result, including per-file findings and written paths.
 */
export function convertAnsible(source: string, options: ConvertAnsibleOptions = {}): ConvertResult {
  const sourceAbs = source;
  const isDir = statSync(sourceAbs).isDirectory();
  const project = options.project === undefined ? undefined : ensureProjectScaffold(options.project);
  const outDir =
    options.out ??
    project?.root ??
    (isDir ? join(sourceAbs, "rolecall-converted") : `${sourceAbs}.rolecall`);
  const gapsDir = options.gaps ?? join(outDir, "conversion_gaps");
  const inside = (child: string, parent: string): boolean => {
    const rel = relative(parent, child);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  };
  const files = (isDir ? walkFiles(sourceAbs) : [sourceAbs]).filter(
    (abs) => !inside(abs, outDir) && !inside(abs, gapsDir),
  );
  const state: ConvertState = { findings: [], blockCounter: 0, knownVars: new Set<string>() };
  // Collect var names across every Ansible var file so bare refs in one file can
  // be qualified as `vars.<name>` even when they are declared in another file.
  if (isDir) {
    for (const abs of files) {
      const rel = relative(sourceAbs, abs);
      if (!isVarFile(rel)) continue;
      try {
        const rec = asRecord(yamlLoad(readFileSync(abs, "utf8")));
        if (rec !== undefined) for (const key of Object.keys(rec)) state.knownVars!.add(key);
      } catch {
        /* parse errors are reported in the main loop */
      }
    }
  }
  const fileResults: ConvertFileResult[] = [];
  const written: string[] = [];
  const templateExact = new Map<string, string>();
  const templateBase = new Map<string, string>();
  const preprocessed = new Set<string>();
  let draftIndex = 0;

  if (options.templates === "eta") {
    for (const abs of files) {
      const ext = abs.slice(abs.lastIndexOf(".")).toLowerCase();
      if (ext !== ".j2" && ext !== ".jinja") continue;
      const rel = isDir ? relative(sourceAbs, abs) : abs.split(/[\\/]/).pop()!;
      const relOut = join(outDir, rel);
      const findingStart = state.findings.length;
      const text = readFileSync(abs, "utf8");
      const analysis = analyzeTemplate(text, abs);
      state.findings.push(...analysis.findings);
      const acceptReview = options.templatesReview === "accept";
      const generation =
        analysis.disposition === "mapped" || (acceptReview && analysis.disposition === "review")
          ? generateEta(text, abs, { acceptReview })
          : { ok: false, reason: "not mapped" };
      if (generation.ok && generation.eta !== undefined) {
        const etaRel = rel.replace(/\.(j2|jinja)$/i, ".eta");
        const etaOut = join(outDir, etaRel);
        if (options.write) {
          mkdirSync(dirname(etaOut), { recursive: true });
          writeFileSync(etaOut, generation.eta, "utf8");
          written.push(etaOut);
        }
        templateExact.set(rel, etaRel);
        const base = basename(rel);
        const existing = templateBase.get(base);
        if (existing !== undefined && existing !== etaRel) {
          finding(state, abs, "template", "template", "review", `duplicate template basename '${base}'; using the first mapping`);
        } else {
          templateBase.set(base, etaRel);
        }
        finding(
          state,
          abs,
          "template",
          "template",
          analysis.disposition === "review" ? "review" : "mapped",
          analysis.disposition === "review"
            ? "converted to Eta with explicitly accepted review constructs"
            : "converted to Eta (mapped subset)",
        );
        fileResults.push({ source: abs, output: etaOut, written: options.write === true, findings: state.findings.slice(findingStart) });
      } else {
        if (analysis.disposition === "mapped" && generation.reason !== undefined) {
          finding(state, abs, "template", "template", "gap", `Eta codegen failed: ${generation.reason}`);
        }
        const draft = generateEtaDraft(text, abs);
        draftIndex += 1;
        const draftId = `${String(draftIndex).padStart(4, "0")}-${basename(rel)
          .replace(/\.[^.]+$/, "")
          .replace(/[^a-zA-Z0-9]+/g, "-")}`;
        const draftPath = join(gapsDir, "templates", `${draftId}.eta.draft`);
        if (options.write || options.gaps !== undefined) {
          mkdirSync(dirname(draftPath), { recursive: true });
          writeFileSync(draftPath, draft, "utf8");
        }
        finding(
          state,
          abs,
          `templates/${draftId}.eta.draft`,
          "template",
          "review",
          "partial Eta draft emitted with GAP markers",
        );
        if (options.write) {
          mkdirSync(dirname(relOut), { recursive: true });
          copyFileSync(abs, relOut);
          written.push(relOut);
        }
        fileResults.push({ source: abs, output: relOut, written: options.write === true, findings: state.findings.slice(findingStart) });
      }
      preprocessed.add(abs);
    }
  }

  for (const abs of files) {
    if (preprocessed.has(abs)) continue;
    const rel = isDir ? relative(sourceAbs, abs) : abs.split(/[\\/]/).pop()!;
    const relOut = join(outDir, rel);
    const ext = abs.slice(abs.lastIndexOf(".")).toLowerCase();
    if (ext !== ".yml" && ext !== ".yaml") {
      const text = ext === ".ini" ? readFileSync(abs, "utf8") : "";
      if (text.includes("ansible_")) {
        const findingStart = state.findings.length;
        const converted = convertInventoryIni(text, state, abs);
        if (options.write) {
          mkdirSync(dirname(relOut), { recursive: true });
          writeFileSync(relOut, converted, "utf8");
          written.push(relOut);
        }
        fileResults.push({
          source: abs,
          output: relOut,
          written: options.write === true,
          findings: state.findings.slice(findingStart),
        });
        continue;
      }
      if (options.write) {
        mkdirSync(dirname(relOut), { recursive: true });
        copyFileSync(abs, relOut);
        written.push(relOut);
      }
      fileResults.push({ source: abs, output: relOut, written: options.write === true, findings: [] });
      continue;
    }
    const text = readFileSync(abs, "utf8");
    if (!text.trim() || text.trim().split(/\r?\n/).every((line) => !line.trim() || line.trim().startsWith("#"))) {
      if (options.write) {
        mkdirSync(dirname(relOut), { recursive: true });
        copyFileSync(abs, relOut);
        written.push(relOut);
      }
      fileResults.push({ source: abs, output: relOut, written: options.write === true, findings: [] });
      continue;
    }
    let doc: unknown;
    try {
      doc = yamlLoad(text);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      finding(state, abs, "", "yaml", "gap", `could not parse YAML: ${detail}`);
      fileResults.push({ source: abs, output: relOut, written: false, findings: state.findings.filter((f) => f.file === abs), error: detail });
      continue;
    }
    const findingStart = state.findings.length;
    const relMode = isDir ? relative(sourceAbs, abs) : "";
    if (isAnsibleYamlInventory(doc)) {
      const convertedInventory = convertInventoryValue(doc, state, abs, "inventory");
      const outputText = yamlDump(convertedInventory, { lineWidth: -1, noRefs: true, sortKeys: false });
      if (options.write) {
        mkdirSync(dirname(relOut), { recursive: true });
        writeFileSync(relOut, outputText, "utf8");
        written.push(relOut);
      }
      fileResults.push({
        source: abs,
        output: relOut,
        written: options.write === true,
        findings: state.findings.slice(findingStart),
      });
      continue;
    }
    if (isDir && isVarFile(relMode) && asRecord(doc) !== undefined) {
      const rec = asRecord(doc)!;
      const convertedVars: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rec)) {
        convertedVars[key] = convertValue(value, state, abs, `vars.${key}`);
      }
      if (/\{\{|\{%/.test(text)) {
        finding(state, abs, "vars", "var-file", "mapped", "converted Jinja values to $jinja");
      }
      const outputText = yamlDump(convertedVars, { lineWidth: -1, noRefs: true, sortKeys: false });
      if (options.write) {
        mkdirSync(dirname(relOut), { recursive: true });
        writeFileSync(relOut, outputText, "utf8");
        written.push(relOut);
      }
      fileResults.push({
        source: abs,
        output: relOut,
        written: options.write === true,
        findings: state.findings.slice(findingStart),
      });
      continue;
    }
    const converted = convertYamlDocument(doc, state, abs);
    const fileFindings = state.findings.slice(findingStart);
    let outputText: string | undefined;
    if (converted.kind !== "other") {
      rewriteTemplateRefs(converted.converted, templateExact, templateBase, state, abs);
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
  const gaps = state.findings.filter((f) => f.disposition === "gap").length;
  const mapped = state.findings.filter((f) => f.disposition === "mapped").length;
  const result: ConvertResult = {
    command: "convert ansible",
    source: sourceAbs,
    out: outDir,
    gaps: gapsDir,
    applied: options.write === true,
    files: fileResults,
    written,
    totals: {
      files: fileResults.length,
      mapped,
      review,
      gaps,
      findings: state.findings.length,
    },
    findings: state.findings,
    ...(project !== undefined ? { project } : {}),
  };

  if ((options.write === true || options.gaps !== undefined) && result.findings.length > 0) {
    writeGapsBundle(result, gapsDir);
  }
  return result;
}

/** Write the deterministic conversion-gaps bundle (`CONVERSION_GAPS.md` + `manifest.json`). */
export function writeGapsBundle(result: ConvertResult, gapsDir: string): void {
  mkdirSync(gapsDir, { recursive: true });
  const lines: string[] = [
    "# RoleCall conversion gaps",
    "",
    `Source: \`${result.source}\``,
    `Converted: \`${result.out}\``,
    "",
    `Mapped: ${result.totals.mapped} · Review: ${result.totals.review} · Gaps: ${result.totals.gaps}`,
    "",
    "Review and gap items are not mechanically equivalent. Fix each one before",
    "treating the converted tree as a faithful replacement.",
    "",
  ];
  for (const item of result.findings.filter((f) => f.disposition !== "mapped")) {
    lines.push(`## ${item.disposition}: ${item.construct}`, "", `- File: \`${item.file}\``, `- Path: \`${item.path}\``, "", item.message, "");
  }
  writeFileSync(join(gapsDir, "CONVERSION_GAPS.md"), lines.join("\n"), "utf8");
  const itemsDir = join(gapsDir, "items");
  mkdirSync(itemsDir, { recursive: true });
  let index = 0;
  for (const item of result.findings.filter((f) => f.disposition !== "mapped")) {
    index += 1;
    const slug = `${item.construct}-${item.path}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item";
    const body = [
      `# ${item.disposition}: ${item.construct}`,
      "",
      `- File: \`${item.file}\``,
      `- Path: \`${item.path}\``,
      "",
      item.message,
      "",
    ].join("\n");
    writeFileSync(join(itemsDir, `${String(index).padStart(4, "0")}-${slug}.md`), body, "utf8");
  }
  writeFileSync(
    join(gapsDir, "manifest.json"),
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

interface TemplateRef {
  ref: string;
  engine: string;
}

/** Collect `copy.content.template_file` references and their engine. */
function collectTemplateRefs(value: unknown, out: TemplateRef[] = []): TemplateRef[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectTemplateRefs(entry, out);
    return out;
  }
  const rec = asRecord(value);
  if (rec === undefined) return out;
  const copy = asRecord(rec["copy"]);
  if (copy !== undefined) {
    const content = asRecord(copy["content"]);
    if (content !== undefined && content["template_file"] !== undefined) {
      const engine = typeof content["engine"] === "string" ? content["engine"] : "ejs";
      const refs = Array.isArray(content["template_file"])
        ? content["template_file"]
        : [content["template_file"]];
      for (const ref of refs) if (typeof ref === "string") out.push({ ref, engine });
    }
  }
  for (const [key, child] of Object.entries(rec)) {
    if (key !== "copy") collectTemplateRefs(child, out);
  }
  return out;
}

/** Validate template references, engine/extension pairing, and half-converted files. */
function validateTemplateRefs(root: string, doc: unknown): string[] {
  const files = walkFiles(root);
  const byBase = new Map<string, string[]>();
  for (const abs of files) {
    const list = byBase.get(basename(abs)) ?? [];
    list.push(abs);
    byBase.set(basename(abs), list);
  }
  const resolve = (ref: string): string | undefined => {
    const direct = join(root, ref);
    if (existsSync(direct)) return direct;
    const matches = byBase.get(basename(ref)) ?? [];
    return matches[0];
  };
  const errors: string[] = [];
  for (const { ref, engine } of collectTemplateRefs(doc)) {
    const abs = resolve(ref);
    if (abs === undefined) {
      errors.push(`template_file '${ref}' does not resolve`);
      continue;
    }
    const ext = abs.slice(abs.lastIndexOf(".")).toLowerCase();
    if (engine === "eta" && ext !== ".eta") {
      errors.push(`template_file '${ref}' uses engine eta but resolves to '${ext}'`);
    }
    if (engine === "jinja" && ext !== ".j2" && ext !== ".jinja") {
      errors.push(`template_file '${ref}' uses engine jinja but resolves to '${ext}'`);
    }
    if (ext === ".eta") {
      const j2 = abs.replace(/\.eta$/i, ".j2");
      if (existsSync(j2)) errors.push(`half-converted template: both '${abs}' and '${j2}' exist`);
    }
  }
  return errors;
}

export function validateConvertedTree(dir: string): { file: string; ok: boolean; error?: string }[] {
  const out: { file: string; ok: boolean; error?: string }[] = [];
  for (const abs of walkFiles(dir)) {
    if (!/\.ya?ml$/i.test(abs)) continue;
    const text = readFileSync(abs, "utf8");
    if (!text.trim() || text.trim().split(/\r?\n/).every((line) => !line.trim() || line.trim().startsWith("#"))) {
      continue;
    }
    try {
      const doc = yamlLoad(text);
      if (!Array.isArray(doc)) continue;
      const first = asRecord(doc[0]);
      if (first === undefined || first.hosts === undefined) continue;
      loadPlaybook(text);
      const templateErrors = validateTemplateRefs(dir, doc);
      out.push({
        file: abs,
        ok: templateErrors.length === 0,
        ...(templateErrors.length > 0 ? { error: templateErrors.join("; ") } : {}),
      });
    } catch (error) {
      out.push({ file: abs, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return out;
}
