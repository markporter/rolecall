// Node fallback for the SSH PAL surface.
// TODO(ROLECALL-PLACEHOLDER): Node PAL ssh surface deferred past MVP (throws on use)
// DEFERRED past MVP (Bun-only target). Intended implementation: ssh2 Client
// (already an installed devDep) — same wrapper shape as the Bun impl.
import type { SshPAL } from "./types";

export class NodeSshPAL implements SshPAL {
  connect(_options: import("./types").SshConnectionOptions): never {
    // TODO(ROLECALL-PLACEHOLDER): Node PAL surface deferred past MVP (throws on use)
    throw new Error("PAL Node fallback deferred past MVP (rolecall)");
  }
}
