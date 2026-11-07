// `rolecall isolation allow|revoke|list|allow-egress|revoke-egress` (ADR 0023/0025).
//
// Grants and egress entries are operator-owned: they live in isolation.yaml under
// the ADR 0023 config dir, keyed by canonical project VFS URI. A project's own
// `.rolecall/isolation.yaml` is advisory only; --from-request promotes one entry.

import { resolve } from "node:path";

import {
  canonicalGrantSource,
  ensureProjectPolicy,
  loadIsolationConfig,
  loadProjectRequest,
  makeGrant,
  projectUriFromDir,
  resolveIsolationConfigPath,
  saveIsolationConfig,
  type ProjectGrant,
  type ProjectRequest,
} from "../../isolation/config";
import { parseEgressSpecs, type EgressRule, type EgressScope } from "../../isolation/egress";
import { CliError, type CliResult, type GlobalFlags } from "../types";

export interface IsolationCommandOptions {
  /** Project directory override (tests). */
  cwd?: string;
  /** Config path override (tests). */
  configPath?: string;
}

function parseScope(raw: string | undefined): EgressScope {
  if (raw === undefined) return "shell";
  if (raw !== "shell" && raw !== "module" && raw !== "all") {
    throw new CliError(true, `--scope must be shell, module, or all (got '${raw}')`);
  }
  return raw;
}

function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliError(true, `--port must be 1-65535 (got '${raw}')`);
  }
  return port;
}

function grantKey(grant: ProjectGrant): string {
  return `${grant.source}\0${grant.target}\0${grant.mode}`;
}

function egressKey(rule: EgressRule): string {
  return `${rule.host}\0${(rule.ports ?? []).join(",")}\0${rule.scope ?? "shell"}`;
}

function unapproved(requests: ProjectRequest, policy: { grants: ProjectGrant[]; egress: EgressRule[] }): ProjectRequest {
  const grants = new Set(policy.grants.map(grantKey));
  const egress = new Set(policy.egress.map(egressKey));
  return {
    grants: requests.grants.filter((g) => !grants.has(grantKey(g))),
    egress: requests.egress.filter((e) => !egress.has(egressKey(e))),
  };
}

/** @summary Manage operator-owned isolation grants and egress entries for a project. @param sub Subcommand: allow, revoke, list, allow-egress, or revoke-egress. @param rest Positional arguments (source path or egress host). @param flags Parsed global flags. @param opts Test overrides for cwd/config path. @returns Structured IsolationResult. */
export async function runIsolationCommand(
  sub: string | undefined,
  rest: string[],
  flags: GlobalFlags,
  opts: IsolationCommandOptions = {},
): Promise<CliResult> {
  const projectDir = resolve(flags.project ?? opts.cwd ?? process.cwd());
  const projectUri = projectUriFromDir(projectDir);
  const configPath = opts.configPath ?? resolveIsolationConfigPath();
  const config = loadIsolationConfig(configPath);
  const policy = ensureProjectPolicy(config, projectUri);
  let changed = false;
  let note = "";

  switch (sub) {
    case "allow": {
      if (flags.ro === true && flags.rw === true) {
        throw new CliError(true, "--ro and --rw are mutually exclusive");
      }
      let grant: ProjectGrant;
      if (flags.fromRequest === true) {
        const requests = loadProjectRequest(projectDir);
        const wanted = rest[0] ? canonicalGrantSource(rest[0]) : undefined;
        const candidate = wanted ? requests.grants.find((g) => g.source === wanted) : requests.grants[0];
        if (!candidate) {
          throw new CliError(true, "--from-request found no matching grant request");
        }
        grant = makeGrant({
          source: candidate.source,
          target: flags.target ?? candidate.target,
          mode: flags.rw === true ? "rw" : flags.ro === true ? "ro" : candidate.mode,
          optional: candidate.optional,
          type: candidate.type,
        });
      } else {
        const source = rest[0];
        if (!source) throw new CliError(true, "isolation allow requires a <source> path");
        grant = makeGrant({
          source,
          ...(flags.target ? { target: flags.target } : {}),
          mode: flags.rw === true ? "rw" : "ro",
        });
      }
      const existing = policy.grants.find((g) => g.source === grant.source);
      if (existing) {
        policy.grants[policy.grants.indexOf(existing)] = grant;
        changed = grantKey(existing) !== grantKey(grant);
        note = changed ? "updated grant" : "grant already present";
      } else {
        policy.grants.push(grant);
        changed = true;
        note = "grant added";
      }
      if (flags.rw === true) note += "; rw grants are explicit and audited";
      break;
    }
    case "revoke": {
      const source = rest[0];
      if (!source) throw new CliError(true, "isolation revoke requires a <source> path");
      const canonical = canonicalGrantSource(source);
      const before = policy.grants.length;
      policy.grants = policy.grants.filter((g) => g.source !== canonical);
      changed = policy.grants.length !== before;
      note = changed ? "grant removed" : "no matching grant";
      break;
    }
    case "allow-egress": {
      const host = rest[0];
      if (!host) throw new CliError(true, "isolation allow-egress requires a <host>");
      const port = parsePort(flags.port);
      const rule: EgressRule = {
        host: host.trim().toLowerCase(),
        ...(port !== undefined ? { ports: [port] } : {}),
        protocol: "tcp",
        scope: parseScope(flags.scope),
      };
      const existing = policy.egress.find((e) => e.host === rule.host);
      if (existing) {
        policy.egress[policy.egress.indexOf(existing)] = rule;
        changed = egressKey(existing) !== egressKey(rule);
        note = changed ? "updated egress entry" : "egress entry already present";
      } else {
        policy.egress.push(rule);
        changed = true;
        note = "egress entry added";
      }
      break;
    }
    case "revoke-egress": {
      const spec = rest[0];
      if (!spec) throw new CliError(true, "isolation revoke-egress requires a <host>[:port]");
      const parsed = parseEgressSpecs([spec])[0]!;
      const port = parsePort(flags.port) ?? parsed.ports?.[0];
      const before = policy.egress.length;
      policy.egress = policy.egress.filter((rule) => {
        if (rule.host !== parsed.host) return true;
        if (port === undefined) return false;
        return rule.ports !== undefined && !rule.ports.includes(port);
      });
      changed = policy.egress.length !== before;
      note = changed ? "egress entry removed" : "no matching egress entry";
      break;
    }
    case "list": {
      const requests = loadProjectRequest(projectDir);
      const pending = unapproved(requests, policy);
      if (changed) saveIsolationConfig(config, configPath);
      return {
        command: "isolation",
        operation: "list",
        project: projectUri,
        configPath,
        changed: false,
        grants: policy.grants,
        egress: flags.egress === true ? policy.egress : [],
        ...(flags.explain === true
          ? { requests: { grants: pending.grants, egress: pending.egress } }
          : {}),
        note: "grants and egress are operator-owned; project requests are advisory",
      };
    }
    default:
      throw new CliError(
        true,
        `unknown isolation subcommand '${sub ?? ""}' (expected: allow, revoke, list, allow-egress, revoke-egress)`,
      );
  }

  if (changed) saveIsolationConfig(config, configPath);
  return {
    command: "isolation",
    operation: sub as "allow" | "revoke" | "allow-egress" | "revoke-egress",
    project: projectUri,
    configPath,
    changed,
    grants: policy.grants,
    egress: policy.egress,
    note,
  };
}
