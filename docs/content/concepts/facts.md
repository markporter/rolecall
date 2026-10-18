---
title: Facts
---

Facts are values RoleCall observes from a target at gather time (OS, hostname, IPs, service
state), as opposed to variables you author. `facts gather` and `playbook run` collect
them live over a real `Connection` per host and expose them to templates via the
`facts` namespace, referenced as `$var: facts.key`.

## Connection-kind-driven gathering

A target's `Connection.kind` decides which gatherers run — mirroring how Ansible selects
the gathering mechanism by connection type. Each built-in gatherer declares the
`connectionKinds` it supports; the engine runs only the gatherers valid for the current
transport. A gatherer without `connectionKinds` runs for every kind.

| Gatherer | Provides | Connection kinds |
| --- | --- | --- |
| `os` | `os`, `kernel`, `arch`, `os_family` | `ssh`, `local` |
| `network` | `hostname`, `ip_addresses` | `ssh`, `local` |
| `service-posix` | `service_status` | `ssh`, `local` |
| `service-http` | `service_status` | `http` |

`service_status` is therefore produced differently per transport: a shelled host is
probed with `systemctl is-active`, while an HTTP target is probed via
`Connection.health()`. Gathering is targeted (only the keys a task actually requests are
collected) and cached per host+keys, so an unreachable host degrades gracefully to a
partial result rather than aborting the run.

## Facts defined by plugins and modules

Facts are not limited to the built-ins. A fact plugin can declare gatherers, and a
module can own facts through a fact gatherer; modules are auto-wired as fact providers
when registered. Declared fact schemas feed the same registry that `var_strict` uses to
validate `$var: facts.*` references, so a declared fact is, by construction, one a gatherer
can produce. This is the implemented core of the fact system; the richer Plugin SDK
authoring surface remains partial (`plugin list`/`register` are implemented).

See [/concepts/variables](/concepts/variables) for how declared variables and the
`$var` operator and the `facts` namespace interact, and `design/architecture/facts.md` for the
full design rationale.
