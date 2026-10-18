// Sample user-authored .ts plugin (no build step) — used by tests/modules.test.ts.
// Self-contained: only a type-only import of the Module contract (erased at load).
import type { Module } from "../../../src/executor/module";

const greeter: Module = {
  name: "greeter",
  async run(ctx) {
    const who = String(ctx.args["who"] ?? "world");
    return { changed: false, stdout: `hello ${who}`, msg: `greeted ${who}` };
  },
};

export default greeter;
