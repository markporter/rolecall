// Built-in module: `hostname` — Ansible `hostname` alternate (set the system hostname).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

const HOSTNAME_USE = ["systemd", "network", "non-os"] as const;
type HostnameUse = (typeof HOSTNAME_USE)[number];

/** @summary Set the target hostname (Ansible `hostname` alternate). `use` selects how it is persisted: `systemd` (`hostnamectl set-hostname`), `network` (`/etc/sysconfig/network`), `non-os` (runtime `hostname` only), or auto (systemd when `hostnamectl` exists, else `hostname` + `/etc/hostname`). @param ctx ModuleContext carrying `name` and optional `use`. @returns ModuleResult; `skipped` when unchanged. */
export const hostnameModule: Module = {
  name: "hostname",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const name = typeof ctx.args["name"] === "string" ? String(ctx.args["name"]) : "";
    if (!name) return { changed: false, failed: true, msg: "hostname: 'name' is required" };

    const useArg = ctx.args["use"];
    const use = useArg === undefined || useArg === null ? "" : String(useArg);
    if (use && !(HOSTNAME_USE as readonly string[]).includes(use)) {
      return {
        changed: false,
        failed: true,
        msg: `hostname: invalid 'use' ${JSON.stringify(use)}; expected one of ${HOSTNAME_USE.join(", ")}`,
      };
    }

    const cur = await ctx.connection.exec(`hostname 2>/dev/null || cat /etc/hostname 2>/dev/null`);
    const current = (cur.stdout ?? "").trim().split("\n")[0] ?? "";
    if (current === name) return { changed: false, skipped: true, msg: `hostname: already ${name}` };

    let setCmd: string;
    switch (use as HostnameUse | "") {
      case "systemd":
        setCmd = `hostnamectl set-hostname ${shQuote(name)}`;
        break;
      case "network": {
        const script =
          `f=/etc/sysconfig/network; ` +
          `if grep -q '^HOSTNAME=' "$f" 2>/dev/null; ` +
          `then sed -i "s|^HOSTNAME=.*|HOSTNAME=$1|" "$f"; ` +
          `else printf 'HOSTNAME=%s\\n' "$1" >> "$f"; fi`;
        setCmd = `sh -c ${shQuote(script)} sh ${shQuote(name)}`;
        break;
      }
      case "non-os":
        setCmd = `hostname ${shQuote(name)}`;
        break;
      default: {
        const hasSystemd = (await ctx.connection.exec(`command -v hostnamectl`)).exitCode === 0;
        setCmd = hasSystemd
          ? `hostnamectl set-hostname ${shQuote(name)}`
          : `hostname ${shQuote(name)} && sh -c 'echo ${shQuote(name)} > /etc/hostname'`;
      }
    }
    const run = ctx.become ? `sudo sh -c ${shQuote(setCmd)}` : setCmd;
    const res = await ctx.connection.exec(run);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `hostname: failed: ${res.stderr || `exit ${res.exitCode}`}` };
    return { changed: true, msg: `hostname: -> ${name}` };
  },
};

/** Search metadata for the `hostname` module. */
export const meta: ModuleSummary = {
  name: "hostname",
  description: "Set the target hostname (Ansible `hostname` alternate). `use` selects systemd, network (/etc/sysconfig/network), non-OS (runtime), or auto-detect.",
  source: "builtin",
  args: {
    name: { type: "string", required: true, description: "Desired hostname." },
    use: { type: "systemd | network | non-os", required: false, description: "How to persist the hostname: systemd (`hostnamectl`), network (`/etc/sysconfig/network`), or non-os (runtime only). Defaults to systemd when `hostnamectl` exists, else `hostname` + `/etc/hostname`." },
  },
  examples: [
    `- hostname:
    name: web-01`,
    `- hostname:
    name: web-01
    use: systemd`,
  ],
  notes: "≠ Ansible `hostname`: honors the `use` selection (`systemd`/`network`/`non-os`, otherwise auto-detect systemd). Like Ansible, this module does not manage /etc/hosts for any mode — manage the hosts file via `lineinfile`/`copy`.",
};

(hostnameModule as Module & { meta: ModuleSummary }).meta = meta;
export default hostnameModule;
