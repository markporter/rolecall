// Built-in module: `snap` — install/remove snap packages idempotently.
//
// Presence is probed with `snap list <name>`; install adds `--classic` when
// requested and remove uninstalls the named snap. Every command is prefixed with
// `sudo` only when `ctx.become` is set, because snap normally needs root.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { CheckableModule } from "../../idempotency";
import type { ModuleSummary } from "../search";

const MODULE_NAME = "snap";

/** @summary Arguments for the `snap` module. @property name Snap package name (required). @property state Desired state: `present` (default) or `absent`. @property classic Install with `--classic` (present only). */
export interface SnapArgs {
  /** Snap package name. Required. */
  name: string;
  /** Desired state (default "present"). */
  state?: "present" | "absent";
  /** Install with `--classic` confinement. */
  classic?: boolean;
}

/** Search metadata for the `snap` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: MODULE_NAME,
  description:
    "Install or remove a snap package idempotently, optionally with `--classic` confinement.",
  idempotent: true,
  source: "builtin",
  network: true,
  args: {
    name: { type: "string", required: true, description: "Snap package name." },
    state: { type: "present | absent", required: false, description: "Desired state (default present)." },
    classic: { type: "boolean", required: false, description: "Install with `--classic` confinement." },
  },
  examples: [
    `- snap:
    name: core
    state: present`,
    `- snap:
    name: code
    state: present
    classic: true`,
    `- snap:
    name: core
    state: absent`,
  ],
  notes:
    "≠ Ansible `snap`: presence is probed with `snap list <name>`; `classic` only affects installs. Commands run with `sudo` when `become` is set (snap requires root).",
};

/** @summary Idempotently install/remove a snap package. @param ctx ModuleContext carrying `name`, `state`, and `classic`. @returns ModuleResult; `changed:false` when already in the desired state. */
export const snapModule: Module & CheckableModule = {
  name: MODULE_NAME,
  network: true,
  async check(args, ctx) {
    const name = typeof args["name"] === "string" ? String(args["name"]).trim() : "";
    const state = (args["state"] ?? "present") as "present" | "absent";
    const sudo = ctx.become ? "sudo " : "";
    const installed = (await ctx.connection.exec(`${sudo}snap list ${name}`)).exitCode === 0;
    return { current: { installed }, inDesired: state === "present" ? installed : !installed };
  },
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args as unknown as SnapArgs;
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!name) return { changed: false, failed: true, msg: "snap: 'name' is required" };

    const state = args.state ?? "present";
    if (state !== "present" && state !== "absent") {
      return {
        changed: false,
        failed: true,
        msg: `snap: invalid state '${String(args.state)}'; expected present or absent`,
      };
    }
    const classic = args.classic === true;
    const sudo = ctx.become ? "sudo " : "";
    const data = { name, state, classic };

    const listed = await ctx.connection.exec(`${sudo}snap list ${name}`);
    const installed = listed.exitCode === 0;

    if (state === "absent") {
      if (!installed) {
        return { changed: false, msg: `snap: ${name} already absent`, data: { ...data, idempotent: true } };
      }
      const res = await ctx.connection.exec(`${sudo}snap remove ${name}`);
      if (res.exitCode !== 0) {
        return {
          changed: false,
          failed: true,
          msg: `snap: failed to remove ${name}: ${res.stderr || `exit ${res.exitCode}`}`,
          data,
        };
      }
      return { changed: true, msg: `snap: ${name} removed`, data };
    }

    if (installed) {
      return { changed: false, msg: `snap: ${name} already present`, data: { ...data, idempotent: true } };
    }
    const res = await ctx.connection.exec(`${sudo}snap install ${name}${classic ? " --classic" : ""}`);
    if (res.exitCode !== 0) {
      return {
        changed: false,
        failed: true,
        msg: `snap: failed to install ${name}: ${res.stderr || `exit ${res.exitCode}`}`,
        data,
      };
    }
    return { changed: true, msg: `snap: ${name} installed${classic ? " (classic)" : ""}`, data };
  },
};

(snapModule as Module & { meta: ModuleSummary }).meta = meta;
export default snapModule;
