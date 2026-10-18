// Batteries-included idempotent `get_url` module (next-wave module parity).
//
// Downloads a file from a URL onto the *target host* over the SSH/Local
// transport (NOT from the RoleCall control process — that is the `http` module's
// job). Idempotency is file-state based: if the destination already exists and,
// when supplied, its sha256 checksum matches, the task is a no-op. Requires
// `curl` (preferred) or `wget` on the target.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Download a file from a URL to a path on the managed host over the transport, verifying an optional sha256 checksum and applying file attributes. @param args GetUrlArgs (url, dest, checksum?, mode?, owner?, group?, timeout?). @returns Module with `meta` attached. */
export interface GetUrlArgs {
  /** Source URL to download. */
  url: string;
  /** Destination path on the target; trailing slash appends the URL basename. */
  dest: string;
  /** Optional expected checksum, `sha256:hex` or bare hex. */
  checksum?: string;
  /** Octal mode, e.g. "0644". */
  mode?: string;
  /** Owner (chown); requires become for non-root targets. */
  owner?: string;
  /** Group (chgrp); requires become for non-root targets. */
  group?: string;
  /** Download timeout in seconds (passed to curl -m / wget --timeout). */
  timeout?: number;
  /** Force re-download even when the file already matches. */
  force?: unknown;
  /** Internal: set by `--force` global passthrough. */
  _force?: unknown;
  /** Internal: set by `--check` global passthrough. */
  _check?: unknown;
  /** Internal: set by `--check` global passthrough. */
  check?: unknown;
}

const MODULE_NAME = "get_url";

/** Search metadata for the `get_url` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: MODULE_NAME,
  description:
    "Download a file from a URL onto the managed host, verifying an optional sha256 checksum and applying file attributes.",
  idempotent: true,
  source: "builtin",
  args: {
    url: { type: "string", required: true, description: "Source URL to download." },
    dest: { type: "string", required: true, description: "Destination path; trailing slash appends the URL basename." },
    checksum: { type: "string", required: false, description: "Expected sha256 checksum (sha256:hex or bare hex)." },
    mode: { type: "string", required: false, description: "Octal file mode, e.g. 0644." },
    owner: { type: "string", required: false, description: "Owner to chown to (needs become)." },
    group: { type: "string", required: false, description: "Group to chgrp to (needs become)." },
    timeout: { type: "number", required: false, description: "Download timeout in seconds." },
  },
};

function parseChecksum(c?: unknown): string | undefined {
  if (typeof c !== "string" || c.length === 0) return undefined;
  return c.startsWith("sha256:") ? c.slice("sha256:".length) : c;
}

function resolveDest(url: string, dest: string): string {
  if (dest.endsWith("/")) {
    const noQuery = url.split("?")[0] ?? "";
    const noHash = noQuery.split("#")[0] ?? "";
    const base = noHash.split("/").pop() || "download";
    return dest + base;
  }
  return dest;
}

/** @summary Download a file from a URL to a path on the managed host. Idempotent: skips when the destination exists and (if set) its sha256 matches. @param ctx ModuleContext (connection, args, become). @returns ModuleResult with changed/skipped/failed and data. */
export const getUrlModule: Module = {
  name: MODULE_NAME,
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args as unknown as GetUrlArgs;
    const url = String(args.url ?? "");
    if (!url) return { changed: false, failed: true, msg: "get_url: 'url' is required" } as ModuleResult;
    const dest = resolveDest(url, String(args.dest ?? ""));
    if (!dest) return { changed: false, failed: true, msg: "get_url: 'dest' is required" } as ModuleResult;

    const sudo = ctx.become ? "sudo " : "";
    const checkMode = Boolean(args._check ?? args.check);
    const force = Boolean(args.force ?? args._force);
    const expected = parseChecksum(args.checksum);
    const data: Record<string, unknown> = { url, dest };

    const existsRes = await ctx.connection.exec(`${sudo}test -e ${shQuote(dest)}`);
    const exists = existsRes.exitCode === 0;
    let current = "";
    if (exists) {
      const s = await ctx.connection.exec(`${sudo}sha256sum ${shQuote(dest)}`);
      current = s.exitCode === 0 ? (s.stdout.split(/\s+/)[0] ?? "") : "";
    }
    const matches = expected ? current === expected : false;
    const wouldChange = !exists || force || (expected && !matches);
    if (checkMode) {
      if (wouldChange)
        return { changed: false, skipped: true, msg: `${dest} would be fetched`, data: { ...data, wouldChange: true } } as ModuleResult;
      return { changed: false, skipped: true, msg: `${dest} present`, data } as ModuleResult;
    }
    if (!wouldChange) return { changed: false, skipped: true, msg: `${dest} unchanged`, data } as ModuleResult;

    const timeoutFlag = typeof args.timeout === "number" ? ` -m ${args.timeout}` : "";
    const wgetTimeout = typeof args.timeout === "number" ? ` --timeout=${args.timeout}` : "";
    const dl = `${sudo}(curl -fsSL${timeoutFlag} -o ${shQuote(dest)} ${shQuote(url)} || wget -q${wgetTimeout} -O ${shQuote(dest)} ${shQuote(url)})`;
    const res = await ctx.connection.exec(dl);
    if (res.exitCode !== 0)
      return { changed: false, failed: true, stderr: res.stderr || "", msg: `get_url: download failed: ${res.stderr.trim() || `exit ${res.exitCode}`}`, data } as ModuleResult;

    if (expected) {
      const v = await ctx.connection.exec(`${sudo}sha256sum ${shQuote(dest)}`);
      const got = v.exitCode === 0 ? (v.stdout.split(/\s+/)[0] ?? "") : "";
      if (got !== expected)
        return { changed: false, failed: true, stderr: v.stderr || "", msg: `get_url: checksum mismatch for ${dest}`, data } as ModuleResult;
    }

    const mode = typeof args.mode === "string" ? args.mode : "";
    const owner = typeof args.owner === "string" ? args.owner : "";
    const group = typeof args.group === "string" ? args.group : "";
    if (mode) await ctx.connection.exec(`${sudo}chmod ${mode} ${shQuote(dest)}`);
    if (owner) await ctx.connection.exec(`${sudo}chown ${owner} ${shQuote(dest)}`);
    if (group) await ctx.connection.exec(`${sudo}chgrp ${group} ${shQuote(dest)}`);
    return { changed: true, msg: `${url} -> ${dest}`, data: { ...data, checksum: expected } } as ModuleResult;
  },
};
(getUrlModule as Module & { meta: ModuleSummary }).meta = meta;
export default getUrlModule;
