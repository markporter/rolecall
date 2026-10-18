---
title: Transport
---

Transport is how RoleCall reaches target systems over SSH, local exec, HTTP APIs, and similar connection traits.

RoleCall models a target connection behind a small shared interface, with a `kind` selecting the implementer: `ssh`, `local`, `network` (remote network SSH), and `http`. A factory constructs the right kind from those options and rejects unknown kinds.

The SSH, local, and network transports are implemented and not runtime-gated: they apply real state under either runtime. Product SSH goes through ssh2 directly on both runtimes; the PAL's own SSH surface (a stub under Node) is not what playbooks use.

`playbook run` opens one of these connections per host and drives tasks live over SSH, local process exec, and remote-network SSH rather than merely printing a plan — commands ship across a real connection. Structured templating (`$var`/`$concat`/`$call`) and typed `when`/`loop` control flow apply too, while Jinja-style `{{ }}` expressions still pass through literally until a full renderer lands. Scheduler triggers, cron, webhooks, and the SPA UI remain scaffolded, and the richer Plugin SDK authoring surface remains partial. See [Tasks](/concepts/tasks) for how execution consumes these transports.
