// Bun-native observability PAL — no-op shim for MVP (wired to a real backend later).
import type { ObservabilityPAL, LogLevel } from "./types";

export class BunObservabilityPAL implements ObservabilityPAL {
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    const line = `[${level}] ${message}${fields ? " " + JSON.stringify(fields) : ""}\n`;
    Bun.stderr.write(line);
  }

  metric(_name: string, _value: number, _fields?: Record<string, unknown>): void {
    // TODO(ROLECALL-PLACEHOLDER): Observability PAL no-op metric shim (real backend deferred)
    // no-op shim for MVP
  }
}
