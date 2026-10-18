// In-process network-device simulator for OFFLINE integration tests.
//
// A mock IOS-like switch responder that holds candidate + running config state,
// understands a prompt-aware CLI line protocol, and models apply/diff/commit
// semantics identical to src/transport/network.ts — including the crucial
// `normalizeConfig` rule that strips trailing blank lines so `show running-config`
// (which ends with "\n") compares idempotently against a user candidate without a
// trailing newline. Uses the SAME diffConfigs/normalizeConfig from diff.ts so the
// two can never drift. Control surface served over HTTP via createHttpSim so the
// offline farm exposes it on a fixed port (39523) alongside the other sims.
import { diffConfigs, normalizeConfig } from "../../transport/diff";
import { createHttpSim, type HttpRouteHandler, type HttpSimOptions } from "./http-endpoint";

const ENTER_CONFIG = "configure terminal";
const EXIT_CONFIG = "end";

export interface ApplyOpts {
  mode?: "merge" | "replace";
  commit?: boolean;
}

export interface DeviceApplyResult {
  changed: boolean;
  added: string[];
  removed: string[];
  /** Every command staged for the device (empty when unchanged). */
  commands: string[];
  committed: boolean;
}

export interface DeviceState {
  running: string;
  candidate: string;
}

export interface CliResponse {
  output: string;
}

export interface NetworkDeviceSimOptions extends Omit<HttpSimOptions, "routes"> {
  port?: number;           // default 39523
  initialRunning?: string; // starting running-config
}

/** Prompt-aware single-line CLI handler, mirroring how a driver drives exec(). */
export function makeCliResponder(state: DeviceState): (line: string) => CliResponse {
  let cfgMode = false;
  const respond = (out: string): CliResponse => ({ output: out });

  return (line: string): CliResponse => {
    const cmd = line.trim();
    if (cmd === "") return respond("");
    switch (cmd) {
      case "show running-config":
      case "show run":
        return respond(normalizeConfig(state.running));
      case "configure terminal":
      case "conf t":
        cfgMode = true;
        return respond("Enter configuration commands...");
      case "end":
      case "exit":
        cfgMode = false;
        return respond("");
      case "write memory":
      case "wr mem":
      case "copy running-config startup-config":
        state.running = state.candidate.endsWith("\n") ? state.candidate : `${state.candidate}\n`;
        return respond("Building Running-configuration...\r\n[OK]");
      default:
        break;
    }
    if (cfgMode && cmd !== "") {
      state.candidate = state.candidate.endsWith("\n") ? `${state.candidate}${cmd}\n` : `${state.candidate}\n${cmd}`;
      return respond("% Command accepted");
    }
    // Outside config mode, echo like a privileged EXEC shell.
    return respond(cmd);
  };
}

export interface NetworkDeviceSimHandle {
  url: string;
  port: number;
  baseUrl: string;
  healthUrl: string;
  lastRequest(): import("./http-endpoint").HttpRequestSnapshot | null;
  health(timeoutMs?: number): Promise<boolean>;
  close(): void;
  // --- programmatic device API -------------------------------------------
  getState(): DeviceState;
  setRunning(config: string): void;
  setCandidate(config: string): void;
  showRunning(): string;
  diff(candidate: string): ReturnType<typeof diffConfigs>;
  apply(candidate: string, opts?: ApplyOpts): DeviceApplyResult;
  commit(): void;
  cli(line: string): CliResponse;
}

const DEFAULT_PORT = 39523;

export async function createNetworkDeviceSim(opts: NetworkDeviceSimOptions = {}): Promise<NetworkDeviceSimHandle> {
  const running0 = opts.initialRunning ?? "";
  const state: DeviceState = { running: running0, candidate: "" };
  const cli = makeCliResponder(state);

  // Core device operations, defined before the route table so closures share them.
  const doDiff = (candidate: string): ReturnType<typeof diffConfigs> =>
    diffConfigs(candidate, state.running);

  const doApply = (candidate: string, o: ApplyOpts = {}): DeviceApplyResult => {
    const mode = o.mode ?? "merge";
    const diff = diffConfigs(candidate, state.running);
    if (!diff.changed) {
      return { changed: false, added: [], removed: [], commands: [], committed: false };
    }
    const commands: string[] = [ENTER_CONFIG];
    if (mode === "replace") {
      commands.push(...normalizeConfig(candidate).split("\n"));
    } else {
      commands.push(...diff.added);
    }
    commands.push(EXIT_CONFIG);
    state.candidate = candidate.endsWith("\n") ? candidate : `${candidate}\n`;
    let committed = false;
    if (o.commit !== false) {
      state.running = state.candidate;
      committed = true;
    }
    return { changed: true, added: diff.added, removed: diff.removed, commands, committed };
  };

  const doCommit = (): void => {
    state.running = state.candidate;
  };

  const routes: Record<string, HttpRouteHandler> = {
    "GET /status": () => ({ ...state }),
    "POST /diff": async (_req, ctx) => doDiff((await parseJson(await ctx.text()))?.candidate as string),
    "POST /apply": async (_req, ctx) => {
      const b = await parseJson(await ctx.text());
      return doApply(
        typeof b.candidate === "string" ? b.candidate : "",
        {
          mode: b?.mode as ApplyOpts["mode"] | undefined,
          commit: b?.commit as boolean | undefined,
        },
      );
    },
    "POST /commit": async () => {
      doCommit();
      return { committed: true };
    },
  };

  const http = await createHttpSim({
    ...opts,
    routes,
    healthBody: { ok: true, service: "network" },
  } as HttpSimOptions);

  return {
    ...http,
    getState(): DeviceState {
      return { ...state };
    },
    setRunning(config: string): void {
      state.running = config;
    },
    setCandidate(config: string): void {
      state.candidate = config;
    },
    showRunning(): string {
      return normalizeConfig(state.running);
    },
    diff(candidate: string): ReturnType<typeof diffConfigs> {
      return doDiff(candidate);
    },
    apply(candidate: string, o?: ApplyOpts): DeviceApplyResult {
      return doApply(candidate, o);
    },
    commit(): void {
      doCommit();
    },
    cli(line: string): CliResponse {
      return cli(line);
    },
  };
}

async function parseJson(text: string): Promise<Record<string, unknown>> {
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
