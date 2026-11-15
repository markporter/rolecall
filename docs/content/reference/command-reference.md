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

### project create / project init

`rolecall project create <name>` creates the documented ADR 0014/0030 project skeleton at `--dir` (or `./<slug(name)>`). `rolecall project init` scaffolds into an existing empty directory (default cwd). Both write `rolecall.yaml`, `playbooks/`, `inventory/inventory.yaml`, `plugins/<type>/<namespace>/`, `roles/`, `group_vars/`, `host_vars/`, `collections/`, `.rolecall/isolation.yaml`, and a commented `collections.yml`, never overwriting existing files. `--force` allows filling missing pieces into a non-empty directory; `--vcs git` runs `git init` and writes a `.gitignore`; `--dry-run` reports the plan without writing.

```sh
rolecall project create "My Site"
rolecall project create site --dir ./infra --namespace acme --vcs git
rolecall project init --dir .
```

### convert ansible

Bare `rolecall convert` opens an interactive wizard in a TTY: it asks for the Ansible source, the target project directory, whether to write files and the conversion gaps bundle, whether to be strict, and confirms before applying. `--yes`/`--non-interactive`/`--dry-run` skip the prompts.

`rolecall convert ansible <path>` analyzes an Ansible file or directory and mechanically rewrites the safely convertible constructs into RoleCall YAML. Module names are remapped (`template` -> `copy`, `apt`/`yum`/`dnf` -> `package`, `systemd` -> `service`), `with_items`/`with_dict` become `loop`, static top-level `include_vars` moves to `vars_files`, static `import_playbook` entries are inlined, task-level `include_role` is expanded with its defaults/vars/handlers, `with_first_found` becomes `copy` source/template candidates, `group_vars`/`host_vars` and role `defaults`/`vars` Jinja is converted, Ansible YAML/INI inventory connection vars (`ansible_host`, `ansible_user`, `ansible_port`, `ansible_connection`, keys/passwords) are rewritten to `rolecall_*`, shell `changed_when` maps to `run_mode`, `ignore_errors` maps to `accept_failure` (with a review note on shell tasks), shell `failed_when: false` maps to `shell_register` with `capture_errors`, `retries`/`until`/`delay` become native fields, and static play `remote_user` is applied to the connection, blocks flatten into `tx` groups, and any Jinja expression is wrapped in `$jinja` (the sole Jinja escape hatch) with known Ansible magic variables rewritten to `facts.*`/`play.host`/`inv.*` (`hostvars[h]` -> `inv.host_vars[h]`, `groups[g]` -> `inv.group_hosts[g]`). Nothing is written unless you pass `--write` (or `--gaps`, which emits the conversion gaps bundle without converting files).

```sh
rolecall convert ansible ./ansible-site --out ./site --write
rolecall convert ansible ./ansible-site --project ./new-project --write
rolecall convert ansible ./ansible-site --templates eta   # convert mapped .j2 files
rolecall convert ansible ./ansible-site --templates eta --templates-review accept
rolecall convert ansible ./site --strict          # exit 1 if review/gap items remain
rolecall convert ansible --validate ./site        # strict-load playbooks + template refs
```

`--templates keep` (default) preserves Jinja and `.j2` files verbatim. `--templates eta` runs the ADR 0031 template pass: it parses each `.j2` with the Nunjucks AST, classifies constructs as mapped/review/gap, and emits work orders. Fully mapped templates are written as `.eta` and their task references are rewritten to `engine: eta`; review/gap templates keep the original `.j2` and `engine: jinja`, and receive a partial Eta draft under `conversion_gaps/templates/<id>.eta.draft` with `GAP` markers. `--templates-review accept` allows codegen for `review` constructs (only after a parity review); gap constructs still stay Jinja.

`--project <dir>` ensures a blank RoleCall project exists at that root (the ADR 0014/0030 shape: `rolecall.yaml`, `playbooks/`, `inventory/`, `plugins/<type>/<namespace>/`, `roles/`, `group_vars/`, `host_vars/`, `collections/`, `.rolecall/isolation.yaml`) and then populates it with the converted tree. Existing files are never overwritten, so it is safe to run against an existing project.

Constructs with no faithful mechanical equivalent (`async`/`poll`, dynamic includes/`include_vars`, `lookup`/`query`, `delegate_facts`, task-level `vars`, etc.) are recorded in `CONVERSION_GAPS.md` and `manifest.json` under `--gaps` (default `<out>/conversion_gaps`). `--strict` exits non-zero when any review or gap item remains. `--validate` strict-loads each converted playbook and also checks that `copy.content.template_file` references resolve, that `engine` matches the file extension (`.eta` for eta, `.j2`/`.jinja` for jinja), and that no template is half-converted (both `.eta` and `.j2` present). The handler lives in `src/cli/commands/convert.ts`, the analyzer/rewriter in `src/convert/ansible.ts`, and the typed compatibility matrix in `src/convert/matrix.ts`; add `-o json` (or `--report json`) for the structured `ConvertResult`.

### vars list

`rolecall vars list <playbook>` aggregates every declared variable/fact across all plays and groups them by the file that declared them (`roles/<role>/defaults/var-manifest.yml`, the playbook-root manifest, or inline). It also prints the observable-fact capability set: the fact keys each connection kind (`ssh` / `local` / `network` / `http`) can gather, built from the built-in gatherers plus any registered fact plugins. Add `-o json` for a structured `VarsListResult` (`{ command, declared, factsByKind }`) that LLM clients can consume directly. The handler lives in `src/cli/commands/vars.ts` and returns a `VarsListResult`.

### vars trace

`rolecall vars trace <playbook> [--inventory <inv>] [--extra-vars <kv>] [--limit <host>]` re-merges the same precedence tiers the executor uses, but retains origin metadata so overrides are traceable (a Splunk-`btool` `--debug` for variables). For each resolved host it reports the winning value of every variable, the tier/file that set it, and the full override chain `role-default < inv-group < inv-host < play < extra`. `--inventory` pulls in `group_vars`/`host_vars`; `--extra-vars` is the highest tier and always wins; `--limit` restricts which hosts are traced. The handler lives in `src/cli/commands/vars.ts` and returns a `VarsTraceResult` (`{ command, plays }`). Add `-o json` for structured output.

### doctor

`rolecall doctor` probes the local isolation backend without executing anything and reports the resolved ADR 0023 install layout (scope, program/config/state/cache/bin paths, and whether `rolecall.env` exists). It reports whether `bwrap` and unprivileged user namespaces work, whether `unshare` is present, whether the Docker CLI and daemon are reachable and rootless, the configured image (and whether it is digest-pinned), and which backend `auto`/an explicit `--isolation` selection would use. The human output lists the probe reasons and warnings; `-o json` returns the same data as a structured `DoctorResult`. Execution isolation is default-on `auto` (overridable with `ROLECALL_ISOLATION` or `--isolation`); if no backend is available it fails closed with guidance rather than silently running unsandboxed. `--isolation none` is the explicit, warned escape.

### install

`rolecall install` plans the ADR 0023 install layout. It defaults to a dry-run; `--yes` applies by creating config/state/cache directories, `rolecall.env`, `install.json`, and a service unit/plist. `--exposed` writes a generated serve token and exposure settings to `rolecall.env`. It does not place the binary, enable the service, or edit PATH. See [/reference/install-command](/reference/install-command).

### isolation

`rolecall isolation allow|revoke|list|allow-egress|revoke-egress` manages the operator-owned filesystem grants and egress destinations in `isolation.yaml` (ADR 0023/0025). Grants are keyed by canonical `file://` project URI; `--from-request` promotes an advisory request from the project's `.rolecall/isolation.yaml` instead of self-approving it. Durable grants merge below one-off `--mount`/`--allow-egress` flags for `playbook run` and `facts gather`. See [/reference/isolation-commands](/reference/isolation-commands).

### runtime

`rolecall runtime install|status|remove` manages the optional standalone Bun toolchain (ADR 0023 §5). The native binary already embeds Bun; `status` reports `embedded` until an external toolchain is installed. See [/reference/runtime-commands](/reference/runtime-commands).

### service

`rolecall service install|uninstall|start|stop|restart|status` plans or executes the ADR 0023 service lifecycle. Changes are dry-run by default (`--yes` applies); `status` is read-only. See [/reference/install-command#service-lifecycle](/reference/install-command#service-lifecycle).

### uninstall

`rolecall uninstall` plans or applies the ADR 0023 reverse of install: stop/disable the service, remove the manifest and unit, and keep config/state unless `--purge`. It defaults to a dry-run; `--yes` applies. See [/reference/install-command#uninstall](/reference/install-command#uninstall).

### update

`rolecall update --check [--from-dir DIR]` reports the installed and candidate versions. `rolecall update --from-dir DIR` stages a checksummed binary under `versions/<version>`, switches the `current` symlink, updates the manifest, and restarts the service unless `--no-restart`. `--rollback` returns to the recorded previous version. See [/reference/install-command#update-and-rollback](/reference/install-command#update-and-rollback).
