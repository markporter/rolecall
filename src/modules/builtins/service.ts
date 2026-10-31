// Built-in module: `service` — idempotent systemd/ SysV enable/start/stop (Todo 15, extended for Ansible parity).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { CheckableModule } from "../../idempotency";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

interface ServiceArgs {
  /** Unit name, e.g. "nginx". Required. */
  name: string;
  /** Enable the unit (default true). */
  enabled?: boolean;
  /** Desired active state. */
  state?: "started" | "stopped" | "restarted" | "reloaded";
  /** Run `systemctl daemon-reload` first (systemd only). */
  daemon_reload?: boolean;
  /** Fallback liveness probe: when the primary check reports inactive, a `pgrep -f` match is treated as running. */
  pattern?: string;
  /** Client-side delay in seconds after service actions complete (no remote command). Honored when a finite number > 0. */
  sleep?: number;
  /** systemd scope: `"system"` (default, may elevate) or `"user"` (`systemctl --user`, never sudo). */
  scope?: "system" | "user";
  /** SysV runlevel for `chkconfig --level` (non-systemd targets only). */
  runlevel?: string;
}

/** @summary Idempotent service enable/start/stop (Ansible `service`/`systemd` alternate). Probes current state before acting; supports `scope` (`system`/`user`), `pattern` as a `pgrep -f` liveness fallback, `runlevel` via `chkconfig --level` on SysV, `daemon_reload`, `state: reloaded`, a client-side `sleep` delay, and a SysV `service` fallback when systemd is absent. @param ctx ModuleContext carrying `name`, `enabled`, `state`, `daemon_reload`, `pattern`, `scope`, `runlevel`, `sleep`. @returns ModuleResult; `changed:false` when the desired state already holds. */
export const serviceModule: Module & CheckableModule = {
  name: "service",
  async check(args, ctx) {
    const a = args as unknown as ServiceArgs;
    const name = String(a.name ?? "");
    const scope = a.scope ?? "system";
    const conn = ctx.connection;
    const sudo = scope === "system" && ctx.become ? "sudo " : "";
    const ctl = scope === "user" ? "systemctl --user" : "systemctl";
    const hasSystemd = (await conn.exec(`${sudo}command -v systemctl`)).exitCode === 0;
    const runlevel = a.runlevel;
    const enabledCmd = () => (hasSystemd ? `${sudo}${ctl} is-enabled ${name}` : `${sudo}chkconfig --list ${name} 2>/dev/null`);
    const activeCmd = () => (hasSystemd ? `${sudo}${ctl} is-active ${name}` : `${sudo}service ${name} status`);
    const isEnabled = async (): Promise<boolean> => {
      const res = await conn.exec(enabledCmd());
      if (hasSystemd) return res.exitCode === 0;
      return res.stdout.split(/\s+/).some((tok) => {
        const [svcName, level, state] = tok.split(":");
        if (state !== "on" || svcName !== name) return false;
        return runlevel === undefined || level === runlevel;
      });
    };
    const isActive = async (): Promise<boolean> => {
      if ((await conn.exec(activeCmd())).exitCode === 0) return true;
      if (a.pattern === undefined) return false;
      return (await conn.exec(`${sudo}pgrep -f ${shQuote(String(a.pattern))}`)).exitCode === 0;
    };
    const enabled = await isEnabled();
    const active = await isActive();
    const wantEnabled = a.enabled ?? true;
    const wantState = a.state ?? "started";
    let inDesired = wantEnabled === enabled;
    if (inDesired) {
      if (wantState === "started") inDesired = active;
      else if (wantState === "stopped") inDesired = !active;
      else inDesired = false;
    }
    if (inDesired && a.daemon_reload && hasSystemd) inDesired = false;
    return { current: { enabled, active }, inDesired };
  },
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args as unknown as ServiceArgs;
    const name = String(args.name ?? "");
    if (!name) return { changed: false, failed: true, msg: "service: 'name' is required" };

    const scope = args.scope ?? "system";
    if (scope !== "system" && scope !== "user") {
      return {
        changed: false,
        failed: true,
        msg: `service: 'scope' must be 'system' or 'user' (got ${JSON.stringify(scope)})`,
      };
    }

    const conn = ctx.connection;
    const sudo = scope === "system" && ctx.become ? "sudo " : "";
    const ctl = scope === "user" ? "systemctl --user" : "systemctl";
    const wantEnabled = args.enabled ?? true;
    const wantState = args.state ?? "started";
    const runlevel = args.runlevel;
    const log: string[] = [];
    let changed = false;

    const hasSystemd = (await conn.exec(`${sudo}command -v systemctl`)).exitCode === 0;
    if (scope === "user" && !hasSystemd) {
      return {
        changed: false,
        failed: true,
        msg: "service: 'scope: user' requires systemd, but `systemctl` was not found on the target",
      };
    }
    if (runlevel !== undefined && hasSystemd) {
      return {
        changed: false,
        failed: true,
        msg: "service: 'runlevel' only applies to SysV init; remove it on this systemd target (use `systemctl`)",
      };
    }

    const levelOpt = runlevel !== undefined ? `--level ${runlevel} ` : "";
    const svc = (verb: string, fallbackVerb: string) =>
      hasSystemd ? `${sudo}${ctl} ${verb} ${name}` : `${sudo}service ${name} ${fallbackVerb}`;
    const active = () => (hasSystemd ? `${sudo}${ctl} is-active ${name}` : `${sudo}service ${name} status`);
    const enabled = () => (hasSystemd ? `${sudo}${ctl} is-enabled ${name}` : `${sudo}chkconfig --list ${name} 2>/dev/null`);

    const isEnabled = async (): Promise<boolean> => {
      const res = await conn.exec(enabled());
      if (hasSystemd) return res.exitCode === 0;
      return res.stdout.split(/\s+/).some((tok) => {
        const [svcName, level, state] = tok.split(":");
        if (state !== "on" || svcName !== name) return false;
        return runlevel === undefined || level === runlevel;
      });
    };

    const isActive = async (): Promise<boolean> => {
      if ((await conn.exec(active())).exitCode === 0) return true;
      if (args.pattern === undefined) return false;
      return (await conn.exec(`${sudo}pgrep -f ${shQuote(String(args.pattern))}`)).exitCode === 0;
    };

    if (args.daemon_reload && hasSystemd) {
      await conn.exec(`${sudo}${ctl} daemon-reload`);
      changed = true;
      log.push("daemon-reload");
    }

    if (wantEnabled !== (await isEnabled())) {
      if (wantEnabled) {
        await conn.exec(hasSystemd ? `${sudo}${ctl} enable ${name}` : `${sudo}chkconfig ${levelOpt}${name} on`);
        changed = true;
        log.push(`enabled ${name}`);
      } else {
        await conn.exec(hasSystemd ? `${sudo}${ctl} disable ${name}` : `${sudo}chkconfig ${levelOpt}${name} off`);
        changed = true;
        log.push(`disabled ${name}`);
      }
    }

    if (wantState === "started") {
      if (!(await isActive())) {
        await conn.exec(svc("start", "start"));
        changed = true;
        const recheck = await isActive();
        log.push(recheck ? `started ${name}` : `started ${name} (warning: still inactive)`);
      }
    } else if (wantState === "stopped") {
      if (await isActive()) {
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

    const sleepFor = args.sleep;
    if (typeof sleepFor === "number" && Number.isFinite(sleepFor) && sleepFor > 0) {
      await new Promise((resolve) => setTimeout(resolve, sleepFor * 1000));
      log.push(`slept ${sleepFor}s`);
    }

    return { changed, stdout: log.join("\n"), msg: changed ? `service ${name} updated` : `service ${name} unchanged` };
  },
};

/** Search metadata for the `service` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: "service",
  description:
    "Idempotent service enable/start/stop (Ansible `service`/`systemd` alternate). Probes current state before acting; supports `scope` (system/user), a `pattern` liveness fallback, SysV `runlevel` via `chkconfig`, `daemon_reload`, `state: reloaded`, and a SysV `service` fallback when systemd is absent.",
  idempotent: true,
  source: "builtin",
  args: {
    name: { type: "string", required: true, description: "Unit name, e.g. 'nginx'." },
    enabled: { type: "boolean", required: false, description: "Enable (or disable when false) the unit (default true)." },
    state: { type: "started | stopped | restarted | reloaded", required: false, description: "Desired active state (default 'started')." },
    daemon_reload: { type: "boolean", required: false, description: "Run `systemctl daemon-reload` first (systemd only)." },
    pattern: { type: "string", required: false, description: "Fallback liveness regex: when the primary probe reports inactive, a `pgrep -f` match is treated as running (started/stopped)." },
    scope: { type: "system | user", required: false, description: "systemd scope; 'user' runs `systemctl --user` without sudo (default 'system')." },
    runlevel: { type: "string", required: false, description: "SysV runlevel for `chkconfig --level <runlevel>` (non-systemd targets only)." },
    sleep: { type: "number", required: false, description: "Client-side delay in seconds after service actions complete (no remote command)." },
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
    `- service:
    name: myapp
    scope: user
    state: started`,
  ],
  notes:
    "≠ Ansible `service`/`systemd`: `sleep` is honored (a client-side delay after service actions complete, not a remote command). `scope: user` rewrites every command to `systemctl --user` and never prefixes `sudo`; any other `scope` value fails. `pattern` is a fallback only — the primary probe stays `systemctl is-active` (or `service <name> status` on SysV), and a `pgrep -f <pattern>` match marks the service active for `state: started`/`stopped`. `runlevel` is SysV-only (`chkconfig --level <runlevel> <name> on/off`, probed via `chkconfig --list`) and errors on a systemd target. SysV fallback uses the `service` init script when `systemctl` is missing; no `daemon_reload` under SysV.",
};

(serviceModule as Module & { meta: ModuleSummary }).meta = meta;
export default serviceModule;
