// NetworkSshConnection — network-switch transport over SSH for IOS-like devices.
//
// Reuses SshConnection (ssh.ts) for the actual SSH channel; this class adds a
// thin vendor-driver layer over raw CLI: prompt/config-mode awareness (enter/
// exit config commands), candidate-vs-running diff (diff.ts), merge vs replace
// apply modes, and atomic commit with an optional device-side revert timer.
import { SshConnection } from "./ssh";
import {
  type Connection,
  type ConnectionFacts,
  type ExecOptions,
  type ExecResult,
  type HealthStatus,
  type NetworkConnectionOptions,
  type VendorDriver,
} from "./connection";
import { diffConfigs, normalizeConfig, type ConfigDiff } from "./diff";

// VendorDriver is defined in ./connection (the transport contract module) to keep
// this module free of a circular import with connection.ts.

/** Default driver for IOS / IOS-XR style CLIs. */
export const IOS_DRIVER: VendorDriver = {
  name: "ios",
  enterConfig: "configure terminal",
  exitConfig: "end",
  showRunning: "show running-config",
  commit: () => "copy running-config startup-config",
  commitConfirmed: (s) => `commit confirmed ${s}`,
  parseRunning: (raw) => raw,
};

export interface ApplyOptions {
  /** "merge" applies only the diff delta; "replace" applies the whole candidate. */
  mode?: "merge" | "replace";
  /** Arm a device-side revert timer (seconds). Requires a confirmed commit. */
  revertInSeconds?: number;
  /** Skip the commit step (dry-run the diff + apply). Default false. */
  commit?: boolean;
}

export interface ApplyResult {
  changed: boolean;
  added: string[];
  removed: string[];
  /** Every command sent to the device (empty when unchanged). */
  commands: string[];
  committed: boolean;
}

/** Plan a commit command, optionally arming a device-side revert timer. */
export function planCommit(
  driver: VendorDriver,
  revertInSeconds?: number,
): { command: string; reverts: boolean; revertInSeconds?: number } {
  if (revertInSeconds && revertInSeconds > 0) {
    return { command: driver.commitConfirmed(revertInSeconds), reverts: true, revertInSeconds };
  }
  return { command: driver.commit(), reverts: false };
}

export class NetworkSshConnection implements Connection {
  readonly kind = "network" as const;
  readonly options: NetworkConnectionOptions;
  readonly driver: VendorDriver;
  #ssh: SshConnection;

  constructor(options: NetworkConnectionOptions) {
    this.options = options;
    this.driver = options.driver ?? IOS_DRIVER;
    this.#ssh = new SshConnection({
      kind: "ssh",
      host: options.host,
      port: options.port,
      user: options.user,
      credentials: options.credentials,
      knownHostsPath: options.knownHostsPath,
      strictHostKeyChecking: options.strictHostKeyChecking,
      timeoutMs: options.timeoutMs,
      retry: options.retry,
      concurrency: options.concurrency,
    });
  }

  connect(): Promise<void> {
    return this.#ssh.connect();
  }

  disconnect(): Promise<void> {
    return this.#ssh.disconnect();
  }

  exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    // Thin delegate: prompt handling is the driver's concern (enter/exit config
    // commands bracket config-mode work in apply()). Raw CLI passes through.
    return this.#ssh.exec(command, options);
  }

  async facts(): Promise<ConnectionFacts> {
    return {
      host: this.options.host,
      user: this.options.user,
      os: this.driver.name,
      transport: "network",
    };
  }

  health(): Promise<HealthStatus> {
    return this.#ssh.health();
  }

  private async fetchRunning(): Promise<string> {
    const res = await this.exec(this.driver.showRunning);
    const raw = res.stdout;
    return this.driver.parseRunning ? this.driver.parseRunning(raw) : raw;
  }

  /** Compute the candidate-vs-running diff without applying anything. */
  async diff(candidate: string): Promise<ConfigDiff> {
    const running = await this.fetchRunning();
    return diffConfigs(candidate, running);
  }

  /**
   * Reconcile the device to `candidate`:
   *  1. fetch running config, 2. normalize + diff, 3. if unchanged → no-op
   *     (idempotent), 4. else apply delta (merge) or whole config (replace)
   *     inside config mode, 5. commit atomically (optionally with revert timer).
   */
  async apply(candidate: string, opts: ApplyOptions = {}): Promise<ApplyResult> {
    const mode = opts.mode ?? "merge";
    const running = await this.fetchRunning();
    const diff = diffConfigs(candidate, running);

    if (!diff.changed) {
      return { changed: false, added: [], removed: [], commands: [], committed: false };
    }

    const commands: string[] = [this.driver.enterConfig];
    if (mode === "replace") {
      commands.push(...normalizeConfig(candidate).split("\n"));
    } else {
      commands.push(...diff.added);
    }
    commands.push(this.driver.exitConfig);

    for (const cmd of commands) {
      await this.exec(cmd);
    }

    let committed = false;
    if (opts.commit !== false) {
      const plan = planCommit(this.driver, opts.revertInSeconds);
      await this.exec(plan.command);
      commands.push(plan.command);
      committed = true;
    }

    return { changed: true, added: diff.added, removed: diff.removed, commands, committed };
  }
}
