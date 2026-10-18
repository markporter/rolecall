// Built-in module: `copy` (literal file copy + on-host templating) — Ansible-
// compatible implementation, formed by merging the old `template` and
// `config_write` builtins into one surface. Copies a LOCAL source file (or inline
// `content`, or a `content` template spec rendered on-host) onto a remote target over
// SSH / localhost via a Connection, idempotently. The desired bytes are read HERE
// on the control node and BASE64-ENCODED locally; they are DECODED at runtime by
// `base64 -d` inside a single bash invocation that runs entirely ON the target
// host. Neither the raw path nor the payload ever round-trips through Node as
// shell text, so arbitrary bytes survive untouched. A temp file + atomic `mv`
// makes each apply crash-consistent, and the whole compare+write stays in one
// script that returns CHANGED / WOULD_CHANGE / NOOP. Attributes are applied after
// the write, and `backup` snapshots the prior file first. Idempotency is exposed
// both imperatively (the write script compares SHA-256 itself) and declaratively
// via `check()`.

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { CheckableModule } from "../../idempotency";
import type { ModuleSummary } from "../search";
import { render } from "../../templating/fast";
import { renderJinja } from "../../templating/jinja";

/** Resolved source content plus its checksum, ready to ship to the target. */
interface SourceBytes {
  /** Base64 of the desired bytes; decoded on-target by `base64 -d`. */
  b64: string;
  /** SHA-256 hex digest of the desired bytes (for reporting and `check`). */
  checksum: string;
  /** Human-readable provenance for messages/data. */
  origin: string;
}

/** Structured on-host render spec supplied as the `content` object (bypasses the runner's literal-by-default string handling). */
interface ContentSpec {
  template?: unknown;
  template_file?: unknown;
  engine?: unknown;
}


const MODULE_NAME = "copy";

/**
 * Resolve a possibly-relative source path to something readable here. Precedence:
 * absolute as-is; then `<roleDir>/src/<name>` (when the task came from a role);
 * then `<playbookDir>/<name>`; then `<cwd>/<name>`. Returns the first existing
 * regular file, else the last candidate so the caller can report a precise error.
 */
function resolveSourcePath(name: string, roleDir?: string, playbookDir?: string): string {
  if (isAbsolute(name)) return name;
  const candidates: string[] = [];
  if (roleDir) candidates.push(join(roleDir, "src", name));
  if (playbookDir) candidates.push(join(playbookDir, name));
  candidates.push(join(process.cwd(), name));
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      // try next candidate
    }
  }
  return candidates[candidates.length - 1]!;
}

/**
 * Resolve a template_file reference to an absolute path. Precedence: absolute as-is;
 * then `<roleDir>/templates/<name>` (when the task came from a role); then
 * `<playbookDir>/<name>`; then `<cwd>/<name>`. Returns the first existing file, else
 * the last candidate so the caller can report a precise missing-path error.
 */
function resolveTemplatePath(name: string, roleDir?: string, playbookDir?: string): string {
  if (isAbsolute(name)) return name;
  const candidates: string[] = [];
  if (roleDir) candidates.push(join(roleDir, "templates", name));
  if (playbookDir) candidates.push(join(playbookDir, name));
  candidates.push(join(process.cwd(), name));
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      // try next candidate
    }
  }
  return candidates[candidates.length - 1]!;
}

/** Render a template string or template_file on-host with the chosen engine (eta default). */
function renderTemplate(spec: ContentSpec | undefined, ctx: ModuleContext): string {
  const engine = String(spec?.engine ?? "eta");
  const vars: Record<string, unknown> = { ...ctx.vars, ...(ctx.facts || {}), item: ctx.loop?.item, index: ctx.loop?.index };
  const fileRef = spec?.template_file;
  if (fileRef !== undefined && fileRef !== null && String(fileRef).length > 0) {
    const abs = resolveTemplatePath(String(fileRef), ctx.roleDir, ctx.playbookDir);
    let src: string;
    try {
      src = readFileSync(abs, "utf8");
    } catch (e) {
      throw new Error(
        `copy: cannot read template_file '${fileRef}' (resolved: ${abs}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return engine === "jinja" ? renderJinja(src, vars, { strict: false }) : render(src, vars);
  }
  if (spec && typeof spec.template === "string") {
    return engine === "jinja" ? renderJinja(spec.template, vars, { strict: false }) : render(spec.template, vars);
  }
  return "";
}

/** Read the desired bytes locally: from `src`, inline `content` (string), or a rendered `content` template spec. */
function resolveSource(ctx: ModuleContext): SourceBytes {
  const raw = ctx.args["content"];
  const spec = typeof raw === "object" && raw !== null ? (raw as ContentSpec) : undefined;
  const hasTemplate = spec !== undefined;

  if (hasTemplate) {
    const s = renderTemplate(spec, ctx);
    const buf = Buffer.from(s, "utf8");
    return {
      b64: buf.toString("base64"),
      checksum: createHash("sha256").update(buf).digest("hex"),
      origin: `${MODULE_NAME}: rendered template`,
    };
  }

  const hasSrc = typeof ctx.args["src"] === "string" && String(ctx.args["src"]).length > 0;
  const hasContent = typeof ctx.args["content"] === "string";

  if (hasSrc) {
    const ref = String(ctx.args["src"]);
    const abs = resolveSourcePath(ref, ctx.roleDir, ctx.playbookDir);
    let buf: Buffer;
    try {
      buf = readFileSync(abs);
    } catch (e) {
      throw new Error(
        `copy: cannot read source '${ref}' (resolved: ${abs}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return {
      b64: buf.toString("base64"),
      checksum: createHash("sha256").update(buf).digest("hex"),
      origin: `${MODULE_NAME}: copied ${ref}`,
    };
  }

  if (hasContent) {
    const s = String(ctx.args["content"]);
    const buf = Buffer.from(s, "utf8");
    return {
      b64: buf.toString("base64"),
      checksum: createHash("sha256").update(buf).digest("hex"),
      origin: `${MODULE_NAME}: wrote inline content`,
    };
  }

  return { b64: "", checksum: "", origin: MODULE_NAME };
}

/** Build the single bash invocation that reads the current remote checksum (or MISSING). */
function buildCompareScript(destB64: string): string {
  const script = [
    'P="$(printf %s "$1" | base64 -d)"',
    'if [ -e "$P" ]; then sha256sum < "$P" | cut -d" " -f1; else echo MISSING; fi',
  ].join("\n");
  return `bash -c '${script}' -- "${destB64}"`;
}

/** Build the single bash invocation that compares-and-writes entirely on-target. */
function buildCopyScript(
  destB64: string,
  payloadB64: string,
  opts: { force: boolean; check: boolean; backup: boolean; mode: string; owner: string; group: string; validate: string },
): string {
  // PB/BP/BM/BO/BG are base64(path)/base64(payload)/mode/owner/group; decoded at
  // runtime by base64 -d. They never appear as assignment targets, so arbitrary
  // bytes cannot corrupt the command. Booleans stay bare digits.
  const fArg = opts.force ? "1" : "0";
  const cArg = opts.check ? "1" : "0";
  const bkArg = opts.backup ? "1" : "0";
  const mB64 = Buffer.from(opts.mode ?? "", "utf8").toString("base64");
  const oB64 = Buffer.from(opts.owner ?? "", "utf8").toString("base64");
  const gB64 = Buffer.from(opts.group ?? "", "utf8").toString("base64");
  const vB64 = Buffer.from(opts.validate ?? "", "utf8").toString("base64");

  const script = [
    "set -eo pipefail",
    'P="$(printf %s "$1" | base64 -d)"',
    'F="$3"; C="$4"; B="$5"',
    'MODE="$(printf %s "$6" | base64 -d)"',
    'OWNER="$(printf %s "$7" | base64 -d)"',
    'GROUP="$(printf %s "$8" | base64 -d)"',
    'VALIDATE="$(printf %s "$9" | base64 -d)"',
    'DESI="$(printf %s "$2" | base64 -d | sha256sum | cut -d" " -f1)"',
    'if [ -e "$P" ]; then CUR="$(sha256sum < "$P" | cut -d" " -f1)"; else CUR="MISSING"; fi',
    'WOULD=0; [ "$CUR" != "$DESI" ] && WOULD=1',
    // Backup existing dest iff would-change AND writing AND backup requested. Done
    // BEFORE the overwrite so the snapshot captures the prior bytes; $BK persists in
    // this one bash process for the status marker emitted at the end. The .bak name
    // is built from the reconstructed path so it can contain anything unseen by Node.
    'if [ "$WOULD" = "1" ] && [ "$C" = "0" ] && [ "$B" = "1" ]; then BK="${P}.$(date +%Y%m%d%H%M%S%N).bak"; cp -p "$P" "$BK"; fi',
    // Write iff not dry-run AND (forced OR would-change). --force bypasses the
    // compare; --check never writes regardless of force.
    'if [ "$C" = "0" ] && { [ "$F" = "1" ] || [ "$WOULD" = "1" ]; }; then',
    '  mkdir -p "$(dirname "$P")"',
    '  TMP="$P.rolecall.$$.tmp"',
    '  printf %s "$2" | base64 -d > "$TMP"',
    '  if [ -n "$VALIDATE" ]; then VCMD="${VALIDATE//%s/$TMP}"; if ! bash -c "$VCMD"; then echo "VALIDATE_FAILED"; exit 1; fi; fi',
    '  mv "$TMP" "$P"',
    // Apply attributes only when provided, via guarded ifs so `set -e` is never
    // tripped by an empty value.
    '  if [ -n "$MODE" ]; then chmod "$MODE" "$P"; fi',
    '  if [ -n "$OWNER" ]; then chown "$OWNER" "$P"; fi',
    '  if [ -n "$GROUP" ]; then chgrp "$GROUP" "$P"; fi',
    // Emit CHANGED plus, when a backup was taken, its .bak path as a second
    // whitespace-delimited token (base64, unwrapped with -w0) so run() recovers the
    // exact file that was snapshotted above.
    '  if [ "$B" = "1" ]; then echo "CHANGED $(printf %s "$BK" | base64 -w0)"; else echo CHANGED; fi',
    "elif [ \"$WOULD\" = \"1\" ]; then echo WOULD_CHANGE",
    "else echo NOOP",
    "fi",
  ].join("\n");

  return `bash -c '${script}' -- "${destB64}" "${payloadB64}" "${fArg}" "${cArg}" "${bkArg}" "${mB64}" "${oB64}" "${gB64}" "${vB64}"`;
}

/**
 * Parse the changed result's output. The script prints `CHANGED` on its own line,
 * or `CHANGED <base64-of-.bak-path>` (two whitespace-delimited tokens) when a
 * backup was taken. Returns the decoded backup filename, or undefined otherwise.
 */
function extractBackup(stdout: string): string | undefined {
  const parts = stdout.trim().split(/\s+/);
  const marker = parts[1];
  return marker === undefined ? undefined : Buffer.from(marker, "base64").toString("utf8");
}

// check() and run() share arg resolution; keep this narrow to avoid drift.
interface CopyArgs {
  src?: unknown;
  content?: string | ContentSpec;
  dest?: unknown;
  path?: unknown;
  mode?: unknown;
  owner?: unknown;
  group?: unknown;
  backup?: unknown;
  force?: unknown;
  _force?: unknown;
  check?: unknown;
  _check?: unknown;
  validate?: unknown;
}

/** @summary Copy a local source file (or inline content, or a `content` template spec rendered on-host) to a remote destination idempotently. Ships bytes base64-encoded and decodes on-target in one compare+write script; supports on-host templating (content template spec, eta/jinja), atomic mv, optional mode/owner/group, backup, validate, become, and --check. @param ctx ModuleContext carrying copy args (`src`|`content` (string or template spec), `dest`/`path`, `mode`, `force`, `backup`, `validate`, `owner`, `group`) plus connection/become/check flags. @returns ModuleResult with data.{dest,changed,checksum,backup_file?}; skipped=true when unchanged or in --check dry-run. */
export const copyModule: CheckableModule = {
  name: MODULE_NAME,
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args as unknown as CopyArgs;
    const dest = String(args.dest ?? args.path ?? "");
    if (!dest) {
      return { changed: false, failed: true, msg: `${MODULE_NAME}: 'dest' (or 'path') is required` };
    }
    const hasSrc = typeof args.src === "string" && String(args.src).length > 0;
    const hasContent = typeof args.content === "string" && String(args.content).length > 0;
    const hasTemplate = typeof args.content === "object" && args.content !== null;
    if (!hasSrc && !hasContent && !hasTemplate) {
      return { changed: false, failed: true, msg: `${MODULE_NAME}: one of 'src' or 'content' is required` };
    }

    const src = resolveSource(ctx);
    const destB64 = Buffer.from(dest, "utf8").toString("base64");

    const opts = {
      force: Boolean(args.force ?? args._force),
      check: Boolean(args.check ?? args._check),
      backup: Boolean(args.backup),
      mode: typeof args.mode === "string" ? args.mode : "",
      owner: typeof args.owner === "string" ? args.owner : "",
      group: typeof args.group === "string" ? args.group : "",
      validate: typeof args.validate === "string" ? args.validate : "",
    };

    const cmd = buildCopyScript(destB64, src.b64, opts);
    // Executor owns the connection lifecycle, so we must NOT connect/disconnect here.
    // When `become` is set, prefix the whole script with `sudo` so it runs as root.
    // The script body contains no single quotes, so `sudo bash -c '...'` stays safe.
    const execCmd = ctx.become ? `sudo ${cmd}` : cmd;

    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    try {
      const res = await ctx.connection.exec(execCmd);
      stdout = res.stdout ?? "";
      stderr = res.stderr ?? "";
      exitCode = res.exitCode ?? 0;
    } catch (e) {
      return {
        changed: false,
        failed: true,
        msg: `${MODULE_NAME}: transport error (${e instanceof Error ? e.message : String(e)})`,
        stderr: stderr || undefined,
      };
    }

    // Status is the first whitespace-delimited token; when a backup was taken the
    // script appends "<base64-of-.bak-path>" after "CHANGED" for run() to recover.
    const status = stdout.trim().split(/\s+/)[0];
    if (exitCode !== 0) {
      return {
        changed: false,
        failed: true,
        msg: `${MODULE_NAME}: remote write failed`,
        stdout,
        stderr,
      };
    }
    if (status !== "CHANGED" && status !== "WOULD_CHANGE" && status !== "NOOP") {
      return {
        changed: false,
        failed: true,
        msg: `${MODULE_NAME}: unexpected remote status: ${JSON.stringify(status)}`,
        stdout,
        stderr,
      };
    }

    const data: Record<string, unknown> = { dest, checksum: src.checksum, origin: src.origin };

    if (status === "WOULD_CHANGE") {
      return {
        changed: false,
        skipped: true,
        msg: opts.check ? `${dest} would change (dry run)` : `${dest} would change`,
        data: { ...data, changed: false, wouldChange: true },
      };
    }

    if (status === "NOOP") {
      return { changed: false, skipped: true, msg: `${dest} unchanged`, data: { ...data, changed: false } };
    }

    // CHANGED — report what landed (and whether a backup was written).
    const backupFile = extractBackup(stdout);
    return {
      changed: true,
      msg: `${originLabel(src)} -> ${dest}`,
      stdout,
      data: { ...data, changed: true, ...(backupFile ? { backup_file: backupFile } : {}) },
    };
  },
  /** Report current target state for declarative reconciliation (used by applyIdempotent's skip-unchanged path). */
  async check(_args: Record<string, unknown>, ctx: ModuleContext): Promise<{ current: string | null; inDesired: boolean }> {
    const src = resolveSource(ctx);
    const destB64 = Buffer.from(String(ctx.args["dest"] ?? ctx.args["path"] ?? ""), "utf8").toString("base64");
    const cmpCmd = ctx.become ? `sudo ${buildCompareScript(destB64)}` : buildCompareScript(destB64);
    try {
      const res = await ctx.connection.exec(cmpCmd);
      const current = (res.stdout ?? "").trim();
      return {
        current: current === "" ? null : current,
        inDesired: current !== "" && current !== "MISSING" && current === src.checksum,
      };
    } catch {
      return { current: null, inDesired: false };
    }
  },
};

/** Describe where the copied bytes came from, for user-facing messages. */
function originLabel(src: SourceBytes): string {
  return src.origin;
}

/** Search metadata for the `copy` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: MODULE_NAME,
  description:
    "Literal idempotent file copy to a remote target, or on-host template render (_content/template_file, EJS or Jinja). SHA-256 compare; ships bytes base64-encoded and decodes on-target in one compare+write script with atomic mv. Supports inline content, a local source file, optional mode/owner/group, backup, validate, become, and --check.",
  source: "builtin",
  args: {
    src: {
      type: "string",
      required: false,
      description: "Local path to the source file on the control node. At least one of `src` or `content` is required.",
    },
    content: {
      type: "string | { template, template_file, engine }",
      required: false,
      description: "Inline content for the destination. A bare string is written verbatim (never interpreted as a template). Pass an object with `template` (inline string) or `template_file` (path) and optional `engine` ('ejs' default, or 'jinja') to render on-host.",
    },
    dest: { type: "string", required: false, description: "Destination path on the target." },
    path: { type: "string", required: false, description: "Alias for `dest` (accepted for drop-in `config_write` parity)." },
    mode: { type: "string", required: false, description: "Octal mode to apply after writing, e.g. '0644'." },
    force: {
      type: "boolean",
      required: false,
      description: "Rewrite unconditionally even when the destination already matches. Defaults to false (rewrite only on mismatch).",
    },
    backup: {
      type: "boolean",
      required: false,
      description: "Back up an existing destination before overwriting it (a timestamped .bak sibling is created). Defaults to false.",
    },
    validate: {
      type: "string",
      required: false,
      description: "Validation command run against the temp file before it is moved into place; `%s` is replaced with the temp path. The task fails if the command exits non-zero (e.g. `visudo -cf %s`).",
    },
    owner: { type: "string", required: false, description: "Owner user to chown after writing." },
    group: { type: "string", required: false, description: "Group to chgrp after writing." },
  },
  examples: [
    `- copy:
    src: files/app.conf
    dest: /etc/app/app.conf
    mode: '0644'`,
    `- copy:
    content: 'port=8080'
    dest: /etc/app/port.conf`,
    `- copy:
    dest: /etc/nginx/conf.d/site.conf
    content:
      template_file: vhost.j2
      engine: jinja`,
    `- copy:
    dest: /etc/app/app.conf
    content:
      template: 'port=<%= vars.port %>'`,
    `- copy:
    dest: /etc/sudoers.d/app
    content: 'app ALL=(ALL) NOPASSWD:ALL'
    validate: 'visudo -cf %s'`,
  ],
    notes:
    "≠ Ansible `copy`: `force` defaults to FALSE here (Ansible defaults TRUE), so copy only rewrites when the destination differs unless you pass force:true. Templating is on-host: pass `content` as an object with `template`/`template_file` and optional `engine` (EJS default, or `jinja`); a bare `content` string is written literally (never interpreted as a template). Attribute application relies on stat/chown/chgrp availability; no SELinux context handling.",
};

(copyModule as Module & { meta: ModuleSummary }).meta = meta;
export default copyModule;
