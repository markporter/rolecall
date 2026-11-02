// Jinja-mode templating — Nunjucks engine + Ansible compatibility layer.
//
// Nunjucks is a JS Jinja2 port: it gives us `{% if %}` / `{% for %}` /
// `{{ x | filter }}`, macros, imports/extends, `loop.index`, and closer Jinja
// semantics than the previous LiquidJS engine. It is still not byte-identical
// to Jinja2; unsupported Ansible lookups/plugins fail loudly for the converter.
//
// SHARED FILTER REGISTRY: filters registered in `./filters.ts` are available in
// both eta (fast) and Jinnja modes. Ansible-specific filters/tests/globals live in
// `./ansible-filters.ts` and are synced before every render.
//
// LENIENT BY DEFAULT: undefined variables render as ""; `{ strict: true }` uses
// a second Environment with `throwOnUndefined: true`.

import nunjucks from "nunjucks";

import { getFilter, listFilters } from "./filters.js";
import { ANSIBLE_FILTERS, ANSIBLE_GLOBALS, ANSIBLE_TESTS } from "./ansible-filters.js";

export interface JinjaRenderOptions {
  /** Throw on undefined variables instead of rendering them as "". */
  strict?: boolean;
}

const LENIENT = new nunjucks.Environment(undefined, {
  autoescape: false,
  throwOnUndefined: false,
});
const STRICT = new nunjucks.Environment(undefined, {
  autoescape: false,
  throwOnUndefined: true,
});

let compatible = false;
function ensureCompat(): void {
  if (compatible) return;
  // Adds True/False/None and Python-style list/dict/string helpers.
  (nunjucks as unknown as { installJinjaCompat?: () => void }).installJinjaCompat?.();
  compatible = true;
}

function sync(env: nunjucks.Environment): void {
  ensureCompat();
  for (const name of listFilters()) {
    const fn = getFilter(name);
    if (fn) env.addFilter(name, fn as never);
  }
  for (const [name, fn] of Object.entries(ANSIBLE_FILTERS)) env.addFilter(name, fn as never);
  const withTests = env as unknown as { addTest: (name: string, fn: (...args: unknown[]) => boolean) => void };
  for (const [name, fn] of Object.entries(ANSIBLE_TESTS)) withTests.addTest(name, fn);
  for (const [name, value] of Object.entries(ANSIBLE_GLOBALS)) env.addGlobal(name, value);
}

/**
 * Render a Jinja/Nunjucks template with `vars`, returning deterministic output.
 * Undefined variables are lenient unless `{ strict: true }` is set.
 */
export function renderJinja(
  template: string,
  vars: Record<string, unknown> = {},
  opts: JinjaRenderOptions = {},
): string {
  const env = opts.strict === true ? STRICT : LENIENT;
  sync(env);
  return env.renderString(template, vars);
}
