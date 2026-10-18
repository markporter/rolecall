// Jinja-mode templating — LiquidJS engine wrapper (Todo 7).
//
// Renders Jinja2-style templates (`{% if %}` / `{% for %}` / `{{ x | filter }}`)
// via LiquidJS. LiquidJS uses the SAME `{% %}` / `{{ }}` delimiters as Jinja2,
// so Jinja2 control-flow + pipe-filter syntax works out of the box.
//
// SHARED FILTER REGISTRY (single source of truth): filters are NOT defined here.
// They come from `./filters.ts` via `registerFilter`/`getFilter`/`listFilters`.
// `syncFilters()` pushes every registered filter into the LiquidJS engine before
// each render, so a filter registered ONCE works in BOTH fast (eta) and jinja
// (LiquidJS) modes — and a filter registered after engine creation still applies
// on the next render (live lookup, matching fast.ts).
//
// LENIENT BY DEFAULT (H4 review fix, decisions.md #5): vault / secret placeholders
// TODO(ROLECALL-PLACEHOLDER): Jinja vault/secret resolution deferred to server layer
// are deferred to the server layer, so an UNDEFINED variable renders as "" and does
// NOT throw. `strictVariables:false` is the engine default. Strict mode is OPT-IN
// via `opts.strict = true` (sets `strictVariables:true` for that render call, which
// throws on undefined).
//
// DETERMINISTIC: `parseAndRenderSync` renders synchronously; output is stable for
// the same (template, vars) input.

import { Liquid } from "liquidjs";
import { getFilter, listFilters } from "./filters.js";

export interface JinjaRenderOptions {
  /** Opt into strict variable mode. When true, undefined variables throw instead
   *  of rendering as "". Default false (lenient). */
  strict?: boolean;
}

// Single engine, lenient by default. Strict mode is applied per-render via
// renderOptions (no second engine needed). `strictFilters:false` means an
// unregistered filter is skipped rather than throwing — but we sync the shared
// registry before every render, so registered filters always resolve.
const engine = new Liquid({
  strictVariables: false,
  strictFilters: false,
  jsTruthy: true,
});

// Push every filter from the shared registry into the LiquidJS engine. Called
// before each render so filters registered after engine creation still apply
// (live lookup). `registerFilter` overwrites, so re-syncing is idempotent.
function syncFilters(): void {
  for (const name of listFilters()) {
    const fn = getFilter(name);
    if (fn !== undefined) {
      engine.registerFilter(name, fn as (value: unknown, ...args: unknown[]) => unknown);
    }
  }
}

/**
 * Render a Jinja2-style `template` with `vars`, returning deterministic output.
 *
 * TODO(ROLECALL-PLACEHOLDER): Jinja vault/secret resolution deferred to server layer
 * - Conditionals `{% if %}`, loops `{% for %}`, and pipe filters `{{ x | filter }}`
 * TODO(ROLECALL-PLACEHOLDER): Jinja vault/secret resolution deferred to server layer
 *   are supported (LiquidJS shares Jinja2's `{% %}` / `{{ }}` syntax).
 * - Filters resolve from the SHARED registry (`./filters.ts`) — register once, use
 *   in both fast and jinja modes.
 * - Undefined variables render leniently as "" by default (no throw). Pass
 *   `{ strict: true }` to throw on undefined variables.
 */
export function renderJinja(
  template: string,
  vars: Record<string, unknown> = {},
  opts: JinjaRenderOptions = {},
): string {
  syncFilters();
  return engine.parseAndRenderSync(template, vars, {
    strictVariables: opts.strict === true,
  }) as string;
}
