// Built-in module: `raw` — Ansible `raw` alternate (alias of `command`).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { commandModule } from "./command";

/** @summary Run a command with minimal processing (Ansible `raw` alternate). RoleCall's transport is already shell-based (no Python assumption), so `raw` is an alias of `command`. @param ctx ModuleContext (see `command`). @returns ModuleResult from `command`. */
export const rawModule: Module = {
  name: "raw",
  run: commandModule.run,
};

/** Search metadata for the `raw` module. */
export const meta: ModuleSummary = {
  name: "raw",
  description: "Run a command with minimal processing (Ansible `raw` alternate). RoleCall's transport is already shell-based, so `raw` aliases `command`.",
  source: "builtin",
  args: {
    cmd: { type: "string", required: true, description: "Command to run." },
  },
  examples: [
    `- raw:
    cmd: /usr/bin/python3 --version`,
  ],
  notes: "≠ Ansible `raw`: RoleCall assumes a shell-capable target (no Python bootstrap needed), so `raw` is identical to `command`.",
};

(rawModule as Module & { meta: ModuleSummary }).meta = meta;
export default rawModule;
