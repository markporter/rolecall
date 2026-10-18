// Built-in module: `tempfile` — Ansible `tempfile` alternate (create a temp file/dir on the target).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Create a temp file or directory on the target (Ansible `tempfile` alternate). Returns the path in `data.path`; reports `changed: true` (a new temp node was created). @param ctx ModuleContext carrying `path`, `prefix`, `suffix`, `state`. @returns ModuleResult with the temp path in `data`. */
export const tempfileModule: Module = {
  name: "tempfile",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const path = typeof ctx.args["path"] === "string" ? String(ctx.args["path"]) : "/tmp";
    const prefix = typeof ctx.args["prefix"] === "string" ? String(ctx.args["prefix"]) : "ansible";
    const suffix = typeof ctx.args["suffix"] === "string" ? String(ctx.args["suffix"]) : "";
    const state = typeof ctx.args["state"] === "string" ? String(ctx.args["state"]) : "file";
    const cmd = state === "directory"
      ? `mktemp -d ${shQuote(prefix)}.XXXXXXXX${suffix} --tmpdir=${shQuote(path)}`
      : `mktemp ${shQuote(prefix)}.XXXXXXXX${suffix} --tmpdir=${shQuote(path)}`;
    const res = await ctx.connection.exec(cmd);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `tempfile: failed: ${res.stderr || `exit ${res.exitCode}`}` };
    const p = (res.stdout ?? "").trim();
    return { changed: true, data: { path: p }, msg: `tempfile: ${p}` };
  },
};

/** Search metadata for the `tempfile` module. */
export const meta: ModuleSummary = {
  name: "tempfile",
  description: "Create a temp file or directory on the target (Ansible `tempfile` alternate). Returns the path in `data.path`.",
  source: "builtin",
  args: {
    path: { type: "string", required: false, description: "Directory to create in (default /tmp)." },
    prefix: { type: "string", required: false, description: "Filename prefix." },
    suffix: { type: "string", required: false, description: "Filename suffix." },
    state: { type: "file | directory", required: false, description: "Create a file or directory (default file)." },
  },
  examples: [
    `- tempfile:
    path: /tmp
    prefix: app-
    state: directory
  register: tmp`,
  ],
  notes: "≠ Ansible `tempfile`: always creates a new node (`changed: true`); RoleCall does not yet track/clean it up automatically.",
};

(tempfileModule as Module & { meta: ModuleSummary }).meta = meta;
export default tempfileModule;
