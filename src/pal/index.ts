// PAL barrel + getPAL() factory.
//
// getPAL() is gated on detectRuntime() (src/util/runtime.ts). Under Bun it returns
// the Bun-native implementation set; under Node it returns the Node-native set
// (node:sqlite / node:crypto / node:dns / node:child_process / node:fs / node:http).
// Only the SSH surface stays a Node stub — product SSH goes through ssh2 directly.
// The barrel is Node-load-safe: bun:sqlite is obtained lazily via createRequire
// inside sqlite.bun.ts (a dynamic `import()` of bun-only modules is hoisted by the
// bundler and would crash Node at load).
import { detectRuntime } from "../util/runtime";
import type { PAL } from "./types";

import { BunSqlitePAL } from "./sqlite.bun";
import { BunCryptoPAL } from "./crypto.bun";
import { BunDnsPAL } from "./dns.bun";
import { BunSpawnPAL } from "./spawn.bun";
import { BunHttpPAL } from "./http.bun";
import { BunFilePAL } from "./file.bun";
import { BunObservabilityPAL } from "./observability.bun";
import { BunSshPAL } from "./ssh.bun";

import { NodeSqlitePAL } from "./sqlite.node";
import { NodeCryptoPAL } from "./crypto.node";
import { NodeDnsPAL } from "./dns.node";
import { NodeSpawnPAL } from "./spawn.node";
import { NodeHttpPAL } from "./http.node";
import { NodeFilePAL } from "./file.node";
import { NodeObservabilityPAL } from "./observability.node";
import { NodeSshPAL } from "./ssh.node";

export * from "./types";

export function getPAL(): PAL {
  const runtime = detectRuntime();
  if (runtime.name === "bun") {
    return {
      runtime: "bun",
      sqlite: new BunSqlitePAL(),
      crypto: new BunCryptoPAL(),
      dns: new BunDnsPAL(),
      spawn: new BunSpawnPAL(),
      http: new BunHttpPAL(),
      file: new BunFilePAL(),
      observability: new BunObservabilityPAL(),
      ssh: new BunSshPAL(),
    };
  }
  // Node branch is wired but deferred: every surface throws on use.
  return {
    runtime: "node",
    sqlite: new NodeSqlitePAL(),
    crypto: new NodeCryptoPAL(),
    dns: new NodeDnsPAL(),
    spawn: new NodeSpawnPAL(),
    http: new NodeHttpPAL(),
    file: new NodeFilePAL(),
    observability: new NodeObservabilityPAL(),
    ssh: new NodeSshPAL(),
  };
}
