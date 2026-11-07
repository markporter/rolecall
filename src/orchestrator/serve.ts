// High-level server entrypoint for `rolecall --serve` (Task 18).
//
// createServer() builds the Express app, wires JSON parsing + routes, opens the
// durable store (unless supplied), starts listening, and installs signal-driven
// graceful shutdown. startServer() is the thin CLI wrapper bin/rolecall.js/main invoke.

import { once } from "node:events";
import path from "node:path";
import express from "express";

import { loadConfig } from "../config/env";
import { openStore } from "../store";
import type { Store } from "../store";
import { Engine } from "./engine";
import { mountRoutes } from "./routes";
import { makeExposedAuthMiddleware } from "./auth";
import { installStaticUi } from "./static-ui";
import { installSignalHandlers } from "./shutdown";
import { CronScheduler } from "./scheduler";
import type { JobBody, RunRecord, SchedulerApi, ServerOptions } from "./types";

/** Handle returned by createServer(): enough to probe status and shut down. */
export interface ServerHandle {
  readonly baseUrl: string;
  readonly port: number;
  readonly store?: Store;
  /** True once a graceful-drain sequence has begun. */
  isDraining(): boolean;
  markShuttingDown(): void;
  /** Resolve when all dispatched runs have settled (bounded by caller). */
  drain(): Promise<void>;
  schedulerStart(): Promise<void>;
  schedulerStop(): void;
  /** Stop HTTP listener + remove any listeners. Safe to call twice. */
  closeDrain(): void;
  runStatus(id: string): RunRecord | undefined;
  listRuns(): RunRecord[];
}

const PORT_RE = /^--?(?:port|p)(?:=|$)/;
const HOST_RE = /^--?(?:host|h)(?:=|$)/;
const UI_DIST_RE = /^--?(?:ui-dist)(?:=|$)/;
const EXPOSED_RE = /^--exposed(?:=|$)/;
const ALLOW_ANONYMOUS_RE = /^--allow-anonymous(?:=|$)/;

async function readArg(args: string[], key: string, re: RegExp): Promise<string | undefined> {
  const i = args.findIndex((a) => re.test(a));
  if (i === -1) return undefined;
  const tok = args[i]!;
  if (tok.includes("=")) return tok.slice(tok.indexOf("=") + 1);
  return args[i + 1];
}

export async function createServer(opts: ServerOptions): Promise<ServerHandle> {
  const store = opts.store ?? openStore();
  const engine = new Engine(store, opts.fleet ?? [], undefined, opts);
  const scheduler = new CronScheduler({ tickMs: opts.tickMs, repo: store.schedules, engine });
  const api: SchedulerApi = opts.scheduler ?? scheduler;
  const app = express();
  if (opts.exposed === true && opts.allowAnonymous !== true) {
    if (!opts.authToken) {
      throw new Error("exposed serve mode requires a Bearer token (set ROLECALL_SERVE_TOKEN)");
    }
    // ADR 0027: exposed mode authenticates every route except /health. Keep this
    // ahead of body parsing so unauthenticated payloads are never decoded.
    app.use(makeExposedAuthMiddleware(opts.authToken));
  }
  app.use(express.json({ limit: "4mb" }));
  // Pluggable static UI must precede mountRoutes so it shadows GET "/" when active.
  installStaticUi(app, opts.uiDist);
  mountRoutes(app, { engine, store, scheduler: api, authToken: opts.authToken });

  const port = opts.port ?? 0;
  const hostname = opts.hostname ?? "127.0.0.1";
  const http = app.listen(port, hostname) as unknown as import("http").Server;
  await once(http, "listening");
  const addr = http.address() as { port: number };
  const base = `http://${hostname}:${addr.port}`;

  let draining = false;
  const handle: ServerHandle = {
    baseUrl: base,
    port: addr.port,
    store,
    isDraining: () => draining,
    markShuttingDown: () => { draining = true; engine.setDraining(true); },
    drain: async () => {
      // Poll until no runs remain active, bounded so callers can race a timeout.
      while (engine.active() > 0) {
        await new Promise((r) => setTimeout(r, 25));
      }
    },
    schedulerStart: async () => { await scheduler.start(); },
    schedulerStop: () => { try { scheduler.stop(); } catch { /* already stopped */ } },
    closeDrain: () => {
      try { scheduler.stop(); } catch { /* already stopped */ }
      try { http.close(() => undefined); } catch { /* best-effort */ }
      draining = false;
    },
    runStatus: (id) => engine.get(id),
    listRuns: () => engine.list(),
  };

  if (!opts.noSignalHandlers) installSignalHandlers(handle);
  return handle;
}

/**
 * CLI entrypoint: parse --port/--host, boot the server, and block until signalled.
 * @param argv Command-line arguments (defaults to process.argv.slice(2)).
 * @param opts Optional overrides forwarded to createServer() (e.g. noSignalHandlers for tests). Defaults empty so normal invocations are unaffected.
 * @returns Exit code once a termination signal triggers graceful shutdown (always 0 today).
 */
/** ADR 0023: refuse to serve as root unless explicitly allowed. */
export function serveRootProblem(uid: number | undefined, allowRoot = process.env["ROLECALL_ALLOW_ROOT"]): string | undefined {
  if (uid === 0 && allowRoot !== "1") {
    return "refusing to run --serve as root; use an unprivileged account or set ROLECALL_ALLOW_ROOT=1 explicitly";
  }
  return undefined;
}

/** @summary Test whether a listen host resolves to loopback (localhost, 127.0.0.0/8, ::1). @param hostname Listen host from `--host` or config. @returns True for loopback-only hosts. */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return h === "localhost" || h === "::1" || h === "0:0:0:0:0:0:0:1" || h.startsWith("127.");
}

export interface ServeExposureInput {
  /** Resolved listen hostname. */
  hostname: string;
  /** True when the exposed profile is active. */
  exposed?: boolean;
  /** Configured Bearer token. */
  token?: string;
  /** Test-only escape hatch that bypasses the token requirement. */
  allowAnonymous?: boolean;
}

/** @summary ADR 0023/0027 exposure gate: non-loopback binds require `--exposed` plus a Bearer token. @param input Resolved host, exposed flag, token, and the test-only allow-anonymous escape hatch. @returns An actionable error message, or undefined when the bind is allowed. */
export function serveExposureProblem(input: ServeExposureInput): string | undefined {
  const loopback = isLoopbackHost(input.hostname);
  if (input.exposed === true && !input.token && input.allowAnonymous !== true) {
    return "refusing --exposed without a Bearer token; set ROLECALL_SERVE_TOKEN or pass --allow-anonymous for tests only";
  }
  if (loopback) return undefined;
  if (input.exposed !== true) {
    return `refusing to bind non-loopback host '${input.hostname}' without --exposed; use 127.0.0.1 or pass --exposed with ROLECALL_SERVE_TOKEN`;
  }
  if (!input.token && input.allowAnonymous !== true) {
    return `refusing to bind non-loopback host '${input.hostname}' without a Bearer token; set ROLECALL_SERVE_TOKEN or pass --allow-anonymous for tests only`;
  }
  return undefined;
}

export async function startServe(argv?: string[], opts: Partial<ServerOptions> = {}): Promise<number> {
  const rootProblem = serveRootProblem(typeof process.getuid === "function" ? process.getuid() : undefined);
  if (rootProblem) {
    process.stderr.write(`rolecall: ${rootProblem}\n`);
    return 1;
  }
  const args = argv ?? process.argv.slice(2);
  const portRaw = await readArg(args, "port", PORT_RE);
  const host = await readArg(args, "host", HOST_RE);
  const uiDistRaw = await readArg(args, "ui-dist", UI_DIST_RE);
  const exposedFlag = args.some((a) => EXPOSED_RE.test(a));
  const allowAnonymous = args.some((a) => ALLOW_ANONYMOUS_RE.test(a)) || opts.allowAnonymous === true;
  // Flag > env > default precedence preserved: CLI arg wins, else the value
  // resolved by loadConfig(), else the hard-coded fallback. Behavior matches the
  // prior ad-hoc process.env reads exactly for every real input.
  const cfg = loadConfig();
  const port = portRaw ? Number(portRaw) : (cfg.serve.port ?? 8080);
  const hostname = host ?? cfg.serve.host ?? "127.0.0.1";
  const uiDist = uiDistRaw ?? cfg.serve.uiDist;
  const token = opts.authToken ?? cfg.serve.token;
  const exposed = exposedFlag || cfg.serve.exposed === true || opts.exposed === true;

  const exposureProblem = serveExposureProblem({ hostname, exposed, token, allowAnonymous });
  if (exposureProblem) {
    process.stderr.write(`rolecall: ${exposureProblem}\n`);
    return 1;
  }
  if (allowAnonymous) {
    process.stderr.write("warning: --allow-anonymous disables serve authentication; tests only\n");
  }

  const handle = await createServer({
    ...opts,
    port,
    hostname,
    uiDist,
    authToken: token,
    exposed,
    allowAnonymous,
  });
  await handle.schedulerStart();
  const log = typeof Bun !== "undefined" && typeof Bun.stdout === "object" ? (s: string) => Bun.stdout.write(s + "\n") : (s: string) => console.log(s);
  log(`rolecall --serve listening on ${handle.baseUrl} (pid ${process.pid})`);
  if (uiDist) log(`  ui:      serving static dist "${path.resolve(uiDist)}"`);
  log(`  health:  GET ${handle.baseUrl}/health`);
  log(`  dispatch:POST ${handle.baseUrl}/run   body {"type":"playbook|adhoc|nonIdempotent", ...}`);

  // Block until termination. installSignalHandlers(), wired inside createServer(),
  // owns graceful shutdown: on SIGINT/SIGTERM it drains in-flight runs up to drainMs,
  // closes the store/DB pool, tears down the listener, then exits via process.exit().
  // Returning here would let the callers in src/cli/index.ts and bin/rolecall.js invoke
  // process.exit(main()) immediately and kill the freshly bound HTTP listener before
  // any request could be served. The listening socket alone keeps this process alive;
  // nothing below resolves until the signal-driven shutdown ends the process.
  await new Promise<never>(() => {
    /* intentionally never resolves — settled only by process.exit() inside settle() */
  });
  return 0; // unreachable while serving; retained only to satisfy Promise<number>
}

// Re-exported for convenience / barrel consumers that only need the job shape.
export type { JobBody, RunRecord, SchedulerApi, ServerOptions };
