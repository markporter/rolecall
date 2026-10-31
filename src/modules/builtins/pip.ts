// Built-in module: `pip` — install/remove Python packages idempotently through a
// pip executable or a virtualenv's pip.
//
// Idempotency is intrinsic: every run first probes each package with
// `<pip> show <pkg>` and only mutates packages whose observed state differs from
// the requested `present`/`absent`/`latest` state. `latest` installs with
// `--upgrade`; already-installed packages are left untouched (no newer-version
// lookup is attempted). `virtualenv` selects `<virtualenv>/bin/pip` and ignores
// `executable`. `extra_args` is appended verbatim to install commands.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { CheckableModule } from "../../idempotency/types";
import { resource } from "../resource";
import type { ModuleSummary } from "../search";

const MODULE_NAME = "pip";

/** Desired package state accepted by the `pip` module. */
type PipState = "present" | "absent" | "latest";

/** @summary Arguments for the `pip` module. @property name Package name or list of package names (required). @property state Desired state: `present` (default), `absent`, or `latest`. @property executable pip binary to invoke (default `pip3`). @property virtualenv Virtualenv directory; selects `<virtualenv>/bin/pip` instead of `executable`. @property extra_args Extra arguments appended verbatim to install commands. */
export interface PipArgs {
  /** Package name(s) to manage. Required. */
  name: string | string[];
  /** Desired state (default "present"). */
  state?: PipState;
  /** pip binary (default "pip3"). */
  executable?: string;
  /** Virtualenv directory; its `bin/pip` is used when set. */
  virtualenv?: string;
  /** Additional install arguments appended verbatim. */
  extra_args?: string;
}

/** Resolved and validated pip invocation. */
interface ResolvedPip {
  packages: string[];
  state: PipState;
  pipCmd: string;
  extra: string;
  virtualenv?: string;
}

/** Search metadata for the `pip` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: MODULE_NAME,
  description:
    "Install, upgrade, or remove Python packages idempotently via pip or a virtualenv's pip (Ansible `pip` alternate).",
  idempotent: true,
  source: "builtin",
  args: {
    name: {
      type: "string | string[]",
      required: true,
      description: "Package name or list of package names.",
    },
    state: {
      type: "present | absent | latest",
      required: false,
      description: "Desired state (default present); latest installs with --upgrade.",
    },
    executable: { type: "string", required: false, description: "pip binary to invoke (default pip3)." },
    virtualenv: {
      type: "string",
      required: false,
      description: "Virtualenv directory; uses <virtualenv>/bin/pip instead of executable.",
    },
    extra_args: {
      type: "string",
      required: false,
      description: "Additional arguments appended verbatim to install commands.",
    },
  },
  examples: [
    `- pip:
    name: requests
    state: present`,
    `- pip:
    name:
      - requests
      - flask
    state: latest`,
    `- pip:
    name: ansible
    state: absent
    executable: pip3`,
    `- pip:
    name: requests
    state: present
    virtualenv: /opt/venv
    extra_args: --no-cache-dir`,
  ],
  notes:
    "≠ Ansible `pip`: `latest` installs with `--upgrade` but does not query an index for newer versions, so an already-installed package is a no-op. `virtualenv` selects `<virtualenv>/bin/pip` and ignores `executable`. `extra_args` is appended verbatim to install commands only.",
};

/** Validate and normalize args, returning an actionable error message when unusable. */
function resolveArgs(args: PipArgs): { ok: true; value: ResolvedPip } | { ok: false; msg: string } {
  const raw = args.name;
  let packages: string[];
  if (typeof raw === "string") {
    packages = raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  } else if (Array.isArray(raw)) {
    if (!raw.every((entry) => typeof entry === "string")) {
      return { ok: false, msg: "pip: 'name' must be a string or an array of strings" };
    }
    packages = raw.map((entry) => entry.trim()).filter(Boolean);
  } else {
    return { ok: false, msg: "pip: 'name' is required" };
  }
  if (packages.length === 0) return { ok: false, msg: "pip: 'name' is required" };

  const state = (args.state ?? "present") as PipState;
  if (state !== "present" && state !== "absent" && state !== "latest") {
    return {
      ok: false,
      msg: `pip: invalid state '${String(args.state)}'; expected present, absent, or latest`,
    };
  }

  const executable = typeof args.executable === "string" && args.executable.trim() ? args.executable.trim() : "pip3";
  const virtualenv = typeof args.virtualenv === "string" && args.virtualenv.trim() ? args.virtualenv.trim() : undefined;
  const pipCmd = virtualenv ? `${virtualenv.replace(/\/+$/, "")}/bin/pip` : executable;
  const extra = typeof args.extra_args === "string" ? args.extra_args.trim() : "";
  return { ok: true, value: { packages, state, pipCmd, extra, virtualenv } };
}

/** Probe whether one package is installed via `<pip> show <pkg>`. */
async function isInstalled(ctx: ModuleContext, pipCmd: string, pkg: string): Promise<boolean> {
  const sudo = ctx.become ? "sudo " : "";
  const res = await ctx.connection.exec(`${sudo}${pipCmd} show ${pkg}`);
  return res.exitCode === 0;
}

/** @summary Idempotently manage Python packages through pip or a virtualenv pip. @param args PipArgs (name/state/executable/virtualenv/extra_args). @returns Module & CheckableModule. */
export const pipModule: Module & CheckableModule = resource({
  name: MODULE_NAME,
  async describe(args, ctx) {
    const parsed = resolveArgs(args as unknown as PipArgs);
    if (!parsed.ok) return { current: null, inDesired: false };
    const { packages, state, pipCmd } = parsed.value;
    const installed: Record<string, boolean> = {};
    for (const pkg of packages) {
      installed[pkg] = await isInstalled(ctx, pipCmd, pkg);
    }
    const inDesired = packages.every((pkg) =>
      state === "absent" ? installed[pkg] !== true : installed[pkg] === true,
    );
    return { current: { installed, state }, inDesired };
  },
  async converge(args, ctx) {
    const parsed = resolveArgs(args as unknown as PipArgs);
    if (!parsed.ok) return { changed: false, failed: true, msg: parsed.msg };
    const { packages, state, pipCmd, extra, virtualenv } = parsed.value;
    const sudo = ctx.become ? "sudo " : "";
    const installed: Record<string, boolean> = {};
    for (const pkg of packages) {
      installed[pkg] = await isInstalled(ctx, pipCmd, pkg);
    }

    const log: string[] = [];
    let changed = false;
    for (const pkg of packages) {
      if (state === "absent") {
        if (!installed[pkg]) continue;
        const res = await ctx.connection.exec(`${sudo}${pipCmd} uninstall -y ${pkg}`);
        if (res.exitCode !== 0) {
          return {
            changed: false,
            failed: true,
            msg: `pip: failed to uninstall ${pkg}: ${res.stderr || `exit ${res.exitCode}`}`,
            data: { name: packages, state, executable: pipCmd, virtualenv: virtualenv ?? null },
          };
        }
        log.push(`uninstalled ${pkg}`);
        changed = true;
        continue;
      }

      if (installed[pkg]) continue;
      const parts = ["install"];
      if (state === "latest") parts.push("--upgrade");
      if (extra) parts.push(extra);
      parts.push(pkg);
      const res = await ctx.connection.exec(`${sudo}${pipCmd} ${parts.join(" ")}`);
      if (res.exitCode !== 0) {
        return {
          changed: false,
          failed: true,
          msg: `pip: failed to install ${pkg}: ${res.stderr || `exit ${res.exitCode}`}`,
          data: { name: packages, state, executable: pipCmd, virtualenv: virtualenv ?? null },
        };
      }
      log.push(`installed ${pkg}`);
      changed = true;
    }

    const data = { name: packages, state, executable: pipCmd, virtualenv: virtualenv ?? null };
    if (!changed) {
      return { changed: false, msg: `pip: ${packages.join(", ")} unchanged`, data: { ...data, idempotent: true } };
    }
    return {
      changed: true,
      stdout: log.join("\n"),
      msg: `pip: ${log.join(", ")}`,
      data,
    };
  },
});

(pipModule as Module & CheckableModule & { meta: ModuleSummary }).meta = meta;
export default pipModule;
