// ADR 0023 install layout resolver: one path model for user/system scope on
// Linux, macOS, and Windows. Paths are data; this module never creates them.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type InstallScope = "user" | "system";

export interface InstallLayout {
  scope: InstallScope;
  platform: NodeJS.Platform | string;
  /** Immutable program directory. */
  programDir: string;
  /** Operator config directory (contains rolecall.env). */
  configDir: string;
  /** Durable mutable state. */
  stateDir: string;
  /** Cache/scratch. */
  cacheDir: string;
  /** PATH entry directory (symlink on system scope). */
  binDir: string;
  /** rolecall.env path. */
  envFile: string;
}

export interface ResolveInstallLayoutOptions {
  scope?: InstallScope;
  platform?: NodeJS.Platform | string;
  env?: Record<string, string | undefined>;
  home?: string;
  /** `--prefix`: override the program directory. */
  prefix?: string;
  /** `--config-dir`: override the config directory. */
  configDir?: string;
  /** `--state-dir`: override the state directory. */
  stateDir?: string;
  /** Injectable existence check (tests). */
  exists?: (path: string) => boolean;
  /** Ignore the legacy ~/.rolecall state fallback (used by --migrate). */
  ignoreLegacy?: boolean;
}

function envPath(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key];
  return value && value.trim() ? value : undefined;
}

function xdg(env: Record<string, string | undefined>, key: string, home: string, fallback: string): string {
  return envPath(env, key) ?? join(home, fallback);
}

/** Resolve the install layout from platform/scope + explicit overrides. */
export function resolveInstallLayout(options: ResolveInstallLayoutOptions = {}): InstallLayout {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? (process.env as Record<string, string | undefined>);
  const home = envPath(env, "ROLECALL_HOME") ?? options.home ?? homedir();
  const scope = options.scope ?? (typeof process.getuid === "function" && process.getuid() === 0 ? "system" : "user");
  const exists = options.exists ?? existsSync;
  const user = scope === "user";

  let programDir: string;
  let configDir: string;
  let stateDir: string;
  let cacheDir: string;
  let binDir: string;

  if (platform === "win32") {
    const appData = envPath(env, "APPDATA") ?? join(home, "AppData", "Roaming");
    const localAppData = envPath(env, "LOCALAPPDATA") ?? join(home, "AppData", "Local");
    const programFiles = envPath(env, "ProgramFiles") ?? "C:\\Program Files";
    const programData = envPath(env, "ProgramData") ?? "C:\\ProgramData";
    if (user) {
      programDir = join(localAppData, "Programs", "RoleCall");
      configDir = join(appData, "RoleCall");
      stateDir = join(localAppData, "RoleCall", "state");
      cacheDir = join(localAppData, "RoleCall", "cache");
      binDir = join(localAppData, "Programs", "RoleCall", "bin");
    } else {
      programDir = join(programFiles, "RoleCall");
      configDir = join(programData, "RoleCall");
      stateDir = join(programData, "RoleCall", "state");
      cacheDir = join(programData, "RoleCall", "cache");
      binDir = join(programFiles, "RoleCall", "bin");
    }
  } else if (platform === "darwin") {
    if (user) {
      programDir = join(home, "Library", "Application Support", "RoleCall", "lib");
      configDir = join(home, "Library", "Application Support", "RoleCall");
      stateDir = join(configDir, "state");
      cacheDir = join(home, "Library", "Caches", "RoleCall");
      binDir = join(home, ".local", "bin");
    } else {
      programDir = "/opt/rolecall";
      configDir = "/Library/Application Support/RoleCall";
      stateDir = join(configDir, "state");
      cacheDir = "/Library/Caches/RoleCall";
      binDir = "/usr/local/bin";
    }
  } else {
    // Linux and other POSIX.
    if (user) {
      programDir = join(home, ".local", "lib", "rolecall");
      configDir = xdg(env, "XDG_CONFIG_HOME", home, ".config") + "/rolecall";
      stateDir = xdg(env, "XDG_STATE_HOME", home, ".local/state") + "/rolecall";
      cacheDir = xdg(env, "XDG_CACHE_HOME", home, ".cache") + "/rolecall";
      binDir = join(home, ".local", "bin");
    } else {
      programDir = "/opt/rolecall";
      configDir = "/etc/rolecall";
      stateDir = "/var/lib/rolecall";
      cacheDir = "/var/cache/rolecall";
      binDir = "/usr/local/bin";
    }
  }

  // Explicit overrides.
  if (options.prefix) {
    programDir = resolve(options.prefix);
    binDir = join(programDir, "bin");
  }
  if (options.configDir) configDir = resolve(options.configDir);
  if (options.stateDir) stateDir = resolve(options.stateDir);
  const envConfig = envPath(env, "ROLECALL_CONFIG");
  if (envConfig && !options.configDir) configDir = resolve(envConfig);
  const envState = envPath(env, "ROLECALL_PROJECT_STATE");
  if (envState && !options.stateDir) stateDir = resolve(envState);

  // Backward compatibility: honor an existing ~/.rolecall for user scope unless
  // the new XDG state path already exists.
  if (user && !options.stateDir && !envState && options.ignoreLegacy !== true) {
    const legacy = join(home, ".rolecall");
    if (exists(legacy) && !exists(stateDir)) stateDir = legacy;
  }

  return {
    scope,
    platform,
    programDir,
    configDir,
    stateDir,
    cacheDir,
    binDir,
    envFile: join(configDir, "rolecall.env"),
  };
}
