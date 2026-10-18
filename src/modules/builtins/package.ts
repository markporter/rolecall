// Built-in module: `package` (P7) — package-manager detection + idempotent
// install/remove across apt / dnf / yum / apk / pacman / zypper.
//
// Runs entirely through `ctx.connection.exec`, so it works over Local or Ssh
// transports alike. Manager is detected by probing `which <pm>` (first match
// wins). Idempotency is intrinsic: each state first probes whether the package
// is already present via the manager-native query command before acting, and
// reports `changed:false` when the desired state already holds. Privilege
// escalation follows the same convention as the other builtins: every command
// is prefixed with `${sudo}` when `become` is requested.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";

/** Supported package managers and their probe/install/remove verbs. */
type PkgManager = "apt" | "dnf" | "yum" | "apk" | "pacman" | "zypper";

interface PackageArgs {
  /** Package name, e.g. "nginx". Required. */
  name: string;
  /** Install (default "present") or remove ("absent"). */
  state?: "present" | "absent";
  /** Pin an exact version at install time using native PM syntax. */
  version?: string;
  /** For apt: run `apt-get update` before installing (default false). */
  update_cache?: boolean;
  /** For apt: run `apt-get update` if the cache is older than this many seconds (treated as update_cache here). */
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
    update_cache: {
      type: "boolean",
      required: false,
      description: "For apt: run `apt-get update` before installing (default false).",
    },
    cache_valid_time: {
      type: "number",
      required: false,
      description: "For apt: treat as update_cache when > 0 (cache-age check is not yet implemented).",
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
  ],
  notes:
    "≠ Ansible `package`/`apt`/`dnf`/`yum`: auto-detects one of apt/dnf/yum/apk/pacman/zypper (first match wins); no per-task `manager` override. Version syntax maps to each PM's native form. `src` installs a local file. No `hold`, `allow_downgrade`, or transactional rollback yet.",
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

/** Build a native install command with version pinned in that manager's syntax. */
function buildInstall(manager: PkgManager, name: string, version?: string): string {
  const bin = PM_BIN[manager];
  const sep = manager === "dnf" || manager === "yum" || manager === "zypper" ? "-" : "=";
  const pin = version ? `${name}${sep}${version}` : name;
  switch (manager) {
    case "apk":
      return `${bin} add ${pin}`;
    case "pacman":
      return `${bin} -S --noconfirm ${pin}`;
    default:
      return `${bin} install -y ${pin}`;
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

/** @summary Detect the target package manager and apply `state` for `name` idempotently. Probes presence first so re-runs are no-ops; returns failed when no supported manager exists. @param ctx ModuleContext carrying args (name/state/version/update_cache) and connection. @returns ModuleResult with data.manager/name/state populated. */
export const pkgModule: Module = {
  name: "package",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const args = ctx.args as unknown as PackageArgs;
    const name = String(args.name ?? "");
    if (!name) {
      return { changed: false, failed: true, msg: "package: 'name' is required" };
    }
    const conn = ctx.connection;
    const sudo = ctx.become ? "sudo " : "";
    const state = (args.state ?? "present") as "present" | "absent";
    const version = typeof args.version === "string" && args.version.length > 0 ? args.version : undefined;
    let updateCache = args.update_cache === true;
    if (typeof args.cache_valid_time === "number" && args.cache_valid_time > 0) updateCache = true;
    const localSrc = typeof args.src === "string" && args.src.length > 0 ? args.src : undefined;

    /** Ordered probe list: first manager whose `which` resolves wins. */
    const probes: Array<[string, PkgManager]> = [
      ["apt-get", "apt"],
      ["dnf", "dnf"],
      ["yum", "yum"],
      ["apk", "apk"],
      ["pacman", "pacman"],
      ["zypper", "zypper"],
    ];

    let manager: PkgManager | null = null;
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

    const installed = await isInstalled(conn, sudo, manager, name);

    if (state === "absent") {
      if (!installed) {
        return {
          changed: false,
          stdout: `package ${name} already absent`,
          msg: `package ${name} unchanged`,
          data: { manager, name, state },
        };
      }
      await conn.exec(`${sudo}${buildRemove(manager, name)}`);
      return {
        changed: true,
        stdout: `removed ${name}`,
        msg: `package ${name} removed`,
        data: { manager, name, state },
      };
    }

    // present
    if (installed) {
      return {
        changed: false,
        stdout: `package ${name} already present`,
        msg: `package ${name} unchanged`,
        data: { manager, name, state },
      };
    }

    if (updateCache && manager === "apt") {
      await conn.exec(`${sudo}apt-get update -y`);
    }
    const installCmd = localSrc ? buildLocalInstall(manager, localSrc) : buildInstall(manager, name, version);
    await conn.exec(`${sudo}${installCmd}`);
    return {
      changed: true,
      stdout: `installed ${name}`,
      msg: `package ${name} installed${version ? ` (${version})` : ""}${localSrc ? ` from ${localSrc}` : ""}`,
      data: { manager, name, state, src: localSrc },
    };
  },
};

(pkgModule as Module & { meta: ModuleSummary }).meta = meta;
