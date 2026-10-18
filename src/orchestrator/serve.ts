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
export async function startServe(argv?: string[], opts: Partial<ServerOptions> = {}): Promise<number> {
  const args = argv ?? process.argv.slice(2);
  const portRaw = await readArg(args, "port", PORT_RE);
  const host = await readArg(args, "host", HOST_RE);
  const uiDistRaw = await readArg(args, "ui-dist", UI_DIST_RE);
  // Flag > env > default precedence preserved: CLI arg wins, else the value
  // resolved by loadConfig(), else the hard-coded fallback. Behavior matches the
  // prior ad-hoc process.env reads exactly for every real input.
  const cfg = loadConfig();
  const port = portRaw ? Number(portRaw) : (cfg.serve.port ?? 8080);
  const hostname = host ?? cfg.serve.host ?? "127.0.0.1";
  const uiDist = uiDistRaw ?? cfg.serve.uiDist;

  const handle = await createServer({ port, hostname, uiDist, ...opts });
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
