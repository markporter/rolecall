// Built-in module: `script` — Ansible `script` alternate (alias of `shell`).
//
// `script` is an alias of `shell`: it forwards to `shellModule.run` with `local_src`
// set to the control-node script path (read here, executed on the target). It defaults
// `run_mode: always` (Ansible `script` runs every time) unless a `creates`/`removes`
// guard is present (then `idempotent`). See docs/content/concepts/alternate-modules.md.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shellModule } from "./shell";

type RunMode = "idempotent" | "readonly" | "always";

interface ScriptArgs {
  src?: unknown;
  creates?: unknown;
  removes?: unknown;
  run_mode?: unknown;
}

/** @summary Ansible `script` alias of `shell`. Reads a local `src` script and runs it on the target via `shell` (defaults `run_mode: always`, or `idempotent` with a `creates`/`removes` guard). @param ctx ModuleContext carrying `src` (local script), optional `creates`/`removes`, `run_mode`. @returns ModuleResult from the underlying shell run. */
export const scriptModule: Module = {
  name: "script",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args as unknown as ScriptArgs;
    const localSrc = typeof a.src === "string" ? a.src : "";
    if (!localSrc) return { changed: false, failed: true, msg: "script: 'src' (local script path) is required" };
    const hasGuard = a.creates !== undefined || a.removes !== undefined;
    const explicitMode = typeof a.run_mode === "string" ? (a.run_mode as RunMode) : undefined;
    const runMode = explicitMode ?? (hasGuard ? "idempotent" : "always");
    return shellModule.run({
      ...ctx,
      args: { ...a, local_src: localSrc, src: undefined, command: undefined, run_mode: runMode },
    } as ModuleContext);
  },
};

/** Search metadata for the `script` module. */
export const meta: ModuleSummary = {
  name: "script",
  description:
    "Ansible `script` alias of `shell`. Reads a local `src` script (control node) and runs it on the target via `shell`. Defaults `run_mode: always`, or `idempotent` with a `creates`/`removes` guard.",
  source: "builtin",
  args: {
    src: { type: "string", required: true, description: "Local path to the script on the control node." },
    creates: { type: "string", required: false, description: "Skip when this path exists (maps to shell idempotent guard)." },
    removes: { type: "string", required: false, description: "Skip when this path is absent (maps to shell idempotent guard)." },
    run_mode: { type: "idempotent | readonly | always", required: false, description: "Override the forwarded shell run_mode (default: always, or idempotent with a guard)." },
  },
  examples: [
    `- script:
    src: roles/web/files/setup.sh`,
  ],
  notes:
    "≠ Ansible `script`: `script` is an alias of `shell` — it sets `local_src` to your `src` and forwards to `shell`. You can use `shell` directly with `local_src` instead. Guards (`creates`/`removes`) make it `run_mode: idempotent`; otherwise it is `run_mode: always`.",
};

(scriptModule as Module & { meta: ModuleSummary }).meta = meta;
export default scriptModule;
