---
title: Vars Commands
---

Vars commands surface declared variable/fact metadata and trace precedence overrides — the Splunk-`btool` `--debug` equivalent for RoleCall variables.

Two surfaces exist: `vars list` and `vars trace`, reached as `rolecall vars list <playbook>` and `rolecall vars trace <playbook> [--inventory <inv>] [--extra-vars <kv>] [--limit <host>]`; anything past that exits with `unknown vars subcommand '...' (expected: list | trace)`.

Both are additive. The executor's hot path (`src/executor/engine.ts` `applyPlayVars`) is untouched; the commands re-merge the same precedence tiers with origin metadata retained so overrides are traceable. Run against a playbook that pulls a role manifest plus an inventory:

```text
$ rolecall vars list site.yaml
Vars declared (2 total):
  roles/myrole/defaults/var-manifest.yml:
    - bar (var, optional) :: string = "bar-default"
    - foo (var, optional) :: string = "role-default-value"
Fact capability per connection kind:
  http (1): service_status
  local (7): arch, hostname, ip_addresses, kernel, os, os_family, service_status
  network (0): (none)
  ssh (7): arch, hostname, ip_addresses, kernel, os, os_family, service_status

$ rolecall vars trace site.yaml --inventory inv.yaml
Play: demo:
  web1:
    - bar = "bar-default"  [role-default @ roles/myrole/defaults/var-manifest.yml]
    - baz = "group-baz"  [inv-group @ group_vars/web.yaml]
    - foo = "play-value"  [play @ site.yaml]
        override chain: role-default:roles/myrole/defaults/var-manifest.yml < inv-group:group_vars/web.yaml < inv-host:host_vars/web1.yaml < play:site.yaml
```

`vars list` groups every declared entry by its `declaredIn` file and reports which fact keys each connection kind can gather (built-in gatherers plus registered fact plugins). `vars trace` shows the winning value, the tier/file that set it, and the full override chain `role-default < inv-group < inv-host < play < extra` — so it is obvious why a higher layer hid a lower one. `--extra-vars` is the highest tier and always wins; `--limit` restricts which hosts are traced. Add `-o json` for structured `VarsListResult` / `VarsTraceResult` output that LLM clients can consume directly.

See [Variables](/concepts/variables) for the manifest format and precedence model, [Facts](/concepts/facts) for observed facts, and [Command Reference](/reference/command-reference) for the full subcommand index.
