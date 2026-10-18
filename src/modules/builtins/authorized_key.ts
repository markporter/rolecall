// Built-in module: `authorized_key` — Ansible `authorized_key` alternate (manage SSH authorized keys).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote, wrapCommand } from "./fs";

/** @summary Manage an SSH authorized_keys entry (Ansible `authorized_key` alternate). Adds/removes the `key` line for `user` idempotently. @param ctx ModuleContext carrying `user`, `key`, `state`, `exclusive`, `path`. @returns ModuleResult; `skipped` when unchanged. */
export const authorizedKeyModule: Module = {
  name: "authorized_key",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const user = typeof a["user"] === "string" ? String(a["user"]) : "root";
    const key = typeof a["key"] === "string" ? String(a["key"]) : "";
    if (!key) return { changed: false, failed: true, msg: "authorized_key: 'key' is required" };
    const state = typeof a["state"] === "string" ? String(a["state"]) : "present";
    const exclusive = Boolean(a["exclusive"]);

    const homeRes = await ctx.connection.exec(`getent passwd ${shQuote(user)} | cut -d: -f6`);
    const home = (homeRes.stdout ?? "").trim() || (user === "root" ? "/root" : `/home/${user}`);
    const path = typeof a["path"] === "string" ? String(a["path"]) : `${home}/.ssh/authorized_keys`;

    const read = await ctx.connection.exec(`cat ${shQuote(path)} 2>/dev/null`);
    const lines = read.stdout ? read.stdout.split("\n") : [];
    const keyBlob = key.trim().split(/\s+/).slice(0, 2).join(" "); // type + base64
    const matches = (l: string) => l.trim().split(/\s+/).slice(0, 2).join(" ") === keyBlob;
    const comment = typeof a["comment"] === "string" ? String(a["comment"]) : "";
    const keyOptions = typeof a["key_options"] === "string" ? String(a["key_options"]) : "";
    const keyLine = `${keyOptions ? keyOptions + " " : ""}${keyBlob}${comment ? " " + comment : ""}`;

    if (state === "absent") {
      const kept = lines.filter((l) => !(l.trim() && matches(l)));
      const newContent = kept.join("\n") + (kept.length ? "\n" : "");
      if (newContent === (lines.join("\n") + (lines.length ? "\n" : "")))
        return { changed: false, skipped: true, msg: `authorized_key: ${user} unchanged` };
      await writeFile(ctx, path, newContent);
      return { changed: true, msg: `authorized_key: removed key for ${user}` };
    }

    let next: string[];
    if (exclusive) next = [keyLine];
    else {
      const without = lines.filter((l) => !(l.trim() && matches(l)));
      next = [...without, keyLine];
    }
    const newContent = next.join("\n") + (next.length ? "\n" : "");
    const oldContent = lines.join("\n") + (lines.length ? "\n" : "");
    if (newContent === oldContent) return { changed: false, skipped: true, msg: `authorized_key: ${user} unchanged` };
    await writeFile(ctx, path, newContent);
    return { changed: true, msg: `authorized_key: ensured key for ${user}` };
  },
};

async function writeFile(ctx: ModuleContext, path: string, content: string): Promise<void> {
  const dir = path.replace(/\/[^\/]+$/, "");
  const delim = `RoleCallAUTH_${Date.now()}`;
  const cmd = `mkdir -p ${shQuote(dir)} && cat > ${shQuote(path)} <<'${delim}'\n${content}${delim} && chmod 600 ${shQuote(path)}`;
  const w = await ctx.connection.exec(wrapCommand(cmd, { become: Boolean(ctx.become), becomeUser: ctx.become_user, environment: ctx.environment }));
  if (w.exitCode !== 0) throw new Error(`authorized_key: write failed: ${w.stderr || `exit ${w.exitCode}`}`);
}

/** Search metadata for the `authorized_key` module. */
export const meta: ModuleSummary = {
  name: "authorized_key",
  description: "Manage an SSH authorized_keys entry (Ansible `authorized_key` alternate). Adds/removes the `key` line for `user` idempotently; creates the file with 0600 if missing.",
  source: "builtin",
  args: {
    user: { type: "string", required: false, description: "Target user (default root)." },
    key: { type: "string", required: true, description: "Public key line (e.g. 'ssh-rsa AAAA...')." },
    state: { type: "present | absent", required: false, description: "Desired state (default present)." },
    exclusive: { type: "boolean", required: false, description: "Replace all other keys with this one." },
    path: { type: "string", required: false, description: "Explicit authorized_keys path." },
    comment: { type: "string", required: false, description: "Trailing comment appended to the key line (e.g. an owner note)." },
    key_options: { type: "string", required: false, description: "Options prefix before the key, e.g. 'command=\"...\"' or 'no-port-forwarding'." },
  },
  examples: [
    `- authorized_key:
    user: deploy
    key: "ssh-rsa AAAA... user@laptop"
    exclusive: true`,
  ],
  notes: "≠ Ansible `authorized_key`: `manage_dir` not modeled (the dir is always created with 0600); matches keys by type+base64. `comment`/`key_options` are supported on the written line.",
};

(authorizedKeyModule as Module & { meta: ModuleSummary }).meta = meta;
export default authorizedKeyModule;
