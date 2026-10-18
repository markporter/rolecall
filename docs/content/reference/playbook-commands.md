---
title: Playbook Commands
---

Playbook commands operate on playbooks - the declarative units RoleCall executes.

Today there is exactly one working action, `run`, reached as `rolecall playbook run <file> [--inventory <inv>] [--limit] [--force] [--check] [--diff] [--forks N] [--extra-vars <kv>]`. Any other subcommand fails fast with `unknown playbook subcommand '...' (expected: run)`.

`playbook run` first loads and validates the file against the strict schema in `src/config/schema.ts`, then resolves an optional inventory; with no resolvable hosts there is simply nothing to apply.

```sh
rolecall playbook run playbook.yaml
```

emits structured markers including resolved `Hosts`, the task list, an end-of-run `Summary`\n(`ok`/`changed`/`failed`/`skipped`), and a trailing note. Supplying `--inventory` narrows resolution\nto those targets; running against `tests/fixtures/inventory.valid.yaml` yields six host-task pairs.\nBe aware these counters reflect real convergence after applying tasks over SSH or local transports,\nnot a structural dry-run preview.

The `human_summary` formatter reads left to right through playbook, inventory, mode, hosts, tasks, skeleton, and (when present) outcomes plus a trailing note. Add `--output json` to get the same data back as deeply key-sorted JSON instead of the table, or rely on the default `syslog` realtime per-task stream. The comparison/compute flags `--force`, `--check`, and `--diff` are honored during real application over SSH/local transports, while `--forks` sets concurrency fan-out across resolved hosts. See [Playbooks](/concepts/playbooks) for the YAML shape, [Tasks](/concepts/tasks) and [Plays](/concepts/plays) for the building blocks, and [Command Reference](/reference/command-reference) for how this fits among the other subcommands.
