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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { CheckableModule } from "../../idempotency";
import type { ModuleSummary } from "../search";
import { render } from "../../templating/fast";
import { renderJinja } from "../../templating/jinja";
import { renderTemplateIsolated } from "../../isolation/template-worker";
import { requirePolicy } from "../../templating/refs";
import { shQuote } from "./fs";

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
function resolveSourcePath(name: string | string[], roleDir?: string, playbookDir?: string): string {
  const names = Array.isArray(name) ? name : [name];
  let last = "";
  for (const entry of names) {
    const candidates: string[] = [];
    if (isAbsolute(entry)) candidates.push(entry);
    else {
      if (roleDir) {
        candidates.push(join(roleDir, "files", entry));
        candidates.push(join(roleDir, "src", entry));
      }
      if (playbookDir) {
        candidates.push(join(playbookDir, "files", entry));
        candidates.push(join(playbookDir, entry));
      }
      candidates.push(join(process.cwd(), entry));
    }
    for (const c of candidates) {
      try {
        if (statSync(c).isFile()) return c;
      } catch {
        // try next candidate
      }
    }
    last = candidates[candidates.length - 1]!;
  }
  return last;
}

/**
 * Resolve a template_file reference to an absolute path. Precedence: absolute as-is;
 * then `<roleDir>/templates/<name>` (when the task came from a role); then
 * `<playbookDir>/<name>`; then `<cwd>/<name>`. Returns the first existing file, else
 * the last candidate so the caller can report a precise missing-path error.
 */
function resolveTemplatePath(name: string | string[], roleDir?: string, playbookDir?: string): string {
  const names = Array.isArray(name) ? name : [name];
  let last = "";
  for (const entry of names) {
    const candidates: string[] = [];
    if (isAbsolute(entry)) candidates.push(entry);
    else {
      if (roleDir) candidates.push(join(roleDir, "templates", entry));
      if (playbookDir) {
        candidates.push(join(playbookDir, "templates", entry));
        candidates.push(join(playbookDir, entry));
      }
      candidates.push(join(process.cwd(), entry));
    }
    for (const c of candidates) {
      try {
        if (statSync(c).isFile()) return c;
      } catch {
        // try next candidate
      }
    }
    last = candidates[candidates.length - 1]!;
  }
  return last;
}

/** Render a template string or template_file on-host with the chosen engine (eta default). */
async function renderTemplate(spec: ContentSpec | undefined, ctx: ModuleContext): Promise<string> {
  const engine = String(spec?.engine ?? "eta");
  const vars: Record<string, unknown> = { ...ctx.vars, ...(ctx.facts || {}), item: ctx.loop?.item, index: ctx.loop?.index };
  const fileRef = spec?.template_file;
  const hasFileRef =
    (typeof fileRef === "string" && fileRef.length > 0) ||
    (Array.isArray(fileRef) && fileRef.length > 0 && fileRef.every((entry) => typeof entry === "string"));
  if (hasFileRef) {
    const abs = resolveTemplatePath(fileRef as string | string[], ctx.roleDir, ctx.playbookDir);
    let src: string;
    try {
      src = readFileSync(abs, "utf8");
    } catch (e) {
      throw new Error(
        `copy: cannot read template_file '${Array.isArray(fileRef) ? fileRef.join(", ") : String(fileRef)}' (resolved: ${abs}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return await renderEngine(engine, src, vars, ctx);
  }
  if (spec && typeof spec.template === "string") {
    return await renderEngine(engine, spec.template, vars, ctx);
  }
  return "";
}

async function renderEngine(
  engine: string,
  source: string,
  vars: Record<string, unknown>,
  ctx: ModuleContext,
): Promise<string> {
  if (engine !== "jinja") requirePolicy(ctx.approvals, "code", !ctx.isolation || ctx.isolation.backend === "none");
  if (ctx.isolation && ctx.isolation.backend !== "none") {
    const isolatedEngine: "jinja" | "eta" | "ejs" =
      engine === "jinja" ? "jinja" : engine === "ejs" ? "ejs" : "eta";
    return renderTemplateIsolated({ engine: isolatedEngine, template: source, vars, isolation: ctx.isolation });
  }
  return engine === "jinja" ? renderJinja(source, vars) : render(source, vars);
}

/** Read the desired bytes locally: from `src`, inline `content` (string), or a rendered `content` template spec. */
async function resolveSource(ctx: ModuleContext): Promise<SourceBytes> {
  const raw = ctx.args["content"];
  const spec = typeof raw === "object" && raw !== null ? (raw as ContentSpec) : undefined;
  const hasTemplate = spec !== undefined;

  if (hasTemplate) {
    const s = await renderTemplate(spec, ctx);
    const buf = Buffer.from(s, "utf8");
    return {
      b64: buf.toString("base64"),
      checksum: createHash("sha256").update(buf).digest("hex"),
      origin: `${MODULE_NAME}: rendered template`,
    };
  }

  const rawSrc = ctx.args["src"];
  const hasSrc =
    (typeof rawSrc === "string" && rawSrc.length > 0) ||
    (Array.isArray(rawSrc) && rawSrc.length > 0 && rawSrc.every((entry) => typeof entry === "string"));
  const hasContent = typeof ctx.args["content"] === "string";

  if (hasSrc) {
    const ref = Array.isArray(rawSrc) ? (rawSrc as string[]) : String(rawSrc);
    const abs = resolveSourcePath(ref, ctx.roleDir, ctx.playbookDir);
    let buf: Buffer;
    try {
      buf = readFileSync(abs);
    } catch (e) {
      throw new Error(
        `copy: cannot read source '${Array.isArray(ref) ? ref.join(", ") : ref}' (resolved: ${abs}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return {
      b64: buf.toString("base64"),
      checksum: createHash("sha256").update(buf).digest("hex"),
      origin: `${MODULE_NAME}: copied ${Array.isArray(ref) ? ref.join(", ") : ref}`,
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
  /** Treat `src` as a target-side path and copy it on the target instead of reading it locally. */
  remote_src?: unknown;
}

interface CopyOpts {
  force: boolean;
  check: boolean;
  backup: boolean;
  mode: string;
  owner: string;
  group: string;
  validate: string;
}

function copyOpts(args: CopyArgs): CopyOpts {
  return {
    force: Boolean(args.force ?? args._force),
    check: Boolean(args.check ?? args._check),
    backup: Boolean(args.backup),
    mode: typeof args.mode === "string" ? args.mode : "",
    owner: typeof args.owner === "string" ? args.owner : "",
    group: typeof args.group === "string" ? args.group : "",
    validate: typeof args.validate === "string" ? args.validate : "",
  };
}

/** Build the remote-source copy script (files and directory contents). */
function buildRemoteSrcScript(destB64: string, srcB64: string, opts: CopyOpts): string {
  const fArg = opts.force ? "1" : "0";
  const cArg = opts.check ? "1" : "0";
  const bkArg = opts.backup ? "1" : "0";
  const mB64 = Buffer.from(opts.mode, "utf8").toString("base64");
  const oB64 = Buffer.from(opts.owner, "utf8").toString("base64");
  const gB64 = Buffer.from(opts.group, "utf8").toString("base64");
  const vB64 = Buffer.from(opts.validate, "utf8").toString("base64");
  const script = [
    "set -eo pipefail",
    'S="$(printf %s "$1" | base64 -d)"',
    'P="$(printf %s "$2" | base64 -d)"',
    'F="$3"; C="$4"; B="$5"',
    'MODE="$(printf %s "$6" | base64 -d)"',
    'OWNER="$(printf %s "$7" | base64 -d)"',
    'GROUP="$(printf %s "$8" | base64 -d)"',
    'VALIDATE="$(printf %s "$9" | base64 -d)"',
    'if [ ! -e "$S" ]; then echo MISSING_SRC; exit 0; fi',
    'if [ -d "$S" ]; then',
    '  SAME=0; if [ -d "$P" ] && diff -rq "$S" "$P" >/dev/null 2>&1; then SAME=1; fi',
    '  if [ "$SAME" = "1" ] && [ "$F" = "0" ]; then echo NOOP;',
    '  elif [ "$C" = "1" ]; then echo WOULD_CHANGE;',
    '  else mkdir -p "$P"; BK=""; if [ "$B" = "1" ] && [ -d "$P" ]; then BK="$P.$(date +%Y%m%d%H%M%S%N).bak"; cp -a "$P" "$BK"; fi; cp -a "$S"/. "$P"/; if [ "$B" = "1" ]; then echo "CHANGED $(printf %s "$BK" | base64 -w0)"; else echo CHANGED; fi; fi',
    'else',
    '  SAME=0; if [ -f "$P" ] && cmp -s "$S" "$P"; then SAME=1; fi',
    '  if [ "$SAME" = "1" ] && [ "$F" = "0" ]; then echo NOOP;',
    '  elif [ "$C" = "1" ]; then echo WOULD_CHANGE;',
    '  else mkdir -p "$(dirname "$P")"; BK=""; if [ "$B" = "1" ] && [ -f "$P" ]; then BK="$P.$(date +%Y%m%d%H%M%S%N).bak"; cp -p "$P" "$BK"; fi; cp -p "$S" "$P"; if [ -n "$VALIDATE" ]; then VCMD="${VALIDATE//%s/$P}"; if ! bash -c "$VCMD"; then echo VALIDATE_FAILED; exit 1; fi; fi; if [ "$B" = "1" ]; then echo "CHANGED $(printf %s "$BK" | base64 -w0)"; else echo CHANGED; fi; fi',
    'fi',
    'if [ -n "$MODE" ]; then chmod -R "$MODE" "$P"; fi',
    'if [ -n "$OWNER" ]; then chown -R "$OWNER" "$P"; fi',
    'if [ -n "$GROUP" ]; then chgrp -R "$GROUP" "$P"; fi',
  ].join("\n");
  return `bash -c '${script}' -- "${srcB64}" "${destB64}" "${fArg}" "${cArg}" "${bkArg}" "${mB64}" "${oB64}" "${gB64}" "${vB64}"`;
}

/** Execute a copy script and normalize its status marker into a ModuleResult. */
async function runCopyCommand(
  ctx: ModuleContext,
  cmd: string,
  dest: string,
  dataBase: Record<string, unknown>,
  opts: CopyOpts,
): Promise<ModuleResult> {
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
  const status = stdout.trim().split(/\s+/)[0];
  if (exitCode !== 0) {
    return { changed: false, failed: true, msg: `${MODULE_NAME}: remote write failed`, stdout, stderr };
  }
  if (status === "MISSING_SRC") {
    return { changed: false, failed: true, msg: `${MODULE_NAME}: remote source does not exist`, stdout, stderr };
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
  if (status === "WOULD_CHANGE") {
    return {
      changed: false,
      skipped: true,
      msg: opts.check ? `${dest} would change (dry run)` : `${dest} would change`,
      data: { ...dataBase, changed: false, wouldChange: true },
    };
  }
  if (status === "NOOP") {
    return { changed: false, skipped: true, msg: `${dest} unchanged`, data: { ...dataBase, changed: false } };
  }
  const backupFile = extractBackup(stdout);
  return {
    changed: true,
    msg: `${String(dataBase.origin ?? MODULE_NAME)} -> ${dest}`,
    stdout,
    data: { ...dataBase, changed: true, ...(backupFile ? { backup_file: backupFile } : {}) },
  };
}

/** Recursively list regular files under `root`, returning paths relative to it. */
function walkLocalFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() || entry.isSymbolicLink()) out.push(relative(root, abs));
    }
  };
  walk(root);
  return out.sort();
}

/** Copy a local directory's contents into `dest` file-by-file. */
async function copyLocalDirectory(
  ctx: ModuleContext,
  absSrc: string,
  dest: string,
  opts: CopyOpts,
): Promise<ModuleResult> {
  const files = walkLocalFiles(absSrc);
  let changed = false;
  let failed = false;
  const failures: string[] = [];
  const destB64For = (p: string) => Buffer.from(p, "utf8").toString("base64");
  for (const rel of files) {
    const abs = join(absSrc, rel);
    const buf = readFileSync(abs);
    const src: SourceBytes = {
      b64: buf.toString("base64"),
      checksum: createHash("sha256").update(buf).digest("hex"),
      origin: `${MODULE_NAME}: ${absSrc}`,
    };
    const target = join(dest, rel);
    const r = await runCopyCommand(ctx, buildCopyScript(destB64For(target), src.b64, opts), target, { dest: target, checksum: src.checksum, origin: src.origin }, opts);
    if (r.failed) {
      failed = true;
      failures.push(`${target}: ${r.msg ?? "failed"}`);
    } else if (r.changed) {
      changed = true;
    }
  }
  if (failed) {
    return { changed: false, failed: true, msg: `${MODULE_NAME}: ${failures[0]}`, data: { dest, files: files.length } };
  }
  if (files.length === 0) {
    // Still create the destination directory for an empty source tree.
    const r = await ctx.connection.exec(`mkdir -p ${shQuote(dest)}`);
    if (r.exitCode !== 0) return { changed: false, failed: true, msg: `${MODULE_NAME}: could not create ${dest}` };
  }
  return {
    changed,
    skipped: !changed,
    msg: changed ? `${absSrc}/* -> ${dest} (${files.length} file(s))` : `${dest} unchanged (${files.length} file(s))`,
    data: { dest, files: files.length },
  };
}

/** Compare every file in a local directory against `dest`; true when all match. */
async function checkLocalDirectory(ctx: ModuleContext, absSrc: string, dest: string): Promise<boolean> {
  const files = walkLocalFiles(absSrc);
  if (files.length === 0) {
    const r = await ctx.connection.exec(`test -d ${shQuote(dest)}`);
    return r.exitCode === 0;
  }
  for (const rel of files) {
    const buf = readFileSync(join(absSrc, rel));
    const checksum = createHash("sha256").update(buf).digest("hex");
    const target = join(dest, rel);
    const destB64 = Buffer.from(target, "utf8").toString("base64");
    const cmd = ctx.become ? `sudo ${buildCompareScript(destB64)}` : buildCompareScript(destB64);
    const res = await ctx.connection.exec(cmd);
    const current = (res.stdout ?? "").trim();
    if (current === "" || current === "MISSING" || current !== checksum) return false;
  }
  return true;
}

/** @summary Copy a local file/directory, inline content, a `content` template spec, or a remote source (`remote_src: true`) to a remote destination idempotently. Local files ship bytes base64-encoded into one compare+write script; local directories copy contents file-by-file; remote sources use `cmp`/`diff -rq` and `cp -a` on the target. Supports on-host templating (content template spec, eta/jinja), atomic mv, optional mode/owner/group, backup, validate, become, and --check. @param ctx ModuleContext carrying copy args (`src`|`content` (string or template spec), `remote_src`, `dest`/`path`, `mode`, `force`, `backup`, `validate`, `owner`, `group`) plus connection/become/check flags. @returns ModuleResult with data.{dest,changed,checksum,backup_file?}; skipped=true when unchanged or in --check dry-run. */
export const copyModule: CheckableModule = {
  name: MODULE_NAME,
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args as unknown as CopyArgs;
    const dest = String(args.dest ?? args.path ?? "");
    if (!dest) {
      return { changed: false, failed: true, msg: `${MODULE_NAME}: 'dest' (or 'path') is required` };
    }
    const hasSrc =
      (typeof args.src === "string" && args.src.length > 0) ||
      (Array.isArray(args.src) && args.src.length > 0 && args.src.every((entry) => typeof entry === "string"));
    const hasContent = typeof args.content === "string" && String(args.content).length > 0;
    const hasTemplate = typeof args.content === "object" && args.content !== null;
    if (!hasSrc && !hasContent && !hasTemplate) {
      return { changed: false, failed: true, msg: `${MODULE_NAME}: one of 'src' or 'content' is required` };
    }
    const opts = copyOpts(args);
    const destB64 = Buffer.from(dest, "utf8").toString("base64");

    if (args.remote_src === true) {
      if (!hasSrc) {
        return { changed: false, failed: true, msg: `${MODULE_NAME}: 'src' is required with remote_src: true` };
      }
      const srcRef = String(args.src);
      const srcB64 = Buffer.from(srcRef, "utf8").toString("base64");
      return runCopyCommand(
        ctx,
        buildRemoteSrcScript(destB64, srcB64, opts),
        dest,
        { dest, checksum: "", origin: `${MODULE_NAME}: remote ${srcRef}` },
        opts,
      );
    }

    if (hasSrc) {
      const ref = Array.isArray(args.src) ? (args.src as string[]) : String(args.src);
      const abs = resolveSourcePath(ref, ctx.roleDir, ctx.playbookDir);
      try {
        if (statSync(abs).isDirectory()) return copyLocalDirectory(ctx, abs, dest, opts);
      } catch {
        // fall through to the file path resolver for a precise missing-file error
      }
    }

    const src = await resolveSource(ctx);
    return runCopyCommand(
      ctx,
      buildCopyScript(destB64, src.b64, opts),
      dest,
      { dest, checksum: src.checksum, origin: src.origin },
      opts,
    );
  },
  /** Report current target state for declarative reconciliation (used by applyIdempotent's skip-unchanged path). */
  async check(_args: Record<string, unknown>, ctx: ModuleContext): Promise<{ current: string | null; inDesired: boolean }> {
    const args = ctx.args as unknown as CopyArgs;
    const dest = String(args.dest ?? args.path ?? "");
    if (args.remote_src === true) {
      // The remote copy script owns idempotency; there is no local source to hash.
      return { current: null, inDesired: false };
    }
    if ((typeof args.src === "string" && args.src.length > 0) || (Array.isArray(args.src) && args.src.length > 0)) {
      const abs = resolveSourcePath(args.src as string | string[], ctx.roleDir, ctx.playbookDir);
      try {
        if (statSync(abs).isDirectory()) {
          return { current: null, inDesired: await checkLocalDirectory(ctx, abs, dest) };
        }
      } catch {
        // fall through to the file path
      }
    }
    const src = await resolveSource(ctx);
    const destB64 = Buffer.from(dest, "utf8").toString("base64");
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
    "Literal idempotent file or directory copy to a remote target, on-target copy with remote_src, or on-host template render (content/template_file, EJS or Jinja). SHA-256/cmp/diff compare; ships bytes base64-encoded and decodes on-target. Supports inline content, local files/directories, remote_src, optional mode/owner/group, backup, validate, become, and --check.",
  source: "builtin",
  args: {
    src: {
      type: "string",
      required: false,
      description: "Local path to a source file/directory, or an ordered list of candidate paths (first existing wins); with `remote_src: true` it is a target-side path. At least one of `src` or `content` is required.",
    },
    remote_src: {
      type: "boolean",
      required: false,
      description: "Treat `src` as a target-side path and copy it on the target (files and directory contents). Defaults to false.",
    },
    content: {
      type: "string | { template, template_file, engine }",
      required: false,
      description: "Inline content for the destination. A bare string is written verbatim (never interpreted as a template). Pass an object with `template` (inline string) or `template_file` (path) and optional `engine` ('ejs' default, or 'jinja') to render on-host. In a playbook, inline Jinja is lint-rejected; use `$jinja` or a `.j2` `template_file`.",
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
    src: files/conf.d
    dest: /etc/app/conf.d
    mode: '0644'`,
    `- copy:
    remote_src: true
    src: /opt/staging/app.conf
    dest: /etc/app/app.conf`,
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
    "≠ Ansible `copy`: **`force` defaults to FALSE** (Ansible defaults TRUE), so copy only rewrites when the destination differs unless you pass force:true. A local directory `src` copies its **contents** into `dest` (no `src/` trailing-slash distinction). `remote_src: true` copies a target-side path on the target using `cmp`/`diff -rq` for idempotency and `cp -a` for the transfer. Source paths resolve against `<role>/files/`, `<role>/src/`, `<playbook>/files/`, `<playbook>/`, then cwd; `template_file` resolves against `<role>/templates/`, `<playbook>/templates/`, `<playbook>/`, then cwd. Templating is on-host: pass `content` as an object with `template`/`template_file` and optional `engine` (EJS default, or `jinja`); a bare `content` string is written literally (never interpreted as a template). Playbook lint rejects inline Jinja (`content.template` with `engine: jinja`); use `$jinja` or a `.j2` `template_file` instead. Attribute application relies on stat/chown/chgrp availability; no SELinux context handling.",
};

(copyModule as Module & { meta: ModuleSummary }).meta = meta;
export default copyModule;
