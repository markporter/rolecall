// Batteries-included idempotent `replace` module (next-wave module parity).
//
// Reads a target file's content over the transport, applies a literal `old`→
// `replace` substitution or a `regexp`→`replace` rewrite, and writes back only
// when the content actually changes. Idempotent: identical content is a no-op.
// Writes happen on-target via a base64 payload (no local temp file), mirroring
// the `copy` module, with optional backup and file attributes.

import { createHash } from "node:crypto";
import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary In-file text replacement args. @property path Target file. @property old Literal string to replace. @property regexp Regular expression to replace (global). @property replace Replacement text. @property backup Rotate a timestamped .bak before writing. @property validate Validation command run against the temp file before move (`%s`=temp path); task fails on non-zero exit. */
export interface ReplaceArgs {
  /** Target file path. */
  path: string;
  /** Literal string to replace (requires `replace`). */
  old?: string;
  /** Regular expression (global) to replace. */
  regexp?: string;
  /** Replacement text. */
  replace: string;
  /** Rotate a timestamped `.bak` before writing. */
  backup?: unknown;
  /** Octal mode to apply after write. */
  mode?: string;
  /** Owner to chown to (needs become). */
  owner?: string;
  /** Group to chgrp to (needs become). */
  group?: string;
  /** Validation command run against the temp file before move; `%s` is the temp path; the task fails if it exits non-zero. */
  validate?: string;
  /** Internal: set by `--check` global passthrough. */
  _check?: unknown;
  /** Internal: set by `--check` global passthrough. */
  check?: unknown;
}

const MODULE_NAME = "replace";

/** Search metadata for the `replace` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: MODULE_NAME,
  description: "Replace text in a file (literal old→replace or regexp→replace), writing back only when content changes. Idempotent. Supports optional backup and a validate command run on the temp file before it is moved into place.",
  idempotent: true,
  source: "builtin",
  args: {
    path: { type: "string", required: true, description: "Target file path." },
    old: { type: "string", required: false, description: "Literal string to replace." },
    regexp: { type: "string", required: false, description: "Regular expression (global) to replace." },
    replace: { type: "string", required: true, description: "Replacement text." },
    backup: { type: "boolean", required: false, description: "Rotate a timestamped .bak before writing." },
    validate: { type: "string", required: false, description: "Validation command run against the temp file before it is moved into place; `%s` is replaced with the temp path. The task fails if the command exits non-zero (e.g. `nginx -t -c %s`)." },
  },
};

function buildWriteScript(destB64: string, payloadB64: string, opts: { backup: boolean; mode: string; owner: string; group: string; validate: string }): string {
  const bkArg = opts.backup ? "1" : "0";
  const mB64 = Buffer.from(opts.mode ?? "", "utf8").toString("base64");
  const oB64 = Buffer.from(opts.owner ?? "", "utf8").toString("base64");
  const gB64 = Buffer.from(opts.group ?? "", "utf8").toString("base64");
  const vB64 = Buffer.from(opts.validate ?? "", "utf8").toString("base64");
  const script = [
    "set -eo pipefail",
    'P="$(printf %s "$1" | base64 -d)"',
    'B="$2"',
    'MODE="$(printf %s "$3" | base64 -d)"',
    'OWNER="$(printf %s "$4" | base64 -d)"',
    'GROUP="$(printf %s "$5" | base64 -d)"',
    'VALIDATE="$(printf %s "$7" | base64 -d)"',
    'if [ "$B" = "1" ]; then BK="${P}.$(date +%Y%m%d%H%M%S%N).bak"; cp -p "$P" "$BK"; fi',
    'TMP="$P.rolecall.$$.tmp"',
    'printf %s "$6" | base64 -d > "$TMP"',
    'if [ -n "$VALIDATE" ]; then VCMD="${VALIDATE//%s/$TMP}"; if ! bash -c "$VCMD"; then echo "VALIDATE_FAILED"; exit 1; fi; fi',
    'mv "$TMP" "$P"',
    'if [ -n "$MODE" ]; then chmod "$MODE" "$P"; fi',
    'if [ -n "$OWNER" ]; then chown "$OWNER" "$P"; fi',
    'if [ -n "$GROUP" ]; then chgrp "$GROUP" "$P"; fi',
    'echo WROTE',
  ].join("\n");
  return `bash -c '${script}' -- "${destB64}" "${bkArg}" "${mB64}" "${oB64}" "${gB64}" "${payloadB64}" "${vB64}"`;
}

/** @summary Replace text inside a file on the managed host, writing only on change. @param ctx ModuleContext (connection, args, become). @returns ModuleResult with changed/skipped/failed and data. */
export const replaceModule: Module = {
  name: MODULE_NAME,
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args as unknown as ReplaceArgs;
    const path = String(args.path ?? "");
    if (!path) return { changed: false, failed: true, msg: "replace: 'path' is required" } as ModuleResult;
    const replacement = String(args.replace ?? "");
    const old = typeof args.old === "string" ? args.old : undefined;
    const regexp = typeof args.regexp === "string" ? args.regexp : undefined;
    if (old === undefined && regexp === undefined)
      return { changed: false, failed: true, msg: "replace: one of 'old' or 'regexp' is required" } as ModuleResult;

    const sudo = ctx.become ? "sudo " : "";
    const checkMode = Boolean(args._check ?? args.check);
    const data: Record<string, unknown> = { path };

    const rd = await ctx.connection.exec(`${sudo}cat ${shQuote(path)} 2>/dev/null`);
    if (rd.exitCode !== 0)
      return { changed: false, failed: true, msg: `replace: cannot read ${path}`, data } as ModuleResult;
    const current = rd.stdout;

    let updated: string;
    if (regexp) {
      try {
        updated = current.replace(new RegExp(regexp, "g"), replacement);
      } catch (e) {
        return { changed: false, failed: true, msg: `replace: invalid regexp: ${e instanceof Error ? e.message : String(e)}`, data } as ModuleResult;
      }
    } else {
      updated = old !== "" ? current.split(old!).join(replacement) : current;
    }

    if (updated === current)
      return { changed: false, skipped: true, msg: `${path} unchanged`, data } as ModuleResult;
    if (checkMode)
      return { changed: false, skipped: true, msg: `${path} would change`, data: { ...data, wouldChange: true } } as ModuleResult;

    const payloadB64 = Buffer.from(updated, "utf8").toString("base64");
    const destB64 = Buffer.from(path, "utf8").toString("base64");
    const opts = {
      backup: Boolean(args.backup),
      mode: typeof args.mode === "string" ? args.mode : "",
      owner: typeof args.owner === "string" ? args.owner : "",
      group: typeof args.group === "string" ? args.group : "",
      validate: typeof args.validate === "string" ? args.validate : "",
    };
    const cmd = buildWriteScript(destB64, payloadB64, opts);
    const execCmd = ctx.become ? `sudo ${cmd}` : cmd;
    const res = await ctx.connection.exec(execCmd);
    if (res.exitCode !== 0)
      return { changed: false, failed: true, stderr: res.stderr || "", msg: `replace: write failed`, data } as ModuleResult;
    return { changed: true, msg: `${path} updated`, data: { ...data, checksum: createHash("sha256").update(updated).digest("hex") } } as ModuleResult;
  },
};
(replaceModule as Module & { meta: ModuleSummary }).meta = meta;
export default replaceModule;
