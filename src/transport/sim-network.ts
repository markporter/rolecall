// SimNetworkConnection — a Connection adapter for the in-process network-device
// simulator's HTTP control surface (src/testing/sims/network-device.ts).
//
// The orchestrator can fork a child playbook run while keeping the live device
// simulator in the parent process: the child sends each CLI line to POST /cli on
// the simulator, which returns the prompt-aware response. This lets the full
// executor (modules, when/loop, handlers, check/diff) target a simulator without
// sharing process globals.

import type {
  Connection,
  ConnectionFacts,
  ExecOptions,
  ExecResult,
  HealthStatus,
} from "./connection";

export interface SimNetworkConnectionOptions {
  /** Simulator base URL (e.g. http://127.0.0.1:39523). */
  url: string;
  host: string;
  user?: string;
  timeoutMs?: number;
}

export class SimNetworkConnection implements Connection {
  readonly kind = "network" as const;
  readonly #base: string;
  readonly #host: string;
  readonly #user: string;
  readonly #timeoutMs: number;
  #connected = false;

  constructor(options: SimNetworkConnectionOptions) {
    this.#base = options.url.replace(/\/$/, "");
    this.#host = options.host;
    this.#user = options.user ?? "admin";
    this.#timeoutMs = options.timeoutMs ?? 8_000;
  }

  async connect(): Promise<void> {
    if (this.#connected) return;
    const health = await this.health();
    if (!health.ok) {
      throw new Error(`network simulator unreachable at ${this.#base}: ${health.error ?? "health probe failed"}`);
    }
    this.#connected = true;
  }

  async exec(command: string, _options?: ExecOptions): Promise<ExecResult> {
    if (!this.#connected) throw new Error("SimNetworkConnection: not connected");
    let stdout = "";
    for (const line of command.split("\n")) {
      if (line.trim() === "") continue;
      const res = await fetch(`${this.#base}/cli`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ line }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!res.ok) {
        return { exitCode: res.status, stdout, stderr: await res.text().catch(() => "") };
      }
      const body = (await res.json()) as { output?: unknown };
      const out = typeof body.output === "string" ? body.output : "";
      stdout += out.endsWith("\n") || out === "" ? out : `${out}\n`;
    }
    return { exitCode: 0, stdout, stderr: "" };
  }

  async facts(): Promise<ConnectionFacts> {
    return { host: this.#host, user: this.#user, transport: "network" };
  }

  async health(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.#base}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      return { ok: res.ok, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - start,
      };
    }
  }

  async disconnect(): Promise<void> {
    this.#connected = false;
  }
}
