// Built-in module: `json_query` — Ansible `json_query` parity via JMESPath,
// with JSON-pointer fallback for backward compatibility.

import { search as jmespathSearch } from "jmespath";
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

function queryValue(obj: unknown, q: string): unknown {
  if (q.trim().startsWith("/")) return resolve(obj, q);
  return jmespathSearch(obj, q);
}

/** @summary Look up a value with JMESPath (Ansible `json_query` parity); `/`-rooted queries keep the legacy JSON-pointer behavior. @param ctx ModuleContext carrying `data` (a var ref/value) and `query` (JMESPath or JSON pointer). @returns ModuleResult with the resolved value in `data.json_query`; parse/eval errors fail with a `json_query:` message instead of throwing. */
export const jsonQueryModule: Module = {
  name: "json_query",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const query = typeof a["query"] === "string" ? String(a["query"]) : "";
    if (!query) return { changed: false, failed: true, msg: "json_query: 'query' required" };
    const data = a["data"];
    let result: unknown;
    try {
      result = queryValue(data, query);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { changed: false, failed: true, msg: `json_query: ${detail}` };
    }
    return { changed: false, skipped: false, msg: `json_query: ${query}`, data: { json_query: result } };
  },
};

/** Search metadata for the `json_query` module. */
export const meta: ModuleSummary = {
  name: "json_query",
  description:
    "Query `data` with JMESPath (Ansible `json_query` parity); `/`-rooted queries use the legacy JSON-pointer resolver. Result in `data.json_query`.",
  source: "builtin",
  args: {
    data: { type: "any", required: true, description: "Value (or $var ref) to query." },
    query: {
      type: "string",
      required: true,
      description:
        "JMESPath expression, e.g. users[?age > `30`].name or length(items); a leading `/` selects a JSON pointer such as /items/0/name.",
    },
  },
  examples: [
    `- json_query:
    data:
      $var: users
    query: users[?age > \`30\`].name`,
    `- json_query:
    data:
      $var: response
    query: items[0].name`,
    `- json_query:
    data:
      $var: response
    query: /items/0/name`,
  ],
  notes:
    "JMESPath is evaluated in-process via the `jmespath` package (Ansible parity). Queries starting with `/` remain JSON-pointer lookups for backward compatibility; parse/eval errors fail with a `json_query:` message.",
};

(jsonQueryModule as Module & { meta: ModuleSummary }).meta = meta;
export default jsonQueryModule;
