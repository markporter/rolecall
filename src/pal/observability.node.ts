// Node fallback observability PAL — stderr mirror of observability.bun.ts.
//
// Preserves identical function signatures and messages to the Bun-native
// implementation; the only difference is the destination stream: every log line
// is written to `process.stderr` (never stdout) so diagnostics never corrupt a
// stdout-bound data channel.
import type { ObservabilityPAL, LogLevel } from "./types";

/** @summary Node-runtime observability PAL that mirrors BunObservabilityPAL, writing all log lines to `process.stderr`. @param level Severity tag prefixed to the line. @param message Human-readable message. @param fields Optional structured context appended as JSON. */
export class NodeObservabilityPAL implements ObservabilityPAL {
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    const line = `[${level}] ${message}${fields ? " " + JSON.stringify(fields) : ""}\n`;
    process.stderr.write(line);
  }

  /** @summary No-op metric sink for the Node-runtime MVP (mirrors the Bun shim). @param _name Metric name (unused in MVP). @param _value Metric value (unused in MVP). @param _fields Optional metric tags (unused in MVP). */
  metric(_name: string, _value: number, _fields?: Record<string, unknown>): void {
    // TODO(ROLECALL-PLACEHOLDER): Observability PAL no-op metric shim (real backend deferred)
    // no-op shim for MVP
  }
}
