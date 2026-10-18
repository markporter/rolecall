// Built-in module: `slurp` — Ansible `slurp` alternate (read a remote file into a var).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Read a remote file's contents into a variable (Ansible `slurp` alternate). Returns the decoded text in `data.slurp.content` and base64 in `data.slurp.content_base64`. @param ctx ModuleContext carrying `src` (remote path). @returns ModuleResult with the file content in `data`. */
export const slurpModule: Module = {
  name: "slurp",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const src = String(ctx.args["src"] ?? "");
    if (!src) return { changed: false, failed: true, msg: "slurp: 'src' is required" };
    const res = await ctx.connection.exec(`cat ${shQuote(src)} | base64 -w0`);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `slurp: cannot read ${src}` };
    const b64 = (res.stdout ?? "").trim();
    return {
      changed: false,
      data: { slurp: { src, content: Buffer.from(b64, "base64").toString("utf8"), content_base64: b64 } },
      msg: `slurp: ${src}`,
    };
  },
};

/** Search metadata for the `slurp` module. */
export const meta: ModuleSummary = {
  name: "slurp",
  description: "Read a remote file's contents into a variable (Ansible `slurp` alternate). Returns decoded text and base64 in `data.slurp`.",
  source: "builtin",
  args: {
    src: { type: "string", required: true, description: "Remote path to read." },
  },
  examples: [
    `- slurp:
    src: /etc/hostname
  register: hn`,
  ],
  notes: "≠ Ansible `slurp`: the decoded text lives at `register.data.slurp.content` (Ansible nests it under `content` directly).",
};

(slurpModule as Module & { meta: ModuleSummary }).meta = meta;
export default slurpModule;
