// isolation.yaml loader (ADR 0025): per-project restricted-code approvals,
// filesystem grants, and egress whitelist entries.
//
// The file is operator-owned and lives outside the project (ADR 0023 config dir).
// Project keys are canonical VFS URIs, never bare paths. Missing file = no
// approvals (deny restricted code). Malformed or insecure files fail closed.

import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dump, load as yamlLoad } from "js-yaml";

import { resolveInstallLayout } from "../install/layout";
import type { EgressRule, EgressScope } from "./egress";
import type { IsolationMount } from "./types";

export interface ProjectTemplatePolicy {
  allowRestrictedCode: boolean;
  allowRestrictedHelpers: boolean;
}

export interface ProjectGrant {
  /** Canonical absolute source path (symlinks resolved when it exists). */
  source: string;
  /** Absolute path inside the sandbox. */
  target: string;
  mode: "ro" | "rw";
  /** Missing source warns rather than fails the run. */
  optional: boolean;
  /** Socket grants must opt in explicitly. */
  type: "dir" | "file" | "socket";
}

export interface ProjectPolicy {
  templates: ProjectTemplatePolicy;
  grants: ProjectGrant[];
  egress: EgressRule[];
}

export interface IsolationConfig {
  version: 1;
  projects: Record<string, ProjectPolicy>;
}

/** Advisory access requested by a project itself; never auto-applied. */
export interface ProjectRequest {
  grants: ProjectGrant[];
  egress: EgressRule[];
}

const EMPTY: IsolationConfig = { version: 1, projects: {} };
const EMPTY_POLICY: ProjectPolicy = {
  templates: { allowRestrictedCode: false, allowRestrictedHelpers: false },
  grants: [],
  egress: [],
};

const DENIED_SOURCES = new Set(["/", "/proc", "/sys", "/dev", "/root"]);

/** Resolve the operator config path: env override, else the ADR 0023 config dir. */
export function resolveIsolationConfigPath(): string {
  const override = process.env["ROLECALL_ISOLATION_CONFIG"];
  if (override && override.trim()) return resolve(override);
  return resolve(resolveInstallLayout().configDir, "isolation.yaml");
}

/** Normalize a project key/URI: file URLs canonicalize symlinks; other schemes keep their href. */
export function normalizeProjectUri(uri: string): string {
  const url = new URL(uri);
  if (url.protocol !== "file:") return url.href;
  let path = fileURLToPath(url);
  try {
    path = realpathSync.native(path);
  } catch {
    path = resolve(path);
  }
  return pathToFileURL(path).href;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

/** Canonicalize a grant source: expand ~, resolve relative paths, and follow symlinks when present. */
export function canonicalGrantSource(raw: string): string {
  const expanded = expandHome(raw.trim());
  const absolute = resolve(expanded);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function parseGrant(value: unknown, where: string): ProjectGrant {
  const grant = asRecord(value);
  if (!grant) throw new Error(`${where}: grant entries must be mappings`);
  const rawSource = grant["source"];
  if (typeof rawSource !== "string" || rawSource.trim() === "") {
    throw new Error(`${where}: grant.source must be a non-empty path`);
  }
  const source = canonicalGrantSource(rawSource);
  if (DENIED_SOURCES.has(source)) throw new Error(`${where}: refusing to grant '${source}'`);
  const rawType = grant["type"];
  const type = rawType === undefined ? "dir" : rawType;
  if (type !== "dir" && type !== "file" && type !== "socket") {
    throw new Error(`${where}: grant.type must be dir, file, or socket`);
  }
  if (type !== "socket" && (basename(source).endsWith(".sock") || basename(source) === "docker.sock")) {
    throw new Error(`${where}: socket grant '${source}' requires type: socket`);
  }
  const rawTarget = grant["target"];
  const target = typeof rawTarget === "string" && rawTarget.trim() !== ""
    ? resolve(expandHome(rawTarget))
    : join("/mnt", basename(source) || "grant");
  if (!isAbsolute(target) || target === "/") {
    throw new Error(`${where}: grant.target must be an absolute path other than '/'`);
  }
  const rawMode = grant["mode"];
  if (rawMode !== undefined && rawMode !== "ro" && rawMode !== "rw") {
    throw new Error(`${where}: grant.mode must be ro or rw`);
  }
  const rawOptional = grant["optional"];
  if (rawOptional !== undefined && typeof rawOptional !== "boolean") {
    throw new Error(`${where}: grant.optional must be boolean`);
  }
  return {
    source,
    target,
    mode: rawMode === "rw" ? "rw" : "ro",
    optional: rawOptional === true,
    type,
  };
}

/** Build and validate a grant from CLI inputs. */
export function makeGrant(input: {
  source: string;
  target?: string;
  mode?: "ro" | "rw";
  optional?: boolean;
  type?: "dir" | "file" | "socket";
}): ProjectGrant {
  return parseGrant(input, "grant");
}

function parseGrants(value: unknown, where: string): ProjectGrant[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${where}: grants must be a list`);
  return value.map((entry) => parseGrant(entry, where));
}

function parseEgress(value: unknown, where: string): EgressRule[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${where}: egress must be a list`);
  return value.map((entry) => {
    const rule = asRecord(entry);
    if (!rule) throw new Error(`${where}: egress entries must be mappings`);
    const host = rule["host"];
    if (typeof host !== "string" || host.trim() === "") {
      throw new Error(`${where}: egress.host must be a non-empty host, IP, or CIDR`);
    }
    const rawPorts = rule["ports"];
    let ports: number[] | undefined;
    if (rawPorts !== undefined) {
      if (!Array.isArray(rawPorts)) throw new Error(`${where}: egress.ports must be a list`);
      ports = rawPorts.map((p) => {
        const n = Number(p);
        if (!Number.isInteger(n) || n < 1 || n > 65535) {
          throw new Error(`${where}: egress port '${String(p)}' is invalid`);
        }
        return n;
      });
    }
    const protocol = rule["protocol"];
    if (protocol !== undefined && protocol !== "tcp") {
      throw new Error(`${where}: egress.protocol must be tcp`);
    }
    const scope = rule["scope"];
    if (scope !== undefined && scope !== "shell" && scope !== "module" && scope !== "all") {
      throw new Error(`${where}: egress.scope must be shell, module, or all`);
    }
    return {
      host: host.trim().toLowerCase(),
      ...(ports ? { ports } : {}),
      protocol: "tcp",
      scope: (scope ?? "shell") as EgressScope,
    };
  });
}

function parsePolicy(value: unknown, where: string): ProjectPolicy {
  const project = asRecord(value);
  if (!project) throw new Error(`${where}: project must be a mapping`);
  const templates = project["templates"];
  let allowRestrictedCode = false;
  let allowRestrictedHelpers = false;
  if (templates !== undefined) {
    const t = asRecord(templates);
    if (!t) throw new Error(`${where}.templates must be a mapping`);
    const code = t["allow_restricted_code"];
    const helpers = t["allow_restricted_helpers"];
    if (code !== undefined && typeof code !== "boolean") {
      throw new Error(`${where}.templates.allow_restricted_code must be boolean`);
    }
    if (helpers !== undefined && typeof helpers !== "boolean") {
      throw new Error(`${where}.templates.allow_restricted_helpers must be boolean`);
    }
    allowRestrictedCode = code === true;
    allowRestrictedHelpers = helpers === true;
  }
  return {
    templates: { allowRestrictedCode, allowRestrictedHelpers },
    grants: parseGrants(project["grants"], where),
    egress: parseEgress(project["egress"], where),
  };
}

/** Load and validate isolation.yaml. Missing file is an empty policy; errors fail closed. */
export function loadIsolationConfig(path = resolveIsolationConfigPath()): IsolationConfig {
  if (!existsSync(path)) return EMPTY;

  if (process.platform !== "win32") {
    const mode = statSync(path).mode & 0o777;
    if ((mode & 0o022) !== 0) {
      throw new Error(
        `isolation config ${path} is group/world writable (mode ${mode.toString(8)}); refusing to trust it`,
      );
    }
  }

  const parsed = asRecord(yamlLoad(readFileSync(path, "utf8")));
  if (!parsed) throw new Error(`isolation config ${path} must be a YAML mapping`);
  if (parsed["version"] !== 1) throw new Error(`isolation config ${path} requires version: 1`);
  const projects = parsed["projects"];
  if (projects === undefined || projects === null) return EMPTY;
  const projectMap = asRecord(projects);
  if (!projectMap) throw new Error(`isolation config ${path}: 'projects' must be a mapping`);

  const out: IsolationConfig = { version: 1, projects: {} };
  for (const [rawKey, value] of Object.entries(projectMap)) {
    let key: string;
    try {
      key = normalizeProjectUri(rawKey);
    } catch {
      throw new Error(`isolation config ${path}: project key '${rawKey}' must be a VFS URI (e.g. file:///abs/path)`);
    }
    out.projects[key] = parsePolicy(value, `isolation config ${path}: project '${rawKey}'`);
  }
  return out;
}

/** Write isolation.yaml atomically with owner-only permissions. */
export function saveIsolationConfig(config: IsolationConfig, path = resolveIsolationConfigPath()): void {
  const projects: Record<string, unknown> = {};
  for (const [uri, policy] of Object.entries(config.projects)) {
    projects[uri] = {
      templates: {
        allow_restricted_code: policy.templates.allowRestrictedCode,
        allow_restricted_helpers: policy.templates.allowRestrictedHelpers,
      },
      grants: policy.grants.map((g) => ({
        source: g.source,
        target: g.target,
        mode: g.mode,
        optional: g.optional,
        type: g.type,
      })),
      egress: policy.egress.map((e) => ({
        host: e.host,
        ...(e.ports ? { ports: e.ports } : {}),
        protocol: e.protocol ?? "tcp",
        scope: e.scope ?? "shell",
      })),
    };
  }
  const body = dump({ version: 1, projects }, { noRefs: true, lineWidth: 120 });
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, body, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/** Approval lookup for a canonical project VFS URI. Defaults to deny. */
export function approvalFor(config: IsolationConfig, projectUri: string): ProjectTemplatePolicy {
  return policyFor(config, projectUri).templates;
}

/** Full per-project policy lookup (templates + grants + egress); defaults empty. */
export function policyFor(config: IsolationConfig, projectUri: string): ProjectPolicy {
  let key: string;
  try {
    key = normalizeProjectUri(projectUri);
  } catch {
    return EMPTY_POLICY;
  }
  return config.projects[key] ?? EMPTY_POLICY;
}

/** Ensure a project entry exists and return it for mutation. */
export function ensureProjectPolicy(config: IsolationConfig, projectUri: string): ProjectPolicy {
  const key = normalizeProjectUri(projectUri);
  const existing = config.projects[key];
  if (existing) return existing;
  const policy: ProjectPolicy = {
    templates: { allowRestrictedCode: false, allowRestrictedHelpers: false },
    grants: [],
    egress: [],
  };
  config.projects[key] = policy;
  return policy;
}

/** Read advisory access requested by a project (`.rolecall/isolation.yaml`); never applied. */
export function loadProjectRequest(projectDir: string): ProjectRequest {
  const path = join(projectDir, ".rolecall", "isolation.yaml");
  if (!existsSync(path)) return { grants: [], egress: [] };
  const parsed = asRecord(yamlLoad(readFileSync(path, "utf8")));
  if (!parsed) throw new Error(`project request ${path} must be a YAML mapping`);
  const projects = parsed["projects"];
  if (projects !== undefined && projects !== null) {
    const map = asRecord(projects);
    if (!map) throw new Error(`project request ${path}: 'projects' must be a mapping`);
    const key = pathToFileURL(resolve(projectDir)).href;
    for (const [rawKey, value] of Object.entries(map)) {
      let normalized: string;
      try {
        normalized = normalizeProjectUri(rawKey);
      } catch {
        continue;
      }
      if (normalized === normalizeProjectUri(key)) {
        const policy = parsePolicy(value, `project request ${path}`);
        return { grants: policy.grants, egress: policy.egress };
      }
    }
    return { grants: [], egress: [] };
  }
  return {
    grants: parseGrants(parsed["grants"], `project request ${path}`),
    egress: parseEgress(parsed["egress"], `project request ${path}`),
  };
}

/** Merge one-off CLI mounts (highest precedence) with approved project grants. */
export function mergeMounts(cli: IsolationMount[] | undefined, policy: ProjectPolicy): IsolationMount[] {
  const out: IsolationMount[] = [];
  const seen = new Set<string>();
  const add = (mount: IsolationMount): void => {
    const key = `${mount.source}\0${mount.target}\0${mount.mode}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(mount);
  };
  for (const mount of cli ?? []) add(mount);
  for (const grant of policy.grants) add({ source: grant.source, target: grant.target, mode: grant.mode });
  return out;
}

/** Merge one-off CLI egress rules with approved project entries. */
export function mergeEgress(cli: EgressRule[] | undefined, policy: ProjectPolicy): EgressRule[] {
  const out: EgressRule[] = [];
  const seen = new Set<string>();
  const add = (rule: EgressRule): void => {
    const key = `${rule.host}\0${(rule.ports ?? []).join(",")}\0${rule.scope ?? "shell"}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(rule);
  };
  for (const rule of cli ?? []) add(rule);
  for (const rule of policy.egress) add(rule);
  return out;
}

/** True when a string looks like a VFS URI rather than a bare path. */
export function isProjectUri(value: string): boolean {
  try {
    const url = new URL(value);
    return Boolean(url.protocol);
  } catch {
    return false;
  }
}

/** Turn a bare project directory into a canonical file:// project URI. */
export function projectUriFromDir(dir: string): string {
  return pathToFileURL(resolve(dir)).href;
}
