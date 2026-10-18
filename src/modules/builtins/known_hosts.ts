// Built-in module: `known_hosts` — Ansible `known_hosts` alternate (manage SSH known_hosts).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Manage an SSH known_hosts entry (Ansible `known_hosts` alternate). Adds/removes a `name key` line idempotently. @param ctx ModuleContext carrying `name`, `key`, `path`, `state`. @returns ModuleResult; `skipped` when unchanged. */
export const knownHostsModule: Module = {
  name: "known_hosts",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const name = typeof a["name"] === "string" ? String(a["name"]) : "";
    if (!name) return { changed: false, failed: true, msg: "known_hosts: 'name' (hostname) is required" };
    const key = typeof a["key"] === "string" ? String(a["key"]) : "";
    const state = typeof a["state"] === "string" ? String(a["state"]) : "present";
    const path = typeof a["path"] === "string" ? String(a["path"]) : "/etc/ssh/ssh_known_hosts";

    const read = await ctx.connection.exec(`cat ${shQuote(path)} 2>/dev/null`);
    const lines = read.stdout ? read.stdout.split("\n") : [];

    if (state === "absent") {
      const kept = lines.filter((l) => !(l.trim() && l.split(/\s+/)[0] === name));
      const newContent = kept.join("\n") + (kept.length ? "\n" : "");
      if (newContent === (lines.join("\n") + (lines.length ? "\n" : "")))
        return { changed: false, skipped: true, msg: `known_hosts: ${name} unchanged` };
      await writeFile(ctx, path, newContent);
      return { changed: true, msg: `known_hosts: removed ${name}` };
    }
    if (!key) return { changed: false, failed: true, msg: "known_hosts: 'key' is required when state=present" };
    const line = `${name} ${key.trim()}`;
    const exists = lines.some((l) => l.trim() === line || (l.split(/\s+/)[0] === name && l.split(/\s+/).slice(1).join(" ") === key.trim()));
    if (exists) return { changed: false, skipped: true, msg: `known_hosts: ${name} unchanged` };
    const next = [...lines.filter((l) => l.trim() && l.split(/\s+/)[0] !== name), line];
    const newContent = next.join("\n") + (next.length ? "\n" : "");
    await writeFile(ctx, path, newContent);
    return { changed: true, msg: `known_hosts: ensured ${name}` };
  },
};

async function writeFile(ctx: ModuleContext, path: string, content: string): Promise<void> {
  const dir = path.replace(/\/[^\/]+$/, "");
  const delim = `RoleCallKH_${Date.now()}`;
  const cmd = ctx.become
    ? `sudo mkdir -p ${shQuote(dir)} && sudo sh -c 'cat > ${shQuote(path)} <<${delim}\n${content}${delim}'`
    : `mkdir -p ${shQuote(dir)} && cat > ${shQuote(path)} <<'${delim}'\n${content}${delim}`;
  const w = await ctx.connection.exec(cmd);
  if (w.exitCode !== 0) throw new Error(`known_hosts: write failed: ${w.stderr || `exit ${w.exitCode}`}`);
}

/** Search metadata for the `known_hosts` module. */
export const meta: ModuleSummary = {
  name: "known_hosts",
  description: "Manage an SSH known_hosts entry (Ansible `known_hosts` alternate). Adds/removes a `name key` line idempotently; defaults to the system /etc/ssh/ssh_known_hosts.",
  source: "builtin",
  args: {
    name: { type: "string", required: true, description: "Hostname or address to trust." },
    key: { type: "string", required: false, description: "Public key line (required when state=present)." },
    path: { type: "string", required: false, description: "known_hosts file (default /etc/ssh/ssh_known_hosts)." },
    state: { type: "present | absent", required: false, description: "Desired state (default present)." },
  },
  examples: [
    `- known_hosts:
    name: github.com
    key: "github.com ssh-rsa AAAA..."`,
  ],
  notes: "≠ Ansible `known_hosts`: no `hostkey_algorithm`/`ca_cert` handling; supply the full `key` line. Use a `shell` task with `ssh-keyscan` to fetch the key dynamically.",
};

(knownHostsModule as Module & { meta: ModuleSummary }).meta = meta;
export default knownHostsModule;
