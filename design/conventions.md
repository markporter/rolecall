# Conventions

## For contributors

- **Dual-runtime tests**: primary runner is Bun-native `bun test`. Always also force
  both detection branches: `ROLECALL_RUNTIME=bun bun test` and `ROLECALL_RUNTIME=node bun test`.
- **Type-check gate**: finish every change with `bun run build` (`tsc --noEmit`, exit 0).
- **TSDoc-on-change**: annotate public exports you add/touch with TSDoc tags
  (`@summary`, `@param`, …). TypeDoc reads them into `docs/api`.
- **Docs-sync on public change**: when you change a public export/signature/behavior
  surfaced in the guide, run the `documentation` skill to regenerate API reference,
  VitePress, and the OpenAPI module, keeping `/docs.json` in sync.
- **Source of truth is `src/`**: if `README.md`'s status banner conflicts with actual
  `src/`, trust `src/` and document what it really does.
- **Honesty**: never claim Wave-0 scaffold (executor/transport/idempotency-real/
  templating-real/plugin-SDK/facts/scheduler/UI) as functional.

## For agents

- Operate per `AGENTS.md` (it explains how to *use* vs *code* RoleCall).
- For **design context** (goals, roadmap, architecture, decisions), read this `design/`
  folder — it is the "why/where-to", kept as plain Markdown.
- For **user-facing how-to/reference**, read `docs/` (VitePress).
- Do not invent flags/subcommands not present in `src/cli/index.ts` or the HELP string.
- When improving RoleCall over time, record significant decisions as new ADRs in
  `design/decisions/` (see `0001-record-architecture-decisions.md`).
