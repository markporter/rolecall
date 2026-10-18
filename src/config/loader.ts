// RoleCall config loader — parse YAML via js-yaml into Zod-validated + normalized
// models. Pure config parsing only: NO templating, NO transport/SSH/HTTP.
//
// On invalid input the underlying ZodError is thrown as-is, so callers can read
// `error.issues[].path` to learn exactly which field failed (e.g. ["tasks", 0,
// "module"]). Unknown keys are rejected by the strict() schemas.

import { load as yamlLoad } from "js-yaml";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import type { ZodError, ZodSchema } from "zod";

import {
  InventorySchema,
  PlaybookSchema,
  normalizeInventory,
  normalizePlaybook,
  normalizeTask,
  type NormalizedInventory,
  type NormalizedPlaybook,
  type NormalizedTask,
  type RawInventory,
  type RawTask,
  CanonicalTaskSchema,
} from "./schema";

import { isStructured } from "../templating/refs.js";

import {
  isAnsibleYamlInventory,
  looksLikeIniInventory,
  parseAnsibleIniInventory,
  parseAnsibleYamlInventory,
} from "../inventory/ansible.js";

import { parseManifestYaml, mergeManifests, type VarManifestEntry } from "./var-manifest/index.js";
import type { VarOriginMap, VarTier } from "./var-trace.js";

import { getDeclaredFactNames } from "../facts/engine.js";

import { FsProjectSource } from "../vfs/fs-project-source.js";
import type { ProjectSource } from "../vfs/project-source.js";

// Parse YAML text into an untyped value. js-yaml throws a YAMLException on
// malformed syntax; we surface it unchanged (it is not a schema error).
function parseYaml(text: string): unknown {
  return yamlLoad(text);
}

// Validate + normalize a raw YAML value against `schema`, throwing the ZodError
// (with named field paths) on failure.
function validate<TOut, TRaw>(
  data: unknown,
  schema: ZodSchema<TRaw>,
  normalize: (raw: TRaw) => TOut,
): TOut {
  const result = schema.safeParse(data);
  if (!result.success) {
    // Re-throw the ZodError so callers can inspect `issues[].path`.
    throw result.error;
  }
  return normalize(result.data);
}

// --- Idempotency lint guard -------------------------------------------------
//
// The `shell` module is controlled by `run_mode` (default `idempotent`): in
// `idempotent` mode it THROWS at apply time when no idempotency guard is set. This
// lint is the earlier, softer WARNING that still fires at load time so authors
// catch the issue before a run. A task set to `run_mode: readonly` or
// `run_mode: always` explicitly opts out of guarding, which suppresses the warning.
// Other modules are skipped; declarative idempotent modules self-guard.

/** Modules whose repeated, unguarded runs are inherently non-idempotent. */
const UNGUARDED_MODULES = new Set(["shell"]);
/** Per-task args that signal an idempotency guard is present. */
const GUARD_HINTS = ["creates", "removes", "creates_cmd", "removes_cmd"];

/** A single idempotency warning emitted during playbook load/normalize. */
export interface IdempotencyWarning {
  task: string;
  module: string;
  warning: string;
}

/**
 * Inspect a normalized playbook for unguarded shell/command tasks and return
 * human-readable warnings. Never throws — callers decide how to surface them.
 * @param pb Normalized playbook model.
 * @returns Zero or more idempotency warnings.
 */
export function lintPlaybookIdempotency(pb: NormalizedPlaybook): IdempotencyWarning[] {
  const out: IdempotencyWarning[] = [];
  for (const t of pb.tasks) {
    const module = t.module ?? "";
    if (!UNGUARDED_MODULES.has(module)) continue;
    const args = t.args ?? {};
    // `run_mode: readonly`/`always` explicitly opt out of guarding, so no warning.
    const runMode = args["run_mode"];
    if (runMode === "readonly" || runMode === "always") continue;
    const hasGuard = GUARD_HINTS.some((h) => h in args);
    if (!hasGuard) {
      out.push({
        task: t.name,
        module,
        warning: `module '${module}' has run_mode '${runMode ?? "idempotent"}' but no idempotency guard (creates/removes/creates_cmd/removes_cmd); repeated runs may apply unconditionally`,
      });
    }
  }
  return out;
}

// --- Template ref lint guard ------------------------------------------------

/** A single template-ref problem found during playbook load. */
export interface TemplateRefProblem {
  /** Dot/bracket path to the offending value within the playbook. */
  path: string;
  /** `jinja` = raw `{{ }}` delimiter; `namespace-unknown` = `$var` whose first segment is not one of the 9 reserved namespaces; `undeclared-var`/`undeclared-fact` = var_strict enforcement (vars./facts. leaves only). */
  kind: "jinja" | "namespace-unknown" | "undeclared-var" | "undeclared-fact";
  /** Human-readable explanation of the problem. */
  message: string;
}

/** The 9 reserved, fully-qualified namespaces of the `TemplateVars` map (ADR 0013). */
export const KNOWN_NAMESPACES = new Set<string>([
  "vars",
  "facts",
  "reg",
  "loop",
  "play",
  "inv",
  "role",
  "run",
  "rolecall",
]);

/**
 * Inspect a normalized playbook for unsupported template constructs and return
 * problems. Unlike {@link lintPlaybookIdempotency} these are hard errors: callers
 * should throw. Scans task scalar args, `when`, `loop`, `notify`, and names; the
 * `vars` data namespace is intentionally skipped (it holds literal values).
 * @param pb Normalized playbook model.
 * @returns Zero or more template-ref problems.
 */
export function lintTemplateRefs(pb: NormalizedPlaybook): TemplateRefProblem[] {
  const problems: TemplateRefProblem[] = [];

  // Build the declared-name sets from the merged manifest registry attached by the loader.
  const declaredVars = new Set(
    (pb.varManifests ?? []).filter((e) => e.kind === "var").map((e) => e.name),
  );
  // Declared facts = manifest `kind: fact` entries ∪ facts declared by registered
  // plugins/modules. A declared fact is, by construction, one a registered gatherer
  // can produce — this unifies the previously-disconnected declaration and producer sets.
  const declaredFacts = new Set<string>([
    ...(pb.varManifests ?? []).filter((e) => e.kind === "fact").map((e) => e.name),
    ...getDeclaredFactNames(),
  ]);
  // var_strict is on by default, but without any discovered declarations there is nothing
  // to validate against (inventory-sourced vars are not in the registry yet), so enforcement
  // is gated on a non-empty registry — it switches on naturally as manifests are added.
  const strict = (pb.var_strict ?? true) && (pb.varManifests?.length ?? 0) > 0;

  const checkString = (value: string, path: string): void => {
    if (value.includes("{{") || value.includes("}}")) {
      problems.push({
        path,
        kind: "jinja",
        message: `Jinja-style '{{ }}' interpolation is not supported; use a structured ref node such as { $var: vars.foo } (found: ${JSON.stringify(value)})`,
      });
    }
  };

  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      checkString(value, path);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (isStructured(value)) {
        const op = Object.keys(record)[0];
        if (op === "$var") {
          const ref = record.$var;
          if (typeof ref === "string") {
            // ADR 0013: every $var MUST be fully-qualified with one of the 9 reserved
            // namespaces as its first segment; bare refs (e.g. `foo`, `item`, `index`)
            // are rejected so that registered/loop vars can never shadow a reserved alias.
            const dot = ref.indexOf(".");
            const ns = dot === -1 ? ref : ref.slice(0, dot);
            if (!KNOWN_NAMESPACES.has(ns)) {
              problems.push({
                path,
                kind: "namespace-unknown",
                message: `$var must use one of the 9 reserved namespaces (${[...KNOWN_NAMESPACES].join(", ")}); bare refs like { $var: ${JSON.stringify(ref)} } are not allowed (use e.g. { $var: vars.foo })`,
              });
              // Do not apply var_strict on an already-unknown namespace.
            } else if (strict && ns === "vars") {
              const name = ref.slice("vars.".length);
              if (!declaredVars.has(name)) {
                problems.push({
                  path,
                  kind: "undeclared-var",
                  message: `var '${name}' is not declared in any var manifest (var_strict)`,
                });
              }
            } else if (strict && ns === "facts") {
              const name = ref.slice("facts.".length);
              if (!declaredFacts.has(name)) {
                problems.push({
                  path,
                  kind: "undeclared-fact",
                  message: `fact '${name}' is not declared in any var manifest (var_strict)`,
                });
              }
            }
          }
        }
      }
      for (const [k, v] of Object.entries(record)) walk(v, `${path}.${k}`);
    }
  };

  if (pb.name !== undefined) walk(pb.name, "name");
  for (const t of pb.tasks) {
    walk(t.name, "tasks[].name");
    walk(t.module, "tasks[].module");
    walk(t.args, "tasks[].args");
    if (t.when !== undefined) walk(t.when, "tasks[].when");
    if (t.loop !== undefined) walk(t.loop, "tasks[].loop");
    for (const n of t.notify) walk(n, "tasks[].notify");
    if (t.register !== undefined) walk(t.register, "tasks[].register");
    if (t.delegate_to !== undefined) walk(t.delegate_to, "tasks[].delegate_to");
    if (t.listen !== undefined) walk(t.listen, "tasks[].listen");
    if (t.tx !== undefined) walk(t.tx, "tasks[].tx");
    if (t.checkpoint !== undefined) walk(t.checkpoint, "tasks[].checkpoint");
  }

  return problems;
}

// --- Playbook ---------------------------------------------------------------

/**
 * Parse + validate raw playbook YAML text into a normalized array of plays. The
 * document root MUST be a top-level list of plays; a bare single-play object is
 * rejected with a list-required error. Template-ref problems (`{{ }}` / unprefixed
 * `$var`) are hard errors that fail closed; every expanded/imported file is linted
 * at its own load.
 * @param yaml Raw playbook YAML text (a top-level list of plays).
 * @returns The normalized array of plays.
 * @throws {ZodError} When the YAML fails schema validation (incl. a bare play object).
 * @throws {Error} When a template-ref problem is detected.
 */
export function loadPlaybook(yaml: string): NormalizedPlaybook[] {
  const parsed = PlaybookSchema.safeParse(parseYaml(yaml));
  if (!parsed.success) {
    // Re-throw the ZodError so callers can inspect `issues[].path`.
    throw parsed.error;
  }
  const rawPlays = parsed.data;
  if (!Array.isArray(rawPlays)) {
    // Unreachable: the schema's non-array branch always adds the list-required
    // issue, so a successful parse is always an array. The guard just narrows.
    throw new Error("playbook must be a list of plays");
  }
  const plays = normalizePlaybook(rawPlays);
  // Template-ref problems are hard errors: `{{ }}` and unprefixed `$var` are
  // silently wrong, so fail closed rather than shipping a broken playbook. Each
  // expanded/imported file is linted here at its own load (load-time chokepoint).
  const tmplProblems = plays.flatMap((pb) => lintTemplateRefs(pb));
  if (tmplProblems.length > 0) {
    throw new Error(
      `[rolecall:template-refs] ${tmplProblems.length} problem(s) in playbook:\n` +
        tmplProblems.map((p) => `  - ${p.path}: ${p.message}`).join("\n"),
    );
  }
  return plays;
}

/**
 * Maximum import/include nesting depth before {@link loadPlaybookFile} aborts. A
 * sane bound that prevents runaway recursion even if the cycle guard were bypassed.
 */
const MAX_IMPORT_DEPTH = 32;

/**
 * Honor a task's own `hosts:` if present, otherwise inherit the parent play's hosts.
 * Implements the documented hosts-inheritance default for imported/included tasks.
 * @param task A normalized task coming from an imported/included playbook file.
 * @param parentHosts The hosts of the play that is importing/including `task`.
 * @returns A copy of `task` with its effective `hosts` resolved.
 */
function inheritHosts(
  task: NormalizedTask,
  parentHosts: string[],
): NormalizedTask {
  return { ...task, hosts: task.hosts ?? parentHosts };
}

/**
 * Recursively load a playbook file from disk and expand every `imports` (play-level)
 * and `include_tasks` (task-level) directive in place. Each referenced file is loaded
 * through {@link loadPlaybook} (so it is validated + template-ref linted) and its tasks
 * are spliced into the importing play. A `visited` set keyed by absolute path plus a
 * max-depth cap guard against circular imports/includes (which throw a bounded error).
 * @param fileAbs Absolute path of the playbook file to load and expand.
 * @param source Project VFS used to read file bytes.
 * @param visited Absolute paths already on the current load stack (cycle guard).
 * @param depth Current import/include nesting depth.
 * @returns The fully-expanded array of normalized plays for `fileAbs`.
 */
async function loadAndExpand(
  fileAbs: string,
  source: ProjectSource,
  visited: Set<string>,
  depth: number,
): Promise<NormalizedPlaybook[]> {
  if (visited.has(fileAbs)) {
    throw new Error(
      `[rolecall:circular-import] circular import/include detected: ${fileAbs} is already on the load stack`,
    );
  }
  visited.add(fileAbs);
  if (depth > MAX_IMPORT_DEPTH) {
    throw new Error(
      `[rolecall:circular-import] import/include depth exceeded maximum of ${MAX_IMPORT_DEPTH} at ${fileAbs}`,
    );
  }
  const text = await source.readText(fileAbs);
  const plays = loadPlaybook(text);
  for (const play of plays) {
    await expandPlay(play, fileAbs, source, visited, depth);
  }
  return plays;
}

// --- Role composition ------------------------------------------
//
// A play's `roles:` list names roles resolved to directories whose tasks/defaults/
// vars/handlers are merged into the play at load time — exactly like `imports`, but
// contributing a layered var set and splicing tasks BEFORE the play's own tasks.
// Reuses the loader's VFS read seam (`source.readText`) so non-disk sources work too.

/** Read one file through the VFS seam, returning null instead of throwing when absent. */
async function tryReadText(source: ProjectSource, absPath: string): Promise<string | null> {
  try {
    return await source.readText(absPath);
  } catch {
    return null;
  }
}

/** Try each candidate path (joined under `dirAbs`) in order; return the first readable one, else null. */
async function firstReadable(
  source: ProjectSource,
  dirAbs: string,
  ...candidates: string[][]
): Promise<string | null> {
  for (const segments of candidates) {
    const text = await tryReadText(source, join(dirAbs, ...segments));
    if (text !== null) return text;
  }
  return null;
}

/** Parse an OPTIONAL yaml file into a plain record map; absent or non-map yields `{}`. */
async function readOptionalMap(
  source: ProjectSource,
  dirAbs: string,
  ...candidates: string[][]
): Promise<Record<string, unknown>> {
  const text = await firstReadable(source, dirAbs, ...candidates);
  if (text === null) return {};
  const data = parseYaml(text);
  return isPlainRecord(data) ? data : {};
}

/** Like {@link firstReadable} but also returns the path of the first readable candidate. */
async function firstReadableOrigin(
  source: ProjectSource,
  dirAbs: string,
  ...candidates: string[][]
): Promise<{ text: string; path: string } | null> {
  for (const segments of candidates) {
    const abs = join(dirAbs, ...segments);
    const text = await tryReadText(source, abs);
    if (text !== null) return { text, path: abs };
  }
  return null;
}

/**
 * @summary Parse an OPTIONAL yaml file into an origin-tagged var map for provenance tracing.
 * @param tier Precedence tier to stamp on every entry (e.g. `role-default`).
 * @returns Var name → origin (value + file), or `{}` when the file is absent/non-map.
 */
async function readOptionalMapOrigins(
  source: ProjectSource,
  dirAbs: string,
  tier: VarTier,
  ...candidates: string[][]
): Promise<VarOriginMap> {
  const found = await firstReadableOrigin(source, dirAbs, ...candidates);
  if (found === null) return {};
  const data = parseYaml(found.text);
  const map: VarOriginMap = {};
  if (isPlainRecord(data)) {
    for (const [k, v] of Object.entries(data)) map[k] = { value: v, tier, file: found.path };
  }
  return map;
}

/** True when a role name points inside the tree rather than naming a bare role (`a/b` / `.x`). */
function looksLikeRolePath(name: string): boolean {
  return name.includes("/") || name.startsWith(".");
}

/**
 * Resolve a role name to its directory. Path-like names resolve against the playbook's
 * own directory; otherwise `<playbookDir>/roles/<name>` is tried first, then
 * `<root>/roles/<name>`. A role only counts as resolved once a readable tasks entrypoint
 * exists, so unresolvable names (or those lacking `tasks/main.yml`) surface below.
 * @param roleName Role identifier from the play's `roles:` list.
 * @param playbookDir Absolute directory holding the declaring playbook file.
 * @param root Source root serving as the second search base.
 * @param source Project VFS used to probe candidate files.
 * @returns The resolved role directory absolute path, or undefined when none qualifies.
 */
async function resolveRoleDirectory(
  roleName: string,
  playbookDir: string,
  root: string,
  source: ProjectSource,
): Promise<string | undefined> {
  const candidates = looksLikeRolePath(roleName)
    ? [resolve(playbookDir, roleName)]
    : [resolve(playbookDir, "roles", roleName), resolve(root, "roles", roleName)];
  for (const dir of candidates) {
    if ((await firstReadable(source, dir, ["tasks", "main.yml"], ["tasks", "main.yaml"])) !== null) {
      return dir;
    }
  }
  return undefined;
}

/** Normalized contribution of a single role: composed normal+handler tasks plus merged defaults/vars. */
interface RoleContribution {
  /** Normalized tasks from `tasks/main.yml`, followed by handler tasks from `handlers/main.yml`. */
  tasks: NormalizedTask[];
  /** Deep-merged defaults across every role seen so far (lowest precedence tier). */
  defaults: Record<string, unknown>;
  /** Deep-merged vars across every role seen so far (middle precedence tier). */
  vars: Record<string, unknown>;
  /** Declared var entries discovered in this role's defaults/var-manifest.yml. */
  manifest: VarManifestEntry[];
  /** Origin-tagged role defaults (tier `role-default`) for provenance tracing. */
  defaultsOrigins: VarOriginMap;
  /** Origin-tagged role vars (tier `role-vars`) for provenance tracing. */
  varsOrigins: VarOriginMap;
}

/**
 * Load and normalize a resolved role's optional files through the VFS seam. `tasks/main.yml`
 * is REQUIRED (its list is normalized task-by-task via {@link CanonicalTaskSchema}/normalizeTask);
 * `handlers/main.yml` (task list carrying `listen`), `defaults/main.yml`, and `vars/main.yml`
 * (maps) are all optional. Handler tasks are returned alongside normal tasks — the executor
 * separates them later and flushes only on notify.
 * @param dirAbs Resolved role directory.
 * @param source Project VFS used to read role files.
 * @returns The role's normalized task list plus merged defaults/vars maps.
 */
async function loadRoleFiles(
  dirAbs: string,
  source: ProjectSource,
): Promise<RoleContribution> {
  const tasksText = await firstReadable(source, dirAbs, ["tasks", "main.yml"], ["tasks", "main.yaml"]);
  if (tasksText === null) {
    throw new Error(
      `[rolecall:roles] role has no readable ${join(dirAbs, "tasks", "main.yml")} (expected a YAML list of tasks)`,
    );
  }
  const rawTasks = parseYaml(tasksText);
  if (!Array.isArray(rawTasks)) {
    throw new Error(`[rolecall:roles] ${join(dirAbs, "tasks", "main.yml")} must be a YAML list of tasks`);
  }
  const tasks = rawTasks.map((item) => validate<NormalizedTask, RawTask>(item, CanonicalTaskSchema, normalizeTask));

  // handlers/main.yml is optional; each result keeps its `listen` field intact.
  let handlerTasks: NormalizedTask[] = [];
  const handlersText = await firstReadable(source, dirAbs, ["handlers", "main.yml"], ["handlers", "main.yaml"]);
  if (handlersText !== null) {
    const rawHandlers = parseYaml(handlersText);
    if (!Array.isArray(rawHandlers)) {
      throw new Error(`[rolecall:roles] ${join(dirAbs, "handlers", "main.yml")} must be a YAML list of tasks`);
    }
    handlerTasks = rawHandlers.map((item) => validate<NormalizedTask, RawTask>(item, CanonicalTaskSchema, normalizeTask));
  }

  // Tag every role task with its directory so modules can resolve role-relative
  // paths (e.g. copy `content.template_file` -> roles/<role>/templates).
  for (const t of [...tasks, ...handlerTasks]) t.roleDir = dirAbs;

  let defaults = await readOptionalMap(source, dirAbs, ["defaults", "main.yml"], ["defaults", "main.yaml"]);
  const vars = await readOptionalMap(source, dirAbs, ["vars", "main.yml"], ["vars", "main.yaml"]);
  const defaultsOriginPath = (await firstReadableOrigin(source, dirAbs, ["defaults", "main.yml"], ["defaults", "main.yaml"]))?.path;
  const varsOriginPath = (await firstReadableOrigin(source, dirAbs, ["vars", "main.yml"], ["vars", "main.yaml"]))?.path;

  let defaultsOrigins: VarOriginMap = {};
  if (defaultsOriginPath) {
    for (const [k, v] of Object.entries(defaults)) defaultsOrigins[k] = { value: v, tier: "role-default", file: defaultsOriginPath };
  }
  const varsOrigins: VarOriginMap = {};
  if (varsOriginPath) {
    for (const [k, v] of Object.entries(vars)) varsOrigins[k] = { value: v, tier: "role-vars", file: varsOriginPath };
  }

  // Discover the role's declared var manifest (defaults/var-manifest.yml) and seed its
  // declared `default` values into the role defaults layer (explicit defaults/main.yml wins).
  const manifestOrigin = await firstReadableOrigin(source, dirAbs, ["defaults", "var-manifest.yml"], ["defaults", "var-manifest.yaml"]);
  let manifest: VarManifestEntry[] = [];
  if (manifestOrigin !== null) {
    manifest = parseManifestYaml(manifestOrigin.text).map((e) => ({ ...e, declaredIn: manifestOrigin.path }));
    const manifestDefaults: Record<string, unknown> = {};
    const manifestDefaultsOrigins: VarOriginMap = {};
    for (const entry of manifest) {
      if (entry.default !== undefined && !Object.prototype.hasOwnProperty.call(defaults, entry.name)) {
        manifestDefaults[entry.name] = entry.default;
        manifestDefaultsOrigins[entry.name] = { value: entry.default, tier: "role-default", file: manifestOrigin.path };
      }
    }
    if (Object.keys(manifestDefaults).length > 0) {
      defaults = deepMerge(manifestDefaults, defaults);
      defaultsOrigins = { ...defaultsOrigins, ...manifestDefaultsOrigins };
    }
  }

  return { tasks: [...tasks, ...handlerTasks], defaults, vars, manifest, defaultsOrigins, varsOrigins };
}

/**
 * Compose an entire play's `roles:` list in listed order. Later roles override earlier ones
 * at the same var tier (deep-merge). Tasks accumulate in listed order; defaults merge into one
 * accumulated map, vars into another.
 * @param play Play whose `roles:` are being expanded.
 * @param playbookDir Absolute directory holding the declaring playbook file.
 * @param root Source root serving as the second role-search base.
 * @param source Project VFS used to read role files.
 * @returns Accumulated role tasks plus the deep-merged defaults/vars maps.
 * @throws {Error} When any named role cannot be resolved.
 */
async function composeRoles(
  play: NormalizedPlaybook,
  playbookDir: string,
  root: string,
  source: ProjectSource,
): Promise<{ tasks: NormalizedTask[]; defaults: Record<string, unknown>; vars: Record<string, unknown>; manifest: VarManifestEntry[]; defaultsOrigins: VarOriginMap; varsOrigins: VarOriginMap }> {
  let collectedTasks: NormalizedTask[] = [];
  let accumulatedDefaults: Record<string, unknown> = {};
  let accumulatedVars: Record<string, unknown> = {};
  let accumulatedManifest: VarManifestEntry[] = [];
  let accumulatedDefaultsOrigins: VarOriginMap = {};
  let accumulatedVarsOrigins: VarOriginMap = {};

  for (const roleName of play.roles ?? []) {
    const dirAbs = await resolveRoleDirectory(roleName, playbookDir, root, source);
    if (dirAbs === undefined) {
      throw new Error(
        `[rolecall:roles] could not resolve role '${roleName}' — expected a readable ` +
          `${join("roles", roleName, "tasks", "main.yml")} relative to the playbook or project root`,
      );
    }
    const contribution = await loadRoleFiles(dirAbs, source);
    collectedTasks.push(...contribution.tasks);
    accumulatedDefaults = deepMerge(accumulatedDefaults, contribution.defaults);
    accumulatedVars = deepMerge(accumulatedVars, contribution.vars);
    accumulatedManifest = accumulatedManifest.concat(contribution.manifest);
    accumulatedDefaultsOrigins = { ...accumulatedDefaultsOrigins, ...contribution.defaultsOrigins };
    accumulatedVarsOrigins = { ...accumulatedVarsOrigins, ...contribution.varsOrigins };
  }

  return { tasks: collectedTasks, defaults: accumulatedDefaults, vars: accumulatedVars, manifest: accumulatedManifest, defaultsOrigins: accumulatedDefaultsOrigins, varsOrigins: accumulatedVarsOrigins };
}

// --- Deep-merge helper ------------------------------------------------------

/** @summary Deeply merge plain records left-to-right, later layers winning on key collisions (pure). Nested plain objects recurse; scalars, arrays, and null replace wholesale. Inputs are never mutated. Used to layer role defaults < role vars < play vars at load time. */
export function deepMerge(
  ...layers: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const layer of layers) {
    if (!isPlainRecord(layer)) continue;
    for (const [key, value] of Object.entries(layer)) {
      const existing = out[key];
      if (isPlainRecord(existing) && isPlainRecord(value)) {
        out[key] = deepMerge(existing, value);
      } else {
        out[key] = value;
      }
    }
  }
  return out;
}

/**
 * Expand a single play's `imports` and `include_tasks` directives in place. `imports`
 * entries resolve against the project source root; `include_tasks` entries resolve
 * against the directory containing the file currently being expanded.
 * @param play The play to expand (mutated: its `tasks` are replaced by the expanded list).
 * @param fileAbs Absolute path of the file that declared `play`.
 * @param source Project VFS used to read referenced file bytes.
 * @param visited Absolute paths already on the current load stack (cycle guard).
 * @param depth Current import/include nesting depth.
 */
async function expandPlay(
  play: NormalizedPlaybook,
  fileAbs: string,
  source: ProjectSource,
  visited: Set<string>,
  depth: number,
): Promise<void> {
  const fileDir = dirname(fileAbs);
  const expanded: NormalizedTask[] = [];

  // --- Role composition: gather each named role's tasks/handlers and
  // merge their defaults/vars BEFORE the play's own tasks are spliced. Roles contribute
  // only tasks/handlers/defaults/vars and are never recursed as separate playbook files,
  // so they need no cycle guard. Handled before the include_tasks loop so those still run
  // over the play's OWN tasks only (role tasks are prepended as a head afterwards).
  let roleHead: NormalizedTask[] = [];
  if (play.roles !== undefined && play.roles.length > 0) {
    const composed = await composeRoles(play, fileDir, source.root, source);
    roleHead = composed.tasks.map((t) => inheritHosts(t, play.hosts));
    // D1 precedence: role defaults (absolute lowest tier) are kept separate so the
    // executor can layer them BELOW inventory host/group vars; role vars + play vars merge.
    play.roleDefaults = composed.defaults;
    play.vars = deepMerge(composed.vars, play.vars ?? {});
    play.varManifests = composed.manifest;
    // Origin-tagged role layer (role-defaults < role-vars) for the `vars trace` command.
    play.varOrigins = { ...composed.defaultsOrigins, ...composed.varsOrigins };
  }

  // Playbook-root var manifest (var-manifest.yml beside the playbook file): its declared
  // defaults seed a playbook-level defaults layer and its entries extend the registry.
  const pbManifestOrigin = await firstReadableOrigin(source, fileDir, ["var-manifest.yml"], ["var-manifest.yaml"]);
  if (pbManifestOrigin !== null) {
    const pbManifest = parseManifestYaml(pbManifestOrigin.text).map((e) => ({ ...e, declaredIn: pbManifestOrigin.path }));
    const pbManifestDefaults: Record<string, unknown> = {};
    for (const entry of pbManifest) {
      if (entry.default !== undefined) pbManifestDefaults[entry.name] = entry.default;
    }
    if (Object.keys(pbManifestDefaults).length > 0) {
      play.vars = deepMerge(pbManifestDefaults, play.vars ?? {});
    }
    play.varManifests = [...(play.varManifests ?? []), ...pbManifest];
  }

  // De-duplicate the layered registry and hard-fail on conflicting shape declarations.
  if (play.varManifests !== undefined && play.varManifests.length > 0) {
    play.varManifests = mergeManifests(play.varManifests);
  }

  // --- Task-level include_tasks: splice included tasks at the directive's index.
  for (const task of play.tasks) {
    if (task.include_tasks === undefined) {
      expanded.push(task);
      continue;
    }
    const files = Array.isArray(task.include_tasks)
      ? task.include_tasks
      : [task.include_tasks];
    for (const entry of files) {
      const incAbs = resolve(fileDir, entry);
      const incPlays = await loadAndExpand(incAbs, source, visited, depth + 1);
      for (const incPlay of incPlays) {
        for (const incTask of incPlay.tasks) {
          expanded.push(inheritHosts(incTask, play.hosts));
        }
      }
    }
  }

  // --- Play-level imports: splice imported tasks at the end of this play's tasks.
  if (play.imports !== undefined) {
    for (const entry of play.imports) {
      const impAbs = resolve(source.root, entry);
      const impPlays = await loadAndExpand(impAbs, source, visited, depth + 1);
      for (const impPlay of impPlays) {
        for (const impTask of impPlay.tasks) {
          expanded.push(inheritHosts(impTask, play.hosts));
        }
      }
    }
    // The directive is consumed by expansion; drop it so the expanded play is
    // self-contained (and would not double-expand if serialized + re-loaded).
    play.imports = undefined;
  }

  // Assemble the final task list: composed role tasks first, then the play's own
  // (include-expanded) and imported tasks. Handler tasks ride along among the head;
  // the executor later filters them out via `listen` and flushes on notify only.
  play.tasks = roleHead.length > 0 ? [...roleHead, ...expanded] : expanded;

  // Preserve the applied role names for the `play.roles` namespace (ADR 0013 §6)
  // before consuming the `roles` directive after expansion (reload-safety). Only
  // set when a `roles:` directive existed, so role-less plays gain no new field
  // (keeps serialize(normalized) === normalized round-trip stable).
  if (play.roles !== undefined) {
    play.appliedRoleNames = play.roles;
    play.roles = undefined;
  }
}

/**
 * Read a playbook YAML file, expand `imports`/`include_tasks` at load time, and return
 * its normalized array of plays. Expansion is the single chokepoint for `import_playbook`
 * / `include_tasks`, so downstream consumers (skeleton, task counts, executor) always see
 * the fully-resolved task list. Reads through the VFS seam so a non-disk
 * {@link ProjectSource} can serve playbooks unchanged. The document root must be a
 * top-level list of plays; a bare object is rejected by {@link loadPlaybook}.
 * @param path Path to the playbook YAML file (relative paths resolve against the source root).
 * @param source Optional project VFS; defaults to reading from the current working directory.
 * @returns The normalized, fully-expanded array of plays.
 */
export async function loadPlaybookFile(
  path: string,
  source: ProjectSource = new FsProjectSource(process.cwd()),
): Promise<NormalizedPlaybook[]> {
  const fileAbs = source.resolveImportablePath(path);
  const plays = await loadAndExpand(fileAbs, source, new Set<string>(), 0);
  // Emit (but never throw on) idempotency warnings AFTER expansion so every
  // expanded task is inspected once.
  for (const pb of plays) {
    for (const w of lintPlaybookIdempotency(pb)) {
      console.warn(`[rolecall:idempotency] ${w.warning} (task: ${w.task})`);
    }
  }
  return plays;
}

// --- Inventory --------------------------------------------------------------

/**
 * @summary Source format of an inventory, as recognized by {@link loadInventory}.
 * `"ini"` = Ansible INI (`[group]` headers), `"ansible-yaml"` = Ansible's
 * `all:`-rooted YAML, `"native"` = RoleCall's `groups:` YAML.
 */
export type InventoryFormat = "ini" | "ansible-yaml" | "native";

/**
 * @summary Detect how an inventory's text should be parsed. The rules are
 * deterministic — the same text + filename always yields the same result:
 *  1. A `.ini` extension, or content whose first non-blank, non-comment line
 *     opens with `[` (an Ansible `[group]` header), is `"ini"`.
 *  2. Otherwise the text is parsed as YAML; a mapping root carrying an `all` key
 *     and no `groups` key is Ansible's canonical layout → `"ansible-yaml"`.
 *  3. Everything else (a `groups:` root, or YAML that fails to parse) is
 *     `"native"`, so the strict native schema surfaces the usual error.
 * @param text Raw inventory text.
 * @param filename Optional source path; only its extension is consulted as a hint.
 * @returns The detected {@link InventoryFormat}.
 */
export function detectInventoryFormat(text: string, filename = ""): InventoryFormat {
  if (extname(filename).toLowerCase() === ".ini" || looksLikeIniInventory(text)) {
    return "ini";
  }
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch {
    // Invalid YAML: fall through to the native path so it re-parses and reports
    // the YAML error (or the schema error) exactly as before.
    return "native";
  }
  return isAnsibleYamlInventory(data) ? "ansible-yaml" : "native";
}

/**
 * @summary Parse + validate raw inventory text into normalized groups, auto-detecting
 * the source format. RoleCall-native `groups:` YAML still validates against the strict
 * {@link InventorySchema}; Ansible INI and Ansible `all:`-rooted YAML are parsed by
 * `src/inventory/ansible.ts` and normalized into the same shape (children + host_vars),
 * so the engine's hierarchical precedence applies unchanged.
 * @param text Raw inventory text (native YAML, Ansible INI, or Ansible YAML).
 * @param filename Optional source path; its extension is a detection hint.
 * @returns The normalized inventory.
 * @throws {ZodError} When native YAML fails schema validation.
 * @throws {AnsibleInventoryError} When an Ansible inventory is malformed.
 */
export function loadInventory(text: string, filename = ""): NormalizedInventory {
  switch (detectInventoryFormat(text, filename)) {
    case "ini":
      return parseAnsibleIniInventory(text);
    case "ansible-yaml":
      return parseAnsibleYamlInventory(text);
    default:
      return validate<NormalizedInventory, RawInventory>(
        parseYaml(text),
        InventorySchema,
        normalizeInventory,
      );
  }
}

/** Parsed `group_vars/` + `host_vars/` contribution discovered next to an inventory file. */
export interface DirectoryVars {
  /** group name -> var map (file `group_vars/<group>.yaml` becomes group `<group>`). */
  groupVarsByGroup: Record<string, Record<string, unknown>>;
  /** host name -> var map (file `host_vars/<host>.yaml` becomes host `<host>`). */
  hostVarsByHost: Record<string, Record<string, unknown>>;
}

/** True iff `value` is a plain (non-array, non-null) object — the only safe var map shape. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * Discover directory-adjacent `group_vars/` and `host_vars/` var files next to an
 * inventory and parse them through the VFS seam. Group/host names are derived from the
 * file name with its extension stripped (`group_vars/web.yaml` -> group `web`). Discovery
 * is graceful: a missing directory raises no error and yields an empty map for that layer,
 * so inventories without these directories behave exactly as before.
 * @param inventoryPath Inventory file path (used only to anchor discovery; the actual
 *   scan is performed under `source.root`, which callers root at `dirname(inventoryPath)`).
 * @param source Project VFS rooted at the inventory file's directory.
 * @returns Parsed group/host var maps keyed by group/host name.
 */
export async function resolveDirectoryVars(
  inventoryPath: string,
  source: ProjectSource,
): Promise<DirectoryVars> {
  void inventoryPath; // discovery is driven entirely by `source.root`
  const groupVarsByGroup: Record<string, Record<string, unknown>> = {};
  const hostVarsByHost: Record<string, Record<string, unknown>> = {};

  const groupFiles = await source.listFiles("group_vars/*.yaml");
  for (const file of groupFiles) {
    const name = basename(file, extname(file));
    if (!name) continue;
    const text = await source.readText(file);
    const data = parseYaml(text);
    groupVarsByGroup[name] = isPlainRecord(data) ? data : {};
  }

  const hostFiles = await source.listFiles("host_vars/*.yaml");
  for (const file of hostFiles) {
    const name = basename(file, extname(file));
    if (!name) continue;
    const text = await source.readText(file);
    const data = parseYaml(text);
    hostVarsByHost[name] = isPlainRecord(data) ? data : {};
  }

  return { groupVarsByGroup, hostVarsByHost };
}

/**
 * Read an inventory file and return its normalized form, auto-detecting the source
 * format (native `groups:` YAML, Ansible INI, or Ansible `all:`-rooted YAML) via
 * {@link detectInventoryFormat}. Reads through the VFS seam so a non-disk
 * {@link ProjectSource} can serve inventories unchanged. Backward-compatible: with no
 * `source` the default {@link FsProjectSource(cwd)} reads exactly as before.
 * @param path Path to the inventory file (relative paths resolve against the source root).
 * @param source Optional project VFS; defaults to reading from the current working directory.
 * @returns The normalized inventory.
 */
export async function loadInventoryFile(
  path: string,
  source: ProjectSource = new FsProjectSource(process.cwd()),
): Promise<NormalizedInventory> {
  // Read the inventory relative to the source root so a source rooted at the
  // inventory's own directory (e.g. `new FsProjectSource(dirname(path))`) resolves the
  // same `path` string correctly regardless of whether it is absolute or cwd-relative.
  const readPath = relative(source.root, resolve(path)) || path;
  const text = await source.readText(readPath);
  return loadInventory(text, path);
}

export type { ZodError };
