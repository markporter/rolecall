// RoleCall config schema — Zod-validated models for playbooks / inventory.
//
// Playbook field-name mapping (documented for contributors):
//   hosts  -> target hosts (string or list)
//   tasks  -> ordered task list
//   vars   -> play-level variables
//   when   -> conditional guard expression
//   loop   -> iteration over a sequence
//   notify -> handler name(s) to flush
//   module -> module / action name
//   args   -> module arguments (key/value)
//   groups -> inventory host groups
//   roles  -> composed role dirs (tasks/defaults/vars/handlers merged into the play)
//   handlers -> play-level handler list, lowered to `listen` tasks at load time
//   tags   -> task/play labels selected at run time by --tags / --skip-tags
//
// IDEMPOTENCY IS INTRINSIC (decisions.md #1, learnings.md): there is deliberately
// NO `idempotent` field on any task. Declarative modules auto check-compare-write;
// side-effecting ops (shell/command, HTTP POST) always apply. Do NOT add it back —
// the strict schemas below REJECT `idempotent` so the constraint is enforced at parse.

import { z } from "zod";

import type { VarManifestEntry } from "./var-manifest/index.js";
import type { VarOriginMap } from "./var-trace.js";

// ---------------------------------------------------------------------------
// TriggerSpec — minimal shape for the later scheduler / webhook todos.
// ---------------------------------------------------------------------------
/** @summary Discriminated union of scheduler/webhook trigger definitions (cron | webhook). */
export const TriggerSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("cron"),
    spec: z.string(),
  }),
  z.strictObject({
    type: z.literal("webhook"),
    path: z.string().optional(),
  }),
]);
/** @summary Inferred type of a validated TriggerSchema discriminated union. */
export type TriggerSpec = z.infer<typeof TriggerSchema>;

// ---------------------------------------------------------------------------
// Task — strict. `when`/`loop` are intentionally `unknown` (evaluated later by
// the templating/executor wave). `notify` accepts a string or list and is
// normalized to a list.
// ---------------------------------------------------------------------------
/** @summary Strict Zod model for a declarative task with RoleCall-compatible fields. */
export const TaskSchema = z
  .strictObject({
    name: z.string(),
    // `module` is required for a real task, but an `include_tasks` directive task
    // carries no module of its own (it is expanded away at load time). The
    // superRefine below enforces exactly one of {module, include_tasks}.
    module: z.string().optional(),
    // Module args are optional; absent => empty object downstream.
    args: z.record(z.string(), z.unknown()).optional(),
    when: z.unknown().optional(),
    loop: z.unknown().optional(),
    notify: z.union([z.string(), z.array(z.string())]).optional(),
    // --- Load-time expansion directives (Todo 5) ---
    // include_tasks: path(s) to a playbook file whose tasks are spliced in at this
    // task's index. Mutually exclusive with `module` for a directive task.
    include_tasks: z.union([z.string(), z.array(z.string())]).optional(),
    // hosts: optional per-task target override. An imported/included task honors
    // its own `hosts:` if present, else inherits the parent playbook `hosts`.
    hosts: z.union([z.string(), z.array(z.string())]).optional(),
    // --- Executor control-flow fields (Todo 12) ---
    // register: store the task result under this name in the per-host facts map.
    register: z.string().optional(),
    // delegate_to: run the task against this host instead of the task's host.
    delegate_to: z.string().optional(),
    // run_once: execute the task a single time (on the first matched host).
    run_once: z.boolean().optional(),
     // listen: marks this task as a handler triggered by `notify` of the same name.
     listen: z.string().optional(),
      // become: escalate privileges (sudo) on the target for this task.
      become: z.boolean().optional(),
      // become_user: run escalated commands as this user (sudo -u <user>).
      become_user: z.string().optional(),
      // environment: environment variables exported for the module command (task-level).
      environment: z.record(z.string(), z.string()).optional(),
      // no_log: suppress logging of task args / stdout / stderr.
      no_log: z.boolean().optional(),
      // tags: labels selected at run time by the global --tags / --skip-tags flags.
      // Absent => inherit the play's `tags` (see canonicalizeTask + tags.ts).
      tags: z.array(z.string()).optional(),
      // roleDir: absolute path of the contributing role (set by the loader) so
      // modules can resolve role-relative paths (e.g. copy `content.template_file`).
      roleDir: z.string().optional(),
    // --- Transaction / checkpoint grouping (Todo 26) ---
    // tx: groups dependent tasks/plays into one transaction; on member failure the
    // tx's applied ledger rows are reverse-walked and undone (see src/executor/tx.ts).
    tx: z.string().optional(),
    // checkpoint: marks the savepoint this task is applied under (Todo 26). Enables
    // partial rollback to the last reached checkpoint rather than a full unwind.
    checkpoint: z.string().optional(),
  })
  .superRefine((task, ctx) => {
    // A directive task (`include_tasks`) needs no `module`; any other task does.
    if (task.include_tasks === undefined && task.module === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["module"],
        message:
          "module is required for a task unless include_tasks is set (directive task)",
      });
    }
  });

// ---------------------------------------------------------------------------
// Task canonicalization — Ansible-style collapsed tasks.
//
// RoleCall accepts BOTH task shapes:
//   explicit:  { name, module: "copy", args: { src, dest } }
//   collapsed: { name, copy: { src, dest } }   (Ansible shorthand)
// `canonicalizeTask` rewrites the collapsed form into the explicit form before the
// strict TaskSchema validates it; explicit tasks and `include_tasks` directives
// pass through untouched. Malformed collapsed tasks are returned unchanged so the
// strict schema reports the problem (e.g. an unrecognized module key).
// ---------------------------------------------------------------------------
/** Structural (non-module) task keys; any other single top-level key names a module. */
const TASK_STRUCTURAL_KEYS = new Set<string>([
  "name", "module", "args", "when", "loop", "notify", "include_tasks",
  "hosts", "register", "delegate_to", "run_once", "listen", "become",
  "roleDir", "tx", "checkpoint", "tags",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @summary Rewrite an Ansible-style collapsed task (`copy: { src, dest }`) into RoleCall's
 * explicit `{ module, args }` shape. Tasks already carrying a `module` key or an
 * `include_tasks` directive are returned unchanged.
 * @param raw The raw task object parsed from YAML.
 * @returns The canonical explicit task, or `raw` unchanged when no safe rewrite applies.
 */
export function canonicalizeTask(raw: unknown): unknown {
  if (!isPlainRecord(raw) || typeof raw.module === "string") return raw;
  const moduleKeys = Object.keys(raw).filter((k) => !TASK_STRUCTURAL_KEYS.has(k));
  if (moduleKeys.length !== 1) return raw;
  const moduleName = moduleKeys[0]!;
  const argsValue = raw[moduleName];
  if (!isPlainRecord(argsValue)) return raw;
  const rest = { ...raw };
  delete (rest as Record<string, unknown>)[moduleName];
  return { ...rest, module: moduleName, args: argsValue };
}

/**
 * @summary TaskSchema with Ansible-style collapsed-task support (see {@link canonicalizeTask}).
 * Use this wherever raw playbook/role/handler tasks are parsed.
 */
export const CanonicalTaskSchema = z.preprocess(canonicalizeTask, TaskSchema);

/** @summary Validated-in-YAML shape of a TaskSchema instance. */
export type RawTask = z.infer<typeof TaskSchema>;

// ---------------------------------------------------------------------------
// Playbook — strict. `hosts` accepts a string or list (normalized to list).
//
// A playbook FILE is ALWAYS a top-level YAML list of plays (Ansible's document
// form: `- name: …` entries). A bare single-play object is REJECTED at load time
// with a crisp, actionable error — maintaining two document forms was a footgun
// and diverged from Ansible, whose playbooks are always lists of plays.
// `normalizePlaybook` receives only arrays and returns a `NormalizedPlaybook[]`.
// ---------------------------------------------------------------------------
/** @summary Strict Zod model for a single play (hosts plus ordered tasks). */
export const PlaybookObject = z
  .strictObject({
    name: z.string().optional(),
    hosts: z.union([z.string(), z.array(z.string())]),
    tasks: z.array(CanonicalTaskSchema),
    // handlers: Ansible-style play-level handler list. Each entry is task-shaped and
    // lowered at load time (see normalizeOnePlay) into a task carrying `listen:`
    // defaulting to the entry's `name`, so a task's `notify: <name>` triggers it and
    // the executor flushes it once at end of play via its existing listen machinery.
    handlers: z.array(CanonicalTaskSchema).optional(),
    // imports: paths to playbook files whose tasks are spliced into this play's
    // task list at load time (Todo 5). Resolved relative to the project source root.
    imports: z.array(z.string()).optional(),
    // roles: names of roles composed into this play at load time. Each
    // resolved role dir contributes tasks/main.yml (spliced before the play's own
    // tasks), defaults/main.yml + vars/main.yml (merged into play.vars), and
    // handlers/main.yml (handler tasks carrying `listen`). Resilience/error semantics
    // mirror `imports`: unresolvable roles throw. Composition happens in loader.ts.
    roles: z.array(z.string()).optional(),
    vars: z.record(z.string(), z.unknown()).optional(),
    // tags: play-wide labels inherited by every task in the play that does not declare
    // its own `tags:` (a task with its own tags replaces these — no union). Selected by
    // the global --tags / --skip-tags flags.
    tags: z.array(z.string()).optional(),
    trigger: TriggerSchema.optional(),
    // --- Executor play-level control-flow fields (Todo 12) ---
    // serial: process matched hosts in batches of N sequentially.
    serial: z.number().int().positive().optional(),
    // strategy: "linear" (default, task-by-task gated) or "free" (per-host un-gated).
    strategy: z.enum(["linear", "free"]).optional(),
    // --- Transaction + checkpoint grouping (Todo 26) ---
    // tx: when set, this play's deltas join the named transaction; a later member
    //     failure reverse-walks the tx's ledger rows and undoes each reversible one.
    tx: z.string().optional(),
    // checkpoint: marks the savepoint this play applies under; partial rollback only
    //             unwinds deltas applied after the last reached checkpoint.
    checkpoint: z.string().optional(),
  })
  .superRefine((play, ctx) => {
    const seen = new Set<string>();
    (play.handlers ?? []).forEach((handler, i) => {
      if (seen.has(handler.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["handlers", i, "name"],
          message: `duplicate handler name '${handler.name}'; handler names must be unique within a play`,
        });
      }
      seen.add(handler.name);
    });
  });
/** @summary Validated-in-YAML shape of a single PlaybookObject instance. */
export type RawPlaybook = z.infer<typeof PlaybookObject>;

/**
 * @summary Strict Zod model for the plays of a playbook file: a top-level list of plays.
 * Each element stays `z.strictObject`, so unknown keys are rejected.
 */
export const PlaybookArray = z.array(PlaybookObject);

/** The crisp, actionable error raised for a bare-object (non-list) playbook root. */
const PLAYBOOK_MUST_BE_LIST =
  "playbook must be a list of plays (each play starts with '- '); a single bare play object is rejected — wrap the play in a top-level list (Ansible's document form)";

/**
 * Always-failing union branch used only to turn a non-list playbook root into a
 * crisp, actionable error instead of zod's bare "expected array". It stays
 * JSON-schema-representable (unlike a `z.custom` node) so the MCP tool manifest
 * can render `PlaybookSchema`.
 */
const BarePlaybookRejection = z
  .object({})
  .passthrough()
  .superRefine((_, ctx) => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: PLAYBOOK_MUST_BE_LIST });
  });

/**
 * @summary Strict Zod model for a playbook file: a top-level list of plays only.
 * A bare single-play object is rejected with {@link PLAYBOOK_MUST_BE_LIST}.
 */
export const PlaybookSchema = z.union([PlaybookArray, BarePlaybookRejection]);
/** @summary Validated-in-YAML shape of a playbook file: an array of raw plays. */
export type RawPlaybookFile = z.infer<typeof PlaybookArray>;

// ---------------------------------------------------------------------------
// Inventory — strict. groups -> { hosts: string[], vars?, children? } with an
// optional document-root `host_vars` map. Child groups are first-class (Ansible
// tree semantics) rather than flattened into their ancestors.
// ---------------------------------------------------------------------------
/** @summary Strict Zod model for an inventory host group (hosts plus optional vars and child-group names). */
export const InventoryGroupSchema = z.strictObject({
  hosts: z.array(z.string()),
  vars: z.record(z.string(), z.unknown()).optional(),
  /** Names of child groups (as Ansible expresses the group tree). */
  children: z.array(z.string()).optional(),
});
/** @summary Validated-in-YAML shape of an InventoryGroupSchema instance. */
export type RawInventoryGroup = z.infer<typeof InventoryGroupSchema>;

/**
 * @summary Strict Zod model mapping named inventory groups plus optional per-host vars.
 * `superRefine` rejects a `children` entry that names an undefined group and any
 * cycle in the group hierarchy (a group reachable from itself), naming the path.
 */
export const InventorySchema = z
  .strictObject({
    groups: z.record(z.string(), InventoryGroupSchema),
    /** Per-host variable maps, keyed by hostname (highest precedence layer). */
    host_vars: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  })
  .superRefine((inv, ctx) => {
    const names = Object.keys(inv.groups);
    const known = new Set(names);

    for (const [name, group] of Object.entries(inv.groups)) {
      for (const child of group.children ?? []) {
        if (!known.has(child)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["groups", name, "children"],
            message: `group '${name}' lists child group '${child}' which is not defined in groups`,
          });
        }
      }
    }

    // Cycle detection (a group reachable from itself). WHITE=0, GRAY=1, BLACK=2.
    const color = new Map<string, number>();
    const stack: string[] = [];
    const visit = (name: string): void => {
      const c = color.get(name) ?? 0;
      if (c === 2) return;
      if (c === 1) {
        const idx = stack.indexOf(name);
        const cycle = [...stack.slice(idx), name];
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["groups", name, "children"],
          message: `group hierarchy cycle detected: ${cycle.join(" -> ")}`,
        });
        return;
      }
      color.set(name, 1);
      stack.push(name);
      for (const child of inv.groups[name]?.children ?? []) {
        if (known.has(child)) visit(child);
      }
      stack.pop();
      color.set(name, 2);
    };
    for (const name of names) visit(name);
  });
/** @summary Validated-in-YAML shape of an InventorySchema instance. */
export type RawInventory = z.infer<typeof InventorySchema>;

// ---------------------------------------------------------------------------
// Normalized (canonical internal) models. These are plain, serializable data
// structures consumed by every later wave (inventory engine, executor,
// templating). Normalization rules:
//   - hosts: string -> [string]
//   - notify: string -> [string]; omitted -> []
//   - vars: omitted -> {}
//   - group.vars: omitted -> {}
// ---------------------------------------------------------------------------
/** @summary Canonical, serializable form of a normalized task. */
export interface NormalizedTask {
  name: string;
  module?: string;
  args: Record<string, unknown>;
  when?: unknown;
  loop?: unknown;
  notify: string[];
  /** Optional per-task target override; inherits the parent play `hosts` when absent. */
  hosts?: string[];
  /** Optional `include_tasks` directive (load-time expansion); absent on executed tasks. */
  include_tasks?: string | string[];
  register?: string;
  delegate_to?: string;
  run_once?: boolean;
   listen?: string;
    /** When true, escalate privileges (sudo) on the target for this task. */
    become?: boolean;
    /** When set, run escalated commands as this user (sudo -u <user>). */
    become_user?: string;
    /** Environment variables exported for the module command (task-level). */
    environment?: Record<string, string>;
    /** When true, suppress logging of task args / stdout / stderr. */
    no_log?: boolean;
    /** Labels selected at run time by the global `--tags` / `--skip-tags` flags. Absent => the task inherits its play's `tags`; present (even empty) => it replaces them (no union). */
    tags?: string[];
    /** Absolute path of the role directory this task was composed from (set by the loader); enables role-relative path resolution. */
    roleDir?: string;
    /** Transaction id grouping dependent tasks/plays for rollback (Todo 26). */
  tx?: string;
  /** Checkpoint id this task is applied under (Todo 26, partial rollback). */
  checkpoint?: string;
}

/** @summary Canonical, serializable form of a normalized playbook (single play). */
export interface NormalizedPlaybook {
  name?: string;
  hosts: string[];
  tasks: NormalizedTask[];
  /** Optional `imports` directives (load-time expansion); absent after expansion. */
  imports?: string[];
  /** Roles composed into this play at load time; empty once expanded away. */
  roles?: string[];
  vars: Record<string, unknown>;
  /** Play-wide tags inherited by every task lacking its own `tags:`; selected at run time by the global `--tags` / `--skip-tags` flags. */
  tags?: string[];
  trigger?: TriggerSpec;
  serial?: number;
  strategy?: "linear" | "free";
  /** Transaction id grouping dependent plays for rollback (Todo 26). */
  tx?: string;
  /** Checkpoint id this play applies under (Todo 26). */
  checkpoint?: string;
  /** Declared variable manifests collected for this play (role defaults manifests + playbook-root manifest), used by later phases for strict var validation and resolution. Absent until the loader discovers manifests. */
  varManifests?: VarManifestEntry[];
  /** When true (the default), `$var` references must use a known namespace (`vars.`/`facts.` by default) and resolve to a declared manifest entry (var_strict). Set false to permit undeclared references. */
  var_strict?: boolean;
  /** Role defaults (lowest precedence tier), kept separate from `vars` so the executor can layer it below inventory host/group vars. */
  roleDefaults?: Record<string, unknown>;
  /** Names of roles applied to this play (post-expansion), preserved for the `play.roles` namespace (ADR 0013 §6) after `roles` is cleared. */
  appliedRoleNames?: string[];
  /** Origin-tagged role defaults + role vars (lowest two tiers), populated by the loader for the `vars trace` command. Purely additive: the executor ignores it. */
  varOrigins?: VarOriginMap;
}

/** @summary A normalized playbook file: either a single play or a top-level list of plays. */
export type NormalizedPlaybookFile = NormalizedPlaybook | NormalizedPlaybook[];

/** @summary Canonical, serializable form of a normalized inventory. */
export interface NormalizedInventory {
  groups: Record<
    string,
    { hosts: string[]; vars: Record<string, unknown>; children?: string[] }
  >;
  /** Per-host var maps (highest precedence layer), keyed by hostname. Absent when the source declares none. */
  hostVars?: Record<string, Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Normalizers: Raw (validated YAML) -> Normalized (canonical).
// ---------------------------------------------------------------------------
/** Normalize a validated RawTask into canonical form (string→list, omitted→defaults). */
export function normalizeTask(raw: RawTask): NormalizedTask {
  return {
    name: raw.name,
    ...(raw.module !== undefined ? { module: raw.module } : {}),
    args: raw.args ?? {},
    ...(raw.when !== undefined ? { when: raw.when } : {}),
    ...(raw.loop !== undefined ? { loop: raw.loop } : {}),
    notify:
      raw.notify === undefined
        ? []
        : Array.isArray(raw.notify)
          ? raw.notify
          : [raw.notify],
    ...(raw.hosts !== undefined
      ? { hosts: Array.isArray(raw.hosts) ? raw.hosts : [raw.hosts] }
      : {}),
    ...(raw.include_tasks !== undefined ? { include_tasks: raw.include_tasks } : {}),
    ...(raw.register !== undefined ? { register: raw.register } : {}),
    ...(raw.delegate_to !== undefined ? { delegate_to: raw.delegate_to } : {}),
    ...(raw.run_once !== undefined ? { run_once: raw.run_once } : {}),
    ...(raw.listen !== undefined ? { listen: raw.listen } : {}),
    ...(raw.become !== undefined ? { become: raw.become } : {}),
    ...(raw.become_user !== undefined ? { become_user: raw.become_user } : {}),
    ...(raw.environment !== undefined ? { environment: raw.environment } : {}),
    ...(raw.no_log !== undefined ? { no_log: raw.no_log } : {}),
    ...(raw.tags !== undefined ? { tags: raw.tags } : {}),
    ...(raw.roleDir !== undefined ? { roleDir: raw.roleDir } : {}),
    ...(raw.tx !== undefined ? { tx: raw.tx } : {}),
    ...(raw.checkpoint !== undefined ? { checkpoint: raw.checkpoint } : {}),
  };
}

/**
 * Normalize a validated playbook file (a top-level list of plays) into a canonical
 * array of plays. The schema rejects a bare play object before this runs, so `raw`
 * is always an array.
 * @param raw Validated playbook file (an array of plays).
 * @returns Canonical, serializable array of normalized plays.
 */
export function normalizePlaybook(raw: RawPlaybookFile): NormalizedPlaybook[] {
  return raw.map(normalizeOnePlay);
}

/**
 * Lower a play-level `handlers:` entry into a NormalizedTask carrying `listen`, so a
 * task's `notify: <handler-name>` triggers it through the executor's existing listen
 * machinery. An entry's explicit `listen:` (a notify topic) is preserved; otherwise
 * the handler's own `name` becomes the listen key.
 * @param raw A validated handler entry (already canonicalized to a task shape).
 * @returns The handler as a normalized task flagged with `listen`.
 */
function lowerPlayHandler(raw: RawTask): NormalizedTask {
  const task = normalizeTask(raw);
  return { ...task, listen: task.listen ?? task.name };
}

/** Normalize a single validated RawPlaybook into canonical form (hosts coerced to list). */
function normalizeOnePlay(raw: RawPlaybook): NormalizedPlaybook {
  const tasks = raw.tasks.map(normalizeTask);
  for (const handler of raw.handlers ?? []) tasks.push(lowerPlayHandler(handler));
  return {
    ...(raw.name !== undefined ? { name: raw.name } : {}),
    hosts: Array.isArray(raw.hosts) ? raw.hosts : [raw.hosts],
    tasks,
    ...(raw.imports !== undefined ? { imports: raw.imports } : {}),
    roles: raw.roles ?? [],
    vars: raw.vars ?? {},
    ...(raw.tags !== undefined ? { tags: raw.tags } : {}),
    ...(raw.trigger !== undefined ? { trigger: raw.trigger } : {}),
    ...(raw.serial !== undefined ? { serial: raw.serial } : {}),
    ...(raw.strategy !== undefined ? { strategy: raw.strategy } : {}),
    ...(raw.tx !== undefined ? { tx: raw.tx } : {}),
    ...(raw.checkpoint !== undefined ? { checkpoint: raw.checkpoint } : {}),
  };
}

/** Normalize a validated RawInventory into grouped, vars-defaulted canonical form, preserving child-group names and per-host vars when present. */
export function normalizeInventory(raw: RawInventory): NormalizedInventory {
  const groups: NormalizedInventory["groups"] = {};
  for (const [name, group] of Object.entries(raw.groups)) {
    groups[name] = {
      hosts: group.hosts,
      vars: group.vars ?? {},
      ...(group.children !== undefined ? { children: group.children } : {}),
    };
  }
  return {
    groups,
    ...(raw.host_vars !== undefined ? { hostVars: raw.host_vars } : {}),
  };
}

// ---------------------------------------------------------------------------
// Serializers: Normalized -> plain object (round-trip stable).
// `serialize(normalized)` deep-equals `normalized` for any valid input.
// ---------------------------------------------------------------------------
/** Serialize a NormalizedTask back to a plain, round-trip-stable object. */
export function serializeTask(task: NormalizedTask): Record<string, unknown> {
  const out: Record<string, unknown> = { name: task.name };
  if (task.module !== undefined) out.module = task.module;
  out.args = task.args;
  if (task.when !== undefined) out.when = task.when;
  if (task.loop !== undefined) out.loop = task.loop;
  out.notify = task.notify;
  if (task.hosts !== undefined) out.hosts = task.hosts;
  if (task.include_tasks !== undefined) out.include_tasks = task.include_tasks;
  if (task.become !== undefined) out.become = task.become;
  if (task.tags !== undefined) out.tags = task.tags;
  if (task.tx !== undefined) out.tx = task.tx;
  if (task.checkpoint !== undefined) out.checkpoint = task.checkpoint;
  return out;
}

/** Serialize a NormalizedPlaybook back to a plain, round-trip-stable object. */
export function serializePlaybook(
  playbook: NormalizedPlaybook,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...(playbook.name !== undefined ? { name: playbook.name } : {}),
    hosts: playbook.hosts,
    tasks: playbook.tasks.map(serializeTask),
    vars: playbook.vars,
  };
  if (playbook.imports !== undefined) out.imports = playbook.imports;
  if (playbook.roles !== undefined) out.roles = playbook.roles;
  if (playbook.appliedRoleNames !== undefined) out.appliedRoleNames = playbook.appliedRoleNames;
  if (playbook.tags !== undefined) out.tags = playbook.tags;
  if (playbook.trigger !== undefined) out.trigger = playbook.trigger;
  return out;
}

/** Serialize a NormalizedInventory back to a plain, round-trip-stable object. */
export function serializeInventory(
  inventory: NormalizedInventory,
): Record<string, unknown> {
  const groups: Record<string, unknown> = {};
  for (const [name, group] of Object.entries(inventory.groups)) {
    groups[name] = {
      hosts: group.hosts,
      vars: group.vars,
      ...(group.children !== undefined ? { children: group.children } : {}),
    };
  }
  return {
    groups,
    ...(inventory.hostVars !== undefined ? { host_vars: inventory.hostVars } : {}),
  };
}
