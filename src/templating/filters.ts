// Shared filter registry — the SINGLE SOURCE OF TRUTH for template filters.
//
// Both the fast path (eta, this module's sibling `fast.ts`) and the Todo 7
// LiquidJS Jinja-mode engine pull filters from here. Filters are plain callables
// keyed by name; they are engine-agnostic so either engine can adapt them.
//
// A filter receives the interpolated argument(s) as `unknown` and returns
// `unknown` (coerced to string by the rendering engine). Registering a filter
// makes it callable inside a template as `{{ name(arg) }}`.

/** @summary Callable template filter taking unknown args and returning an unknown value. */
export type FilterFn = (...args: unknown[]) => unknown;

const registry = new Map<string, FilterFn>();

/** Register (or overwrite) a named template filter keyed by name; plain callable shared across fast mode and Todo 7's Jinja-mode (single source of truth). */
export function registerFilter(name: string, fn: FilterFn): void {
  registry.set(name, fn);
}

/** Look up a registered filter by name, or `undefined` if absent. */
export function getFilter(name: string): FilterFn | undefined {
  return registry.get(name);
}

/** Whether a filter with the given name is registered. */
export function hasFilter(name: string): boolean {
  return registry.has(name);
}

/** Sorted list of registered filter names (deterministic ordering). */
export function listFilters(): string[] {
  return [...registry.keys()].sort();
}

/** Remove all registered filters. Primarily for tests / reset. */
export function clearFilters(): void {
  registry.clear();
}
