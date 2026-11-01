---
title: Transport
---

Transport is how RoleCall reaches target systems over SSH, local exec, HTTP APIs, and similar connection traits.

RoleCall models a target connection behind a small shared interface, with a `kind` selecting the implementer: `ssh`, `local`, `network` (remote network SSH), and `http`. A factory constructs the right kind from those options and rejects unknown kinds.

The SSH, local, network, and HTTP transports are implemented and not runtime-gated: they apply real state under either runtime. Product SSH goes through ssh2 directly on both runtimes; the PAL's own SSH surface is not what playbooks use.

`playbook run` opens one of these connections per host and drives tasks live over SSH, local process exec, and remote-network SSH rather than merely printing a plan. A task can override the host transport for that task only with `connection: ssh | local | network`; the default comes from the host's `rolecall_connection` var (falling back to `ssh`). Commands ship across a real connection, so structured templating (`$var`/`$concat`/`$call`) and typed `when`/`loop` control flow apply too, while bare Jinja-style `{{ }}` in ordinary values is rejected by the lint; explicit `copy` content templates render with `engine: jinja`. The orchestrator's cron scheduler, webhooks, and forked full-executor playbook runs (each run forks `playbook run -o jsonl` against a materialized playbook/inventory) are implemented. See [Tasks](/concepts/tasks) for how execution consumes these transports.
