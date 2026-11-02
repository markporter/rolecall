// Hidden `__render-template` worker: receives {engine, template, vars} JSON on
// stdin and returns {ok, output} JSON on stdout. It is meant to run inside the
// ADR 0025 sandbox; it has no filesystem/network access of its own.

import { renderJinja } from "../../templating/jinja.js";
import { render as renderEta } from "../../templating/fast.js";

interface RenderRequest {
  engine?: unknown;
  template?: unknown;
  vars?: unknown;
  strict?: unknown;
}

export async function runRenderTemplateWorker(): Promise<number> {
  try {
    let input = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) input += chunk;
    const req = JSON.parse(input) as RenderRequest;
    if (typeof req.template !== "string") throw new Error("render-template: 'template' must be a string");
    const vars = typeof req.vars === "object" && req.vars !== null ? (req.vars as Record<string, unknown>) : {};
    const engine = String(req.engine ?? "jinja").toLowerCase();
    const output =
      engine === "eta" || engine === "ejs"
        ? renderEta(req.template, vars)
        : renderJinja(req.template, vars, { strict: req.strict === true });
    process.stdout.write(JSON.stringify({ ok: true, output }));
    return 0;
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return 1;
  }
}
