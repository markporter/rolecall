// Built-in module: `package` (P7) — package-manager detection + idempotent
// install/remove across apt / dnf / yum / apk / pacman / zypper.
//
// Runs entirely through `ctx.connection.exec`, so it works over Local or Ssh
// transports alike. Manager is auto-detected by probing `which <pm>` (first
// match wins) unless `manager` is supplied, which skips detection but still
// verifies the requested binary is present. Idempotency is intrinsic: each state
// first probes whether the package is already present via the manager-native
// query command before acting, and reports `changed:false` when the desired
// state already holds. `hold` and `allow_downgrade` are manager-specific and
// reject unsupported managers with an actionable error rather than silently
// ignoring them. Privilege escalation follows the same convention as the other
// builtins: every command is prefixed with `${sudo}` when `become` is requested.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";

/** Supported package managers and their probe/install/remove verbs. */
type PkgManager = "apt" | "dnf" | "yum" | "apk" | "pacman" | "zypper";

/** Every supported manager in probe order; also the accepted values for `manager`. */
const MANAGERS: readonly PkgManager[] = ["apt", "dnf", "yum", "apk", "pacman", "zypper"];

interface PackageArgs {
  /** Package name, e.g. "nginx". Required. */
  name: string;
  /** Install (default "present") or remove ("absent"). */
  state?: "present" | "absent";
  /** Pin an exact version at install time using native PM syntax. */
  version?: string;
  /** Explicit manager override; skips auto-detection but still verifies the binary exists. */
  manager?: PkgManager;
  /** Hold (true) or unhold (false). apt uses `apt-mark`, zypper uses `addlock`/`removelock`; other managers fail with an actionable error. */
  hold?: boolean;
  /** For apt only: pass `--allow-downgrades` to the install command when `version` is supplied. */
  allow_downgrade?: boolean;
  /** For apt: run `apt-get update` before installing (default false). */
  update_cache?: boolean;
  /** For apt: run `apt-get update` only when the apt list cache is older than this many seconds. */
  cache_valid_time?: number;
  /** Local package file to install (e.g. a .deb/.rpm/.apk); installed instead of a repo name. */
  src?: string;
}

/** Search metadata for the `package` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: "package",
  description:
    "Detects the target package manager (apt/dnf/yum/apk/pacman/zypper) and installs/removes a package idempotently.",
  idempotent: true,
  source: "builtin",
  args: {
    name: { type: "string", required: true, description: "Package name, e.g. 'nginx'." },
    state: {
      type: "present | absent",
      required: false,
      description: "Desired state (default 'present').",
    },
    version: {
      type: "string",
      required: false,
      description: "Pin an exact version using native PM syntax at install time.",
    },
    manager: {
      type: "apt | dnf | yum | apk | pacman | zypper",
      required: false,
      description: "Explicit manager override; skips auto-detection but still verifies the binary exists.",
    },
    hold: {
      type: "boolean",
      required: false,
      description:
        "Hold (true) or unhold (false); apt and zypper only, other managers fail with an actionable error.",
    },
    allow_downgrade: {
      type: "boolean",
      required: false,
      description: "For apt only: pass `--allow-downgrades` to the install command when `version` is supplied.",
    },
    update_cache: {
      type: "boolean",
      required: false,
      description: "For apt: run `apt-get update` before installing (default false).",
    },
    cache_valid_time: {
      type: "number",
      required: false,
      description:
        "For apt: run `apt-get update` only when the apt list cache is older than this many seconds (real age check; no-op on other managers).",
    },
    src: {
      type: "string",
      required: false,
      description: "Local package file (.deb/.rpm/.apk) to install instead of a repo name.",
    },
  },
  examples: [
    `- package:
    name: nginx
    state: present`,
    `- package:
    name: nginx
    version: 1.26.0-1~bookworm
    state: absent`,
    `- package:
    name: nginx
    src: /tmp/nginx_1.26.0-1~bookworm_amd64.deb`,
    `- package:
    name: nginx
    state: present
    version: 1.26.0-1~bookworm
    allow_downgrade: true`,
    `- package:
    name: nginx
    state: present
    manager: apt
    hold: true`,
  ],
  notes:
    "≠ Ansible `package`/`apt`/`dnf`/`yum`: auto-detects one of apt/dnf/yum/apk/pacman/zypper (first match wins) unless `manager` overrides it (an override skips detection but still verifies the binary). Version syntax maps to each PM's native form. `src` installs a local file. `hold` is implemented for apt (`apt-mark`) and zypper (`addlock`/`removelock`) and is rejected with an actionable error on dnf/yum (use versionlock), pacman (use IgnorePkg), and apk. `allow_downgrade` is apt-only. `cache_valid_time` performs a real apt cache-age check via `date`/`stat`. No transactional rollback yet.",
};

/** Probe commands keyed by manager: detect presence of a package on the target. */
const PROBE_CMD: Record<PkgManager, (name: string) => string> = {
  apt: (n) => `dpkg -s ${n}`,
  dnf: (n) => `rpm -q ${n}`,
  yum: (n) => `rpm -q ${n}`,
  apk: (n) => `apk info -e ${n}`,
  pacman: (n) => `pacman -Q ${n}`,
  zypper: (n) => `rpm -q ${n}`,
};

/** Native binary for each detected manager, used as the executable prefix. */
const PM_BIN: Record<PkgManager, string> = {
  apt: "apt-get",
  dnf: "dnf",
  yum: "yum",
  apk: "apk",
  pacman: "pacman",
  zypper: "zypper",
};

async function isInstalled(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  manager: PkgManager,
  name: string,
): Promise<boolean> {
  const res = await conn.exec(`${sudo}${PROBE_CMD[manager](name)}`);
  return res.exitCode === 0;
}

/** Probe whether a package is currently held (apt `apt-mark showhold` / zypper `locks`). */
async function isHeld(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  manager: PkgManager,
  name: string,
): Promise<boolean> {
  if (manager === "apt") {
    const res = await conn.exec(`${sudo}apt-mark showhold`);
    return res.stdout.split(/\r?\n/).map((line) => line.trim()).includes(name);
  }
  if (manager === "zypper") {
    const res = await conn.exec(`${sudo}zypper locks`);
    return res.stdout.split(/\r?\n/).some((line) => line.includes(name));
  }
  return false;
}

/** Hold or unhold a package (apt: `apt-mark`; zypper: `addlock`/`removelock`). */
async function applyHold(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  manager: PkgManager,
  name: string,
  wantHeld: boolean,
): Promise<void> {
  if (manager === "apt") {
    await conn.exec(`${sudo}apt-mark ${wantHeld ? "hold" : "unhold"} ${name}`);
    return;
  }
  await conn.exec(`${sudo}zypper ${wantHeld ? "addlock" : "removelock"} ${name}`);
}

/** True when the apt list cache is older than `maxAgeSeconds` seconds (or cannot be read). */
async function aptCacheIsStale(
  conn: NonNullable<ModuleContext["connection"]>,
  sudo: string,
  maxAgeSeconds: number,
): Promise<boolean> {
  const now = await conn.exec(`${sudo}date +%s`);
  const stat = await conn.exec(`${sudo}stat -c %Y /var/lib/apt/lists`);
  if (now.exitCode !== 0 || stat.exitCode !== 0) return true;
  const nowSec = Number.parseInt(now.stdout.trim(), 10);
  const mtimeSec = Number.parseInt(stat.stdout.trim(), 10);
  if (!Number.isFinite(nowSec) || !Number.isFinite(mtimeSec)) return true;
  return nowSec - mtimeSec > maxAgeSeconds;
}

/** Build a native install command with version pinned in that manager's syntax. */
function buildInstall(
  manager: PkgManager,
  name: string,
  version?: string,
  allowDowngrade = false,
): string {
  const bin = PM_BIN[manager];
  const sep = manager === "dnf" || manager === "yum" || manager === "zypper" ? "-" : "=";
  const pin = version ? `${name}${sep}${version}` : name;
  switch (manager) {
    case "apk":
      return `${bin} add ${pin}`;
    case "pacman":
      return `${bin} -S --noconfirm ${pin}`;
    default: {
      const downgrade = allowDowngrade && version ? " --allow-downgrades" : "";
      return `${bin} install -y${downgrade} ${pin}`;
    }
  }
}

/** Build a native remove command for this manager. */
function buildRemove(manager: PkgManager, name: string): string {
  const bin = PM_BIN[manager];
  switch (manager) {
    case "pacman":
      return `${bin} -R --noconfirm ${name}`;
    case "apk":
      return `${bin} del ${name}`;
    default:
      return `${bin} remove -y ${name}`;
  }
}

/** Build a native install command for a local package file (.deb/.rpm/.apk). */
function buildLocalInstall(manager: PkgManager, src: string): string {
  const bin = PM_BIN[manager];
  switch (manager) {
    case "apk":
      return `${bin} add ${src}`;
    case "pacman":
      return `${bin} -U --noconfirm ${src}`;
    default:
      return `${bin} install -y ${src}`;
  }
}

/** @summary Detect (or use an explicit `manager`) the target package manager and apply `state` for `name` idempotently. Probes presence first so re-runs are no-ops; reconciles `hold` for apt/zypper and `allow_downgrade`/`cache_valid_time` for apt, rejecting unsupported managers with an actionable error. @param ctx ModuleContext carrying args (name/state/version/manager/hold/allow_downgrade/update_cache/cache_valid_time/src) and connection. @returns ModuleResult with data.manager/name/state populated. */
export const pkgModule: Module = {
  name: "package",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args as unknown as PackageArgs;
    const name = String(args.name ?? "");
    if (!name) {
      return { changed: false, failed: true, msg: "package: 'name' is required" };
    }

    const requested = args.manager;
    if (requested !== undefined && !MANAGERS.includes(requested)) {
      return {
        changed: false,
        failed: true,
        msg: `package: invalid manager '${String(requested)}'; accepted values: ${MANAGERS.join(", ")}`,
        data: { name },
      };
    }

    const conn = ctx.connection;
    const sudo = ctx.become ? "sudo " : "";
    const state = (args.state ?? "present") as "present" | "absent";
    const version = typeof args.version === "string" && args.version.length > 0 ? args.version : undefined;
    const localSrc = typeof args.src === "string" && args.src.length > 0 ? args.src : undefined;
    const hold = args.hold;
    const allowDowngrade = args.allow_downgrade === true;
    const cacheValidTime =
      typeof args.cache_valid_time === "number" && args.cache_valid_time > 0 ? args.cache_valid_time : 0;

    /** Ordered probe list: first manager whose `which` resolves wins (auto-detection only). */
    const probes: Array<[string, PkgManager]> = [
      ["apt-get", "apt"],
      ["dnf", "dnf"],
      ["yum", "yum"],
      ["apk", "apk"],
      ["pacman", "pacman"],
      ["zypper", "zypper"],
    ];

    let manager: PkgManager | null = null;
    if (requested !== undefined) {
      const bin = PM_BIN[requested];
      const r = await conn.exec(`${sudo}which ${bin}`);
      if (r.exitCode !== 0) {
        return {
          changed: false,
          failed: true,
          msg: `package: manager '${requested}' requested but '${bin}' is not available on target`,
          data: { name, state },
        };
      }
      manager = requested;
    } else {
      for (const [bin, m] of probes) {
        const r = await conn.exec(`${sudo}which ${bin}`);
        if (r.exitCode === 0) {
          manager = m;
          break;
        }
      }
      if (!manager) {
        return {
          changed: false,
          failed: true,
          msg: "no supported package manager found on target",
          data: { name, state },
        };
      }
    }

    // Validate manager-specific options up front: never silently ignore one.
    if (allowDowngrade && manager !== "apt") {
      return {
        changed: false,
        failed: true,
        msg: `package: allow_downgrade is only supported on apt, not ${manager}`,
        data: { manager, name, state },
      };
    }
    if (hold !== undefined && manager !== "apt" && manager !== "zypper") {
      const reason =
        manager === "pacman"
          ? "use IgnorePkg manually"
          : manager === "dnf" || manager === "yum"
            ? "use versionlock"
            : "no native hold mechanism is available";
      return {
        changed: false,
        failed: true,
        msg: `package: hold is not supported on ${manager}; ${reason}`,
        data: { manager, name, state },
      };
    }

    const installed = await isInstalled(conn, sudo, manager, name);
    let changed = false;
    const log: string[] = [];

    if (state === "absent") {
      if (!installed) {
        return {
          changed: false,
          stdout: `package ${name} already absent`,
          msg: `package ${name} unchanged`,
          data: { manager, name, state },
        };
      }
      // A held package cannot be removed cleanly, so release any hold first.
      if (hold !== undefined && (await isHeld(conn, sudo, manager, name))) {
        await applyHold(conn, sudo, manager, name, false);
        log.push(`unheld ${name}`);
      }
      await conn.exec(`${sudo}${buildRemove(manager, name)}`);
      log.push(`removed ${name}`);
      return {
        changed: true,
        stdout: log.join("\n"),
        msg: `package ${name} removed`,
        data: { manager, name, state },
      };
    }

    // present
    if (!installed) {
      if (manager === "apt") {
        const force = args.update_cache === true;
        const stale = !force && cacheValidTime > 0 ? await aptCacheIsStale(conn, sudo, cacheValidTime) : false;
        if (force || stale) await conn.exec(`${sudo}apt-get update -y`);
      }
      const installCmd = localSrc
        ? buildLocalInstall(manager, localSrc)
        : buildInstall(manager, name, version, allowDowngrade);
      await conn.exec(`${sudo}${installCmd}`);
      log.push(`installed ${name}`);
      changed = true;
    }

    // `hold` is independent of `state`; reconcile it after the state action.
    if (hold !== undefined) {
      const wantHeld = hold === true;
      if ((await isHeld(conn, sudo, manager, name)) !== wantHeld) {
        await applyHold(conn, sudo, manager, name, wantHeld);
        log.push(`${wantHeld ? "held" : "unheld"} ${name}`);
        changed = true;
      }
    }

    return {
      changed,
      stdout: log.length > 0 ? log.join("\n") : `package ${name} already present`,
      msg: changed
        ? `package ${name} ${installed ? "updated" : "installed"}${version ? ` (${version})` : ""}${localSrc ? ` from ${localSrc}` : ""}`
        : `package ${name} unchanged`,
      data: { manager, name, state, src: localSrc },
    };
  },
};

(pkgModule as Module & { meta: ModuleSummary }).meta = meta;
