// Built-in module: `service` — idempotent systemd/ SysV enable/start/stop (Todo 15, extended for Ansible parity).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";

interface ServiceArgs {
  /** Unit name, e.g. "nginx". Required. */
  name: string;
  /** Enable the unit (default true). */
  enabled?: boolean;
  /** Desired active state. */
  state?: "started" | "stopped" | "restarted" | "reloaded";
  /** Run `systemctl daemon-reload` first (systemd only). */
  daemon_reload?: boolean;
  /** Ignored — kept for drop-in Ansible parity (no-op). */
  pattern?: string;
  /** Ignored — kept for drop-in Ansible parity (no-op). */
  sleep?: number;
}

/** @summary Idempotent service enable/start/stop (Ansible `service`/`systemd` alternate). Probes current state before acting; supports `daemon_reload`, `state: reloaded`, and a SysV `service` fallback when systemd is absent. @param ctx ModuleContext carrying `name`, `enabled`, `state`, `daemon_reload`. @returns ModuleResult; `changed:false` when the desired state already holds. */
export const serviceModule: Module = {
  name: "service",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args as unknown as ServiceArgs;
    const name = String(args.name ?? "");
    if (!name) return { changed: false, failed: true, msg: "service: 'name' is required" };
    const conn = ctx.connection;
    const sudo = ctx.become ? "sudo " : "";
    const wantEnabled = args.enabled ?? true;
    const wantState = args.state ?? "started";
    const log: string[] = [];
    let changed = false;

    const hasSystemd = (await conn.exec(`${sudo}command -v systemctl`)).exitCode === 0;
    const svc = (verb: string, fallbackVerb: string) =>
      hasSystemd ? `${sudo}systemctl ${verb} ${name}` : `${sudo}service ${name} ${fallbackVerb}`;
    const active = () => (hasSystemd ? `${sudo}systemctl is-active ${name}` : `${sudo}service ${name} status`);
    const enabled = () => (hasSystemd ? `${sudo}systemctl is-enabled ${name}` : `${sudo}systemctl is-enabled ${name} 2>/dev/null`);

    if (args.daemon_reload && hasSystemd) {
      await conn.exec(`${sudo}systemctl daemon-reload`);
      changed = true;
      log.push("daemon-reload");
    }

    if (wantEnabled && hasSystemd) {
      const en = await conn.exec(enabled());
      if (en.exitCode !== 0) {
        await conn.exec(`${sudo}systemctl enable ${name}`);
        changed = true;
        log.push(`enabled ${name}`);
      }
    }

    if (wantState === "started") {
      if ((await conn.exec(active())).exitCode !== 0) {
        await conn.exec(svc("start", "start"));
        changed = true;
        const recheck = await conn.exec(active());
        log.push(recheck.exitCode === 0 ? `started ${name}` : `started ${name} (warning: still inactive)`);
      }
    } else if (wantState === "stopped") {
      if ((await conn.exec(active())).exitCode === 0) {
        await conn.exec(svc("stop", "stop"));
        changed = true;
        log.push(`stopped ${name}`);
      }
    } else if (wantState === "restarted") {
      await conn.exec(svc("restart", "restart"));
      changed = true;
      log.push(`restarted ${name}`);
    } else if (wantState === "reloaded") {
      await conn.exec(svc("reload", "reload"));
      changed = true;
      log.push(`reloaded ${name}`);
    }

    return { changed, stdout: log.join("\n"), msg: changed ? `service ${name} updated` : `service ${name} unchanged` };
  },
};

/** Search metadata for the `service` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: "service",
  description:
    "Idempotent service enable/start/stop (Ansible `service`/`systemd` alternate). Probes current state before acting; supports `daemon_reload`, `state: reloaded`, and a SysV `service` fallback when systemd is absent.",
  idempotent: true,
  source: "builtin",
  args: {
    name: { type: "string", required: true, description: "Unit name, e.g. 'nginx'." },
    enabled: { type: "boolean", required: false, description: "Enable the unit (default true)." },
    state: { type: "started | stopped | restarted | reloaded", required: false, description: "Desired active state (default 'started')." },
    daemon_reload: { type: "boolean", required: false, description: "Run `systemctl daemon-reload` first (systemd only)." },
  },
  examples: [
    `- service:
    name:
      $var: vars.pkg_name
    enabled: true
    state: started`,
    `- service:
    name: nginx
    state: reloaded
    daemon_reload: true`,
  ],
  notes:
    "≠ Ansible `service`/`systemd`: `pattern`/`sleep`/`scope`/`runlevel` are accepted but currently no-ops. SysV fallback uses the `service` init script when `systemctl` is missing; no `daemon_reload` under SysV.",
};

(serviceModule as Module & { meta: ModuleSummary }).meta = meta;
export default serviceModule;
