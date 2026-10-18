// Graceful shutdown wiring for the RoleCall orchestrator server (Task 18).
//
// On SIGINT/SIGTERM we stop accepting new work, drain in-flight run handlers up
// to a bounded window, close the DB pool, then tear down the HTTP listener. The
// express app/http server types come from the ambient shim / node:http.

import type { ServerHandle } from "./serve";

export interface ShutdownOptions {
  /** Max ms to wait for in-flight runs before forcing teardown. Default 3000. */
  drainMs?: number;
}

/** Register SIGINT/SIGTERM listeners once on the handle. Idempotent. */
export function installSignalHandlers(handle: ServerHandle, opts: ShutdownOptions = {}): void {
  const drainMs = opts.drainMs ?? 3000;
  let shuttingDown = false;

  const settle = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Reject any NEW dispatches during drain by flagging the engine.
    handle.markShuttingDown();
    try {
      await Promise.race([
        handle.drain(),
        new Promise<void>((resolve) => setTimeout(resolve, drainMs)),
      ]);
    } catch { /* ignore drain errors — force teardown anyway */ }
    try { handle.store?.close(); } catch { /* best-effort */ }
    try { handle.closeDrain(); } catch { /* already closed */ }
    process.exit(0);
  };

  process.on("SIGINT", () => void settle());
  process.on("SIGTERM", () => void settle());
}
