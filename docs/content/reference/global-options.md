---
title: Global Options
---

Global options apply regardless of which subcommand follows on the command line.

They come directly from `GLOBAL_OPTS` in `src/cli/index.ts`, which passes them to `parseArgs` in a single strict pass. Because parsing happens once, you may place these flags anywhere on the line, before or after the subcommand. Every flag below is described exactly as implemented, nothing invented.

| Flag | Form | Meaning | Default |
| --- | --- | --- | --- |
| `--output` | `-o <plugin>` | Output renderer: `syslog` (realtime per-task JSON lines, **default**), `human_summary` (readable end-of-run table), `json` (deeply key-sorted, stable stdout), or `jsonl` (typed event + final-result stream used by the serve child-run protocol). | `syslog` |
| `--limit` | `<hosts>` | Restrict target hosts to a single pattern. | none |
| `--inventory` | `<file>` | Inventory source consumed by `playbook run`. | none |
| `--extra-vars` | `-e <kv>` | Runtime vars as space-separated `key=value` pairs; applied as the highest precedence layer over play and inventory vars. | none |
| `--tags` | `<list>` | Run only tasks carrying any listed tag (comma-separated, whitespace-trimmed). Untagged tasks are skipped. | none |
| `--skip-tags` | `<list>` | Exclude tasks carrying any listed tag (comma-separated, whitespace-trimmed); wins over `--tags` on conflict. | none |
| `--force` | none | Bypass idempotency skips and force convergence (passed to modules as `force`). | off |
| `--check` | none | Global dry-run: check-capable modules observe and report would-change without converging; custom modules without check support are skipped. Every shipped builtin supports check mode. | off |
| `--diff` | none | Attach an observed-vs-desired patch to each checkable module result (human output prints it; JSON carries it in `iterationData[].diff`). | off |
| `--forks` | `<N>` | Concurrency fan-out; must resolve to a finite number or RoleCall exits 2. | unset |
| `--isolation` | `auto`\|`namespace`\|`docker`\|`none` | Opt local transports into the ADR 0025 sandbox. The current slice is opt-in; `rolecall doctor` reports bwrap/userns and Docker readiness. | unset (direct) |
| `--isolation-network` | `module`\|`none`\|`all` | Sandbox egress policy: `module` (default) lets trusted modules that declare `network: true` use the network while shell/command/script/raw stay net-off; `none` denies all; `all` is ambient (warned). | `module` |
| `--mount` | `<src:dst[:ro|rw]>` | Repeatable explicit filesystem grant, requires `--isolation`. Source and target must be absolute; `ro` is the default. | none |
| `--allow-egress` | `<host[:port]>` | Repeatable ephemeral destination whitelist entry, requires `--isolation`. Module URL checks (`http`/`get_url`/`git`) enforce it; the broker is wired for the namespace and Docker backends (Docker command construction is tested; live Docker requires a daemon). | none |
| `--help` | `-h` | Print usage and exit 0. | n/a |
| `--version` | `-v` | Print `rolecall <version>`. | n/a |

Two behaviors are worth calling out. The default `syslog` plugin streams one JSON line per task **as it runs** (realtime) to stdout; its end-of-run render is intentionally empty so events are not duplicated. `jsonl` does the same but tags each line with `type: "event"` and emits a final `{type:"result", result}` line for the serve child-run protocol. The `json` output plugin deep-sorts object keys before serializing, so integration tests get deterministic lines across runs. And `--forks` is validated eagerly: a non-numeric value produces `error: --forks must be a number (...)` rather than crashing mid-run.

`--tags` and `--skip-tags` are validated eagerly too: a present-but-empty value (e.g. `--tags ""`) exits 2 with a usage error rather than silently filtering nothing. Both flags only affect `playbook run` and are applied to the fully-resolved task list (after role composition and `include_tasks` expansion). A task's own `tags:` replace its play's `tags:` (no union), handlers are exempt from `--tags` inclusion and are excluded by `--skip-tags` only when they explicitly declare a skipped tag, and a tag-skipped task is reported as skipped with reason `tag-filtered`. See [Tasks](../concepts/tasks.md#tags) for the full rules.

Serve-mode flags (`--serve`, `--port`, `--host`, `--dist`, `--ui-dist`) appear at the bottom of the help text but are handled separately, before the shared parser, so they only take effect inside `rolecall --serve`. Those live in [/reference/serve-command](/reference/serve-command), alongside the endpoints those flags bring online.
