// Smoke test — proves the bun test runner is wired and exits 0.
// Real unit/integration suites land in later waves (templating, inventory, transport, ...).
import { expect } from "bun:test";

expect(true).toBe(true);
