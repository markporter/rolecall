// Templating barrel — fast eta engine + Nunjucks Jinja-mode + shared filter registry (Wave 2).
//
// Fast mode (eta, compile-to-JS + cache) lives in `fast.ts`. Jinja-mode (Nunjucks + Ansible filters)
// lives in `jinja.ts`. Both reuse the shared filter registry in `filters.ts`, which
// is the single source of truth for template filters.
export * from "./filters.js";
export * from "./fast.js";
export * from "./jinja.js";
