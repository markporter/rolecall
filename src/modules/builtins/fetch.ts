// Built-in module: `fetch` — Ansible `fetch` alternate (pull a remote file to the control node).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Pull a file from the target to the control node (Ansible `fetch` alternate). Reads the remote file base64-encoded, writes it locally, and skips when the local copy already matches. @param ctx ModuleContext carrying `src` (remote path), `dest` (local dir), `flat`, `fail_on_missing`, `check`/`_check`. @returns ModuleResult with the local `dest` and `checksum` in `data`. */
export const fetchModule: Module = {
  name: "fetch",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const src = String(ctx.args["src"] ?? "");
    if (!src) return { changed: false, failed: true, msg: "fetch: 'src' (remote path) is required" };
    const destDir = typeof ctx.args["dest"] === "string" ? String(ctx.args["dest"]) : "";
    if (!destDir) return { changed: false, failed: true, msg: "fetch: 'dest' (local dir) is required" };
    const flat = Boolean(ctx.args["flat"]);
    const failOnMissing = ctx.args["fail_on_missing"] !== false;
    const check = Boolean(ctx.args["check"] ?? ctx.args["_check"]);

    const res = await ctx.connection.exec(`cat ${shQuote(src)} | base64 -w0`);
    if (res.exitCode !== 0) {
      if (!failOnMissing) return { changed: false, msg: `fetch: ${src} missing (skipped)` };
      return { changed: false, failed: true, msg: `fetch: cannot read ${src} on target` };
    }
    const buf = Buffer.from((res.stdout ?? "").trim(), "base64");
    const localName = flat ? basename(src) : src.replace(/^\//, "").replace(/\//g, "_");
    const localPath = join(destDir, localName);
    mkdirSync(dirname(localPath), { recursive: true });
    const checksum = createHash("sha256").update(buf).digest("hex");

    if (existsSync(localPath) && readFileSync(localPath).equals(buf)) {
      return { changed: false, msg: `fetch: ${src} already at ${localPath}`, data: { dest: localPath, checksum } };
    }
    if (check) return { changed: true, skipped: true, msg: `fetch: would fetch ${src} (dry run)`, data: { dest: localPath, checksum } };
    writeFileSync(localPath, buf);
    return { changed: true, msg: `fetch: ${src} -> ${localPath}`, data: { dest: localPath, checksum } };
  },
};

/** Search metadata for the `fetch` module. */
export const meta: ModuleSummary = {
  name: "fetch",
  description: "Pull a file from the target to the local control node (Ansible `fetch` alternate). Reads the remote file base64-encoded and skips when the local copy already matches.",
  source: "builtin",
  args: {
    src: { type: "string", required: true, description: "Remote path to fetch." },
    dest: { type: "string", required: true, description: "Local directory to write into." },
    flat: { type: "boolean", required: false, description: "Use the bare filename instead of the full path as the local name." },
    fail_on_missing: { type: "boolean", required: false, description: "Fail if the remote file is absent (default true)." },
  },
  examples: [
    `- fetch:
    src: /var/log/app.log
    dest: /tmp/logs
    flat: true`,
  ],
  notes: "RoleCall `copy` only pushes; `fetch` is the pull direction (Ansible `fetch`). Local path layout mirrors Ansible: full path with `/` → `_` unless `flat: true`.",
};

(fetchModule as Module & { meta: ModuleSummary }).meta = meta;
export default fetchModule;
