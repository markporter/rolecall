import { expect, test } from "bun:test";
import { detectRuntime } from "../src/util/runtime";

// Auto-detect resolves to bun under Bun by default; the ROLECALL_RUNTIME override
// forces the reported runtime in both directions (dual-runtime parity harness).
test("detectRuntime resolves to bun under Bun by default", () => {
  const forced = process.env["ROLECALL_RUNTIME"];
  if (forced === "bun" || forced === "node") {
    expect(detectRuntime().name).toBe(forced);
    return;
  }
  expect(detectRuntime().name).toBe("bun");
});
