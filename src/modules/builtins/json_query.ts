// Built-in module: `json_query` — Ansible `json_query` alternate (JSON-pointer lookup).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";

/** Resolve a JSON-pointer (/a/b/0) or $.a.b[0] path against a value. */
function resolve(obj: unknown, q: string): unknown {
  let s = q.trim();
  if (s.startsWith("$.")) s = s.slice(2);
  const segs = s.split("/").filter((x) => x.length > 0);
  let cur: unknown = obj;
  for (const seg of segs) {
    if (cur == null) return undefined;
    const m = seg.match(/^(.+?)\[(\d+)\]$/);
    if (m) {
      const key = m[1] ?? "";
      const base = (cur as Record<string, unknown>)[key];
      cur = Array.isArray(base) ? base[Number(m[2])] : undefined;
    } else {
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

/** @summary Look up a value by JSON pointer (Ansible `json_query` alternate). @param ctx ModuleContext carrying `data` (a var ref/value) and `query` (JSON pointer). @returns ModuleResult with the resolved value in `data.json_query`. */
export const jsonQueryModule: Module = {
  name: "json_query",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const query = typeof a["query"] === "string" ? String(a["query"]) : "";
    if (!query) return { changed: false, failed: true, msg: "json_query: 'query' required" };
    const data = a["data"];
    const result = resolve(data, query);
    return { changed: false, skipped: false, msg: `json_query: ${query}`, data: { json_query: result } };
  },
};

/** Search metadata for the `json_query` module. */
export const meta: ModuleSummary = {
  name: "json_query",
  description: "Resolve a JSON-pointer (/a/b/0 or $.a.b[0]) path against `data` (Ansible `json_query` alternate). Result in `data.json_query`.",
  source: "builtin",
  args: {
    data: { type: "any", required: true, description: "Value (or $var ref) to query." },
    query: { type: "string", required: true, description: "JSON-pointer path, e.g. /items/0/name or $.items[0].name." },
  },
  examples: [
    `- json_query:
    data: $var
    query: /users/0/name`,
  ],
  notes: "≠ Ansible `json_query`: RoleCall does not embed JMESPath; this resolves JSON-pointer paths. For richer transforms use `$call` in `set_fact`.",
};

(jsonQueryModule as Module & { meta: ModuleSummary }).meta = meta;
export default jsonQueryModule;
