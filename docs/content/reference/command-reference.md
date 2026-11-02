---
title: Command Reference
---

The Command Reference catalogs the top-level subcommands exposed by `rolecall`.

Every subcommand below comes straight from the `HELP` string and dispatch switch in `src/cli/index.ts`, plus what actually prints when you run RoleCall today. Run `rolecall --help` to see the same list, because the CLI parses argv once with `node:util`'s `parseArgs` and routes on the positionals. Unknown commands exit non-zero (`error: unknown command '...'`) instead of dumping a stack trace, so every surface here degrades gracefully.

The primary execution surfaces are described below, alongside `doctor` for local isolation readiness, `install` for the ADR 0023 layout, and the `docs`/`agent` inspection commands. `**playbook run <file>**` loads and validates the playbook YAML, resolves an optional `--inventory`, and applies state over SSH/local transports: it resolves matched hosts, builds a connection per host (`rolecall_connection` selects ssh|local|network), and drives each task live rather than merely printing a dry-run skeleton. See [/reference/playbook-commands](/reference/playbook-commands). **`facts gather <inv>`** resolves inventory targets and gathers targeted/cached facts for each resolved host through its built connection, failing gracefully on unreachable ones. See [/reference/facts-commands](/reference/facts-commands). **`inventory show <inv>`** prints resolved hosts and their merged variables, while **`inventory list <inv>`** simply enumerates group names; both work end to end without transport. See [/reference/inventory-commands](/reference/inventory-commands). **`vars list <play>`** surfaces every declared variable/fact grouped by its declaring file plus the fact capability per connection kind, while **`vars trace <play>`** prints the Splunk-btool-style precedence/override view (winning value + file/layer + chain) per host; both are additive and never touch the executor. See [/reference/vars-commands](/reference/vars-commands). **`plugin register <name> --path <file>`** persists a user module to a plugin manifest so `playbook run` can dispatch it, while **`plugin list`** merges those registered module/fact plugins with the built-in inventory plugins. See [/reference/plugin-commands](/reference/plugin-commands).

Global flags such as `--output`, `--limit`, `--inventory`, `--force/--check/--diff`, `--forks`, `--isolation`, `--isolation-network`, `--mount`, and `--allow-egress` attach to any of these and are parsed once regardless of subcommand. Serve mode sits apart and is covered in [/reference/serve-command](/reference/serve-command). The remaining sections go deeper into each piece, so treat this page as the index that points at them rather than a full description of any single command.

### docs search

`rolecall docs search <query>` runs a case-insensitive substring search across every markdown file under `docs/content/**/*.md`. For each matching line it records the nearest preceding markdown heading, the 1-based line number within that file, and the trimmed source line as the snippet. Hits are grouped per file, ordered most-matching-first then by line ascending, and truncated to the first 20 results (the hard ceiling is 100). By default it prints human-readable blocks; add `-o json` for structured `{ query, count, hits }` output that LLM clients can consume directly.

The implementation lives in `src/docs/search.ts` and reads files through `node:fs/promises`, resolving `docs/content` relative to its own module so it works from a clean checkout or against installed prose alike, on both Node.js and Bun. An empty or whitespace-only query exits non-zero (`error: docs search requires a query term`). This same search backs the `docs.search` agent tool served over HTTP at `GET /mcp/docs`; see [/reference/serve-command](/reference/serve-command) for the server-side route.

### docs modules

`rolecall docs modules [<term>]` lists every module RoleCall can dispatch via `module:` in a task, drawing straight from the runtime `meta` populated by `registerAllModules()` (no hand-maintained index to drift). With no `<term>` it returns all modules; with a `<term>` it does a case-insensitive substring match against each module's `name` or `description`, sorted by name for deterministic output. `rolecall docs search <x>` indexes the generated [/reference/module-reference](/reference/module-reference) page, so `rolecall docs search edit` returns `reference/module-reference.md` hits.

The handler lives in `src/cli/commands/docs.ts` and returns a `DocsModulesResult` (`{ command, query, count, modules }`) rendered by the output plugin. Because the default `syslog` plugin is a no-op for end-of-run renders, `rolecall docs modules` without an explicit `-o` flag falls back to `human_summary` so the table is actually printed; `docs search` keeps its existing default behavior. Add `-o json` for a structured `DocsModulesResult` that LLM clients can consume directly.

### vars list

`rolecall vars list <playbook>` aggregates every declared variable/fact across all plays and groups them by the file that declared them (`roles/<role>/defaults/var-manifest.yml`, the playbook-root manifest, or inline). It also prints the observable-fact capability set: the fact keys each connection kind (`ssh` / `local` / `network` / `http`) can gather, built from the built-in gatherers plus any registered fact plugins. Add `-o json` for a structured `VarsListResult` (`{ command, declared, factsByKind }`) that LLM clients can consume directly. The handler lives in `src/cli/commands/vars.ts` and returns a `VarsListResult`.

### vars trace

`rolecall vars trace <playbook> [--inventory <inv>] [--extra-vars <kv>] [--limit <host>]` re-merges the same precedence tiers the executor uses, but retains origin metadata so overrides are traceable (a Splunk-`btool` `--debug` for variables). For each resolved host it reports the winning value of every variable, the tier/file that set it, and the full override chain `role-default < inv-group < inv-host < play < extra`. `--inventory` pulls in `group_vars`/`host_vars`; `--extra-vars` is the highest tier and always wins; `--limit` restricts which hosts are traced. The handler lives in `src/cli/commands/vars.ts` and returns a `VarsTraceResult` (`{ command, plays }`). Add `-o json` for structured output.

### doctor

`rolecall doctor` probes the local isolation backend without executing anything and reports the resolved ADR 0023 install layout (scope, program/config/state/cache/bin paths, and whether `rolecall.env` exists). It reports whether `bwrap` and unprivileged user namespaces work, whether `unshare` is present, whether the Docker CLI and daemon are reachable and rootless, the configured image (and whether it is digest-pinned), and which backend `auto`/an explicit `--isolation` selection would use. The human output lists the probe reasons and warnings; `-o json` returns the same data as a structured `DoctorResult`. Execution isolation is default-on `auto` (overridable with `ROLECALL_ISOLATION` or `--isolation`); if no backend is available it fails closed with guidance rather than silently running unsandboxed. `--isolation none` is the explicit, warned escape.

### install

`rolecall install` plans the ADR 0023 install layout. It defaults to a dry-run; `--yes` applies by creating config/state/cache directories, `rolecall.env`, `install.json`, and a service unit/plist. It does not place the binary, enable the service, or edit PATH. See [/reference/install-command](/reference/install-command).

### service

`rolecall service install|uninstall|start|stop|restart|status` plans or executes the ADR 0023 service lifecycle. Changes are dry-run by default (`--yes` applies); `status` is read-only. See [/reference/install-command#service-lifecycle](/reference/install-command#service-lifecycle).

### uninstall

`rolecall uninstall` plans or applies the ADR 0023 reverse of install: stop/disable the service, remove the manifest and unit, and keep config/state unless `--purge`. It defaults to a dry-run; `--yes` applies. See [/reference/install-command#uninstall](/reference/install-command#uninstall).
