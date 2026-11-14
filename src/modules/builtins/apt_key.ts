// Built-in module: `apt_key` — Ansible `apt_key` alternate (APT signing keys).
//
// Manages keys in a modern standalone keyring with `gpg`, avoiding the removed
// `apt-key` command. URLs and keyserver fetches run over the target connection;
// `data` accepts an armored key inline. Read-only probes use `gpg --list-keys`.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { CheckableModule } from "../../idempotency/types";
import type { ModuleSummary } from "../search";
import { shQuote, wrapCommand } from "./fs";

interface AptKeyArgs {
  /** URL of an armored key. */
  url?: string;
  /** Inline armored key data. */
  data?: string;
  /** Key ID/fingerprint (required for keyserver and state: absent). */
  id?: string;
  /** Keyserver to fetch `id` from. */
  keyserver?: string;
  /** Keyring path (default /etc/apt/trusted.gpg). */
  keyring?: string;
  /** Desired state: present (default) or absent. */
  state?: "present" | "absent";
  /** When false, curl ignores certificate validation. */
  validate_certs?: boolean;
}

function keyringPath(a: AptKeyArgs): string {
  return typeof a.keyring === "string" && a.keyring.length > 0 ? a.keyring : "/etc/apt/trusted.gpg";
}

function gpgBase(keyring: string): string {
  return `gpg --batch --no-default-keyring --keyring ${shQuote(keyring)}`;
}

function hasBinaryCommand(keyring: string, id: string): string {
  return `${gpgBase(keyring)} --list-keys ${shQuote(id)}`;
}

async function runCommand(
  ctx: ModuleContext,
  cmd: string,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return ctx.connection.exec(
    wrapCommand(cmd, {
      become: Boolean(ctx.become),
      becomeUser: ctx.become_user,
      environment: ctx.environment,
    }),
  );
}

/** @summary Manage an APT signing key in a standalone keyring (Ansible `apt_key` alternate). @param ctx ModuleContext carrying url/data/id/keyserver/keyring/state. @returns ModuleResult; fails with actionable messages when a source is missing or gpg rejects the key. */
export const aptKeyModule: Module & CheckableModule = {
  name: "apt_key",
  network: true,
  supportsCheck: true,
  async check(args, ctx) {
    const a = args as unknown as AptKeyArgs;
    const keyring = keyringPath(a);
    const state = a.state ?? "present";
    if (typeof a.id === "string" && a.id.length > 0) {
      const res = await runCommand(ctx, hasBinaryCommand(keyring, a.id));
      const present = res.exitCode === 0;
      return { current: { present }, inDesired: state === "present" ? present : !present };
    }
    return { current: null, inDesired: false };
  },
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args as unknown as AptKeyArgs;
    const keyring = keyringPath(a);
    const state = a.state ?? "present";
    const id = typeof a.id === "string" && a.id.length > 0 ? a.id : undefined;
    const dir = keyring.replace(/\/[^/]+$/, "");
    const mkdir = `mkdir -p ${shQuote(dir)}`;

    if (state === "absent") {
      if (id === undefined) {
        return { changed: false, failed: true, msg: "apt_key: 'id' is required for state: absent" };
      }
      const probe = await runCommand(ctx, hasBinaryCommand(keyring, id));
      if (probe.exitCode !== 0) {
        return { changed: false, skipped: true, msg: `apt_key: ${id} absent (no-op)` };
      }
      const res = await runCommand(ctx, `${gpgBase(keyring)} --delete-key ${shQuote(id)}`);
      if (res.exitCode !== 0) {
        return { changed: false, failed: true, msg: `apt_key: failed to delete ${id}: ${res.stderr.trim() || `exit ${res.exitCode}`}` };
      }
      return { changed: true, msg: `apt_key: removed ${id}` };
    }

    if (id !== undefined) {
      const probe = await runCommand(ctx, hasBinaryCommand(keyring, id));
      if (probe.exitCode === 0) {
        return { changed: false, skipped: true, msg: `apt_key: ${id} already present` };
      }
    }

    const armored = keyring.endsWith(".asc");
    const write = armored ? `cat > ${shQuote(keyring)}` : `gpg --batch --dearmor > ${shQuote(keyring)}`;
    let fetch: string;
    if (typeof a.data === "string" && a.data.length > 0) {
      fetch = `printf '%s' ${shQuote(a.data)} | ${write}`;
    } else if (typeof a.url === "string" && a.url.length > 0) {
      const insecure = a.validate_certs === false ? " -k" : "";
      fetch = `curl -fsSL${insecure} ${shQuote(a.url)} | ${write}`;
    } else if (id !== undefined && typeof a.keyserver === "string" && a.keyserver.length > 0) {
      const res = await runCommand(
        ctx,
        `${mkdir} && ${gpgBase(keyring)} --keyserver ${shQuote(a.keyserver)} --recv-keys ${shQuote(id)}`,
      );
      if (res.exitCode !== 0) {
        return { changed: false, failed: true, msg: `apt_key: failed to fetch ${id}: ${res.stderr.trim() || `exit ${res.exitCode}`}` };
      }
      return { changed: true, msg: `apt_key: added ${id} from ${a.keyserver}` };
    } else {
      return {
        changed: false,
        failed: true,
        msg: "apt_key: one of 'url', 'data', or ('keyserver' + 'id') is required for state: present",
      };
    }

    const res = await runCommand(ctx, `${mkdir} && ${fetch}`);
    if (res.exitCode !== 0) {
      return { changed: false, failed: true, msg: `apt_key: failed to install key: ${res.stderr.trim() || `exit ${res.exitCode}`}` };
    }
    return { changed: true, msg: `apt_key: installed key into ${keyring}` };
  },
};

/** Search metadata for the `apt_key` module. */
export const meta: ModuleSummary = {
  name: "apt_key",
  description:
    "Manage an APT signing key in a standalone keyring with gpg (Ansible `apt_key` alternate).",
  source: "builtin",
  args: {
    url: { type: "string", required: false, description: "URL of an armored key." },
    data: { type: "string", required: false, description: "Inline armored key data." },
    id: { type: "string", required: false, description: "Key ID/fingerprint (required for keyserver and state: absent)." },
    keyserver: { type: "string", required: false, description: "Keyserver to fetch `id` from." },
    keyring: { type: "string", required: false, description: "Keyring path (default /etc/apt/trusted.gpg)." },
    state: { type: "present | absent", required: false, description: "Desired state (default present)." },
    validate_certs: { type: "boolean", required: false, description: "Set false to pass `-k` to curl." },
  },
  examples: [
    `- apt_key:
    url: https://example.com/repo.asc
    keyring: /usr/share/keyrings/example.gpg`,
  ],
  notes:
    "≠ Ansible `apt_key`: uses `gpg --no-default-keyring --keyring` instead of the removed `apt-key`; requires `gpg` (and `curl` for URLs) on the target. Inline `data` is piped through `gpg --dearmor` unless the keyring ends in `.asc`. Idempotency needs `id`; without it the key is re-installed each run.",
};

(aptKeyModule as Module & CheckableModule & { meta: ModuleSummary }).meta = meta;
export default aptKeyModule;
