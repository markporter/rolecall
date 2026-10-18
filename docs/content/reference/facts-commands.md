---
title: Facts Commands
---

Facts commands gather information about target systems before applying changes.

Only one surface exists right now, `facts gather`, reached as `rolecall facts gather <inv> [--limit]`; anything past that exits with `unknown facts subcommand '...' (expected: gather)`.

This command now actually gathers facts. It resolves the inventory's target patterns, builds a per-host connection via the shared factory (`src/cli/connections.ts`, honoring `rolecall_connection`), and collects targeted/cached facts for each host through the built-in engine; an unreachable host fails gracefully into a per-host failure report without aborting the rest. Running it against `tests/fixtures/inventory.valid.yaml` yields:

```text
Facts gather from: tests/fixtures/inventory.valid.yaml
Hosts : 3 resolved (db1.example.com, web1.example.com, web2.example.com)
Note  : facts gathered per resolved host; unreachable host(s) fail gracefully into a per-host failure report
```

With `--limit` set, RoleCall narrows resolution to that single pattern instead of resolving everything. Fact gathering now runs against each resolved target through its built connection, collecting targeted/cached facts one host at a time, so this is a live collection step rather than merely a planning aid. See [Inventory Commands](/reference/inventory-commands) for exactly how matching works, and [Facts](/concepts/facts) for the fact model.
