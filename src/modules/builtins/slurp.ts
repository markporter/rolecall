// Built-in module: `slurp` — Ansible `slurp` alternate (read a remote file into a var).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary Read a remote file's contents into a variable (Ansible `slurp` alternate). Exposes the decoded text and base64 both under `data.slurp` (backward compatible) and at the top level (`data.content` / `data.content_base64`) so Ansible-style `register.content` works. @param ctx ModuleContext carrying `src` (remote path). @returns ModuleResult with the file content in `data` and the same JSON in `stdout`. */
export const slurpModule: Module = {
  name: "slurp",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const src = String(ctx.args["src"] ?? "");
    if (!src) return { changed: false, failed: true, msg: "slurp: 'src' is required" };
    const res = await ctx.connection.exec(`cat ${shQuote(src)} | base64 -w0`);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `slurp: cannot read ${src}` };
    const b64 = (res.stdout ?? "").trim();
    const content = Buffer.from(b64, "base64").toString("utf8");
    const data = {
      slurp: { src, content, content_base64: b64 },
      content,
      content_base64: b64,
    };
    return {
      changed: false,
      data,
      stdout: JSON.stringify(data),
      msg: `slurp: ${src}`,
    };
  },
};

/** Search metadata for the `slurp` module. */
export const meta: ModuleSummary = {
  name: "slurp",
  description: "Read a remote file's contents into a variable (Ansible `slurp` alternate). Returns decoded text and base64 under both `data.slurp` and the top-level `data`.",
  source: "builtin",
  args: {
    src: { type: "string", required: true, description: "Remote path to read." },
  },
  examples: [
    `- slurp:
    src: /etc/hostname
  register: hn`,
  ],
  notes: "Both shapes are present: `register.data.slurp.content` / `content_base64` (backward compatible) and top-level `register.data.content` / `content_base64` (Ansible-style `register.content`). The same JSON is written to `stdout`.",
};

(slurpModule as Module & { meta: ModuleSummary }).meta = meta;
export default slurpModule;
