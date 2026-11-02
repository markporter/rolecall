// isolation.yaml loader (ADR 0025): per-project restricted-code approvals.
//
// The file is operator-owned and lives outside the project (ADR 0023 config dir).
// Project keys are canonical VFS URIs, never bare paths. Missing file = no
// approvals (deny restricted code). Malformed or insecure files fail closed.

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { load as yamlLoad } from "js-yaml";

import { resolveInstallLayout } from "../install/layout";

export interface ProjectTemplatePolicy {
  allowRestrictedCode: boolean;
  allowRestrictedHelpers: boolean;
}

export interface IsolationConfig {
  version: 1;
  projects: Record<string, { templates: ProjectTemplatePolicy }>;
}

const EMPTY: IsolationConfig = { version: 1, projects: {} };

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
    const project = asRecord(value);
    if (!project) throw new Error(`isolation config ${path}: project '${rawKey}' must be a mapping`);
    const templates = project["templates"];
    if (templates === undefined) {
      out.projects[key] = { templates: { allowRestrictedCode: false, allowRestrictedHelpers: false } };
      continue;
    }
    const t = asRecord(templates);
    if (!t) throw new Error(`isolation config ${path}: project '${rawKey}'.templates must be a mapping`);
    const code = t["allow_restricted_code"];
    const helpers = t["allow_restricted_helpers"];
    if (code !== undefined && typeof code !== "boolean") {
      throw new Error(`isolation config ${path}: project '${rawKey}'.templates.allow_restricted_code must be boolean`);
    }
    if (helpers !== undefined && typeof helpers !== "boolean") {
      throw new Error(`isolation config ${path}: project '${rawKey}'.templates.allow_restricted_helpers must be boolean`);
    }
    out.projects[key] = {
      templates: {
        allowRestrictedCode: code === true,
        allowRestrictedHelpers: helpers === true,
      },
    };
  }
  return out;
}

/** Approval lookup for a canonical project VFS URI. Defaults to deny. */
export function approvalFor(config: IsolationConfig, projectUri: string): ProjectTemplatePolicy {
  let key: string;
  try {
    key = normalizeProjectUri(projectUri);
  } catch {
    return { allowRestrictedCode: false, allowRestrictedHelpers: false };
  }
  return config.projects[key]?.templates ?? { allowRestrictedCode: false, allowRestrictedHelpers: false };
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

