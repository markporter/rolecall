---
title: Isolation & Sandboxing
---

# Isolation & Sandboxing

RoleCall sandboxes **local execution** by default. The goal is not a general-purpose
container platform: it is a small, fail-closed boundary around the local shell work that
modules perform, plus a separate sandbox for Jinja template rendering.

This page covers what is inside the boundary, what is outside it, and the escape hatches.

## Defaults

- Local transports default to `--isolation auto`.
- `auto` selects rootless **bubblewrap/userns** on Linux, then **Docker**, then fails
  closed. It never silently falls back to unsandboxed execution.
- `--isolation none` is the explicit, warned last resort.
- `ROLECALL_ISOLATION` overrides the default for both `playbook run` and `facts gather`.
- `rolecall doctor` reports the probes, selected backend, image pinning, and the resolved
  ADR 0023 install layout.

```sh
rolecall doctor
rolecall doctor -o json
```

## What the sandbox covers

For a local target, module shell commands run under the selected backend:

- only the **project directory** is mounted read-write by default;
- the host filesystem and home directory are not mounted;
- shell/command/script/raw execution is network-off;
- trusted modules that declare `network: true` (`get_url`, `git`, `package`, `pip`, `snap`)
  get network under the default `module` policy;
- egress can be restricted to explicit destinations with `--allow-egress`;
- explicit filesystem grants use `--mount`.

```sh
rolecall playbook run site.yaml --inventory inv.yaml \
  --isolation auto \
  --mount /srv/certs:/srv/certs:ro \
  --allow-egress api.example.com:443
```

### Network modes

| Mode | Meaning |
|---|---|
| `module` (default) | Trusted modules that declare network capability get network; shell/command/script/raw stay net-off. |
| `none` | Deny network to every local module. |
| `all` | Ambient network for all local execution. This is a warned escape, not the default. |

Module URL checks (`http`, `get_url`, `git`) also enforce `--allow-egress`. The shell egress
broker is wired for the namespace and Docker backends; Docker command construction is
tested, while live Docker requires a daemon. `--allow-egress` rejects loopback/private
addresses unless an explicit IP/CIDR rule allows them.

## Jinja templates

`engine: jinja` uses **Nunjucks + an Ansible compatibility layer** (macros, imports,
`loop.index`, common Ansible filters and tests). With isolation enabled, `copy` renders the
template in the hidden `__render-template` worker:

- no project filesystem mounts;
- no network;
- no inherited environment;
- only the runtime/CLI files are bound read-only;
- output is returned as data.

Templates are for **shaping data**, not acquiring it. If a template needs a file or an API
response, fetch it with a module first and pass the value into the template:

```yaml
- name: Fetch configuration
  module: http
  args:
    url: https://api.example.com/config
    return_content: true
  register: api

- name: Expose it as a fact
  module: set_fact
  args:
    api_body:
      $var: reg.api.content

- name: Render
  module: copy
  args:
    dest: /etc/app/config.conf
    content:
      template: |
        {% set cfg = api_body | from_json %}
        port = {{ cfg.port }}
      engine: jinja
```

For a file outside the project, use `slurp`/`stat`/`find`/`command` with an explicit
`--mount`, then `set_fact`; the module gets the grant, the template gets only the value.

`--isolation none` disables the worker boundary and renders in-process, but Nunjucks
templates still have no filesystem or network APIs. Eta/EJS templates are executable
JavaScript and remain in-process in this slice; do not use them for untrusted templates.

## What is not covered

- **Remote targets.** SSH and remote-network execution are not wrapped by local isolation;
  see ADR 0026 for the opt-in remote-confinement design.
- **In-process module code.** Modules themselves run in the control process; isolation
  wraps the local shell spawns they perform, not the module implementation.
- **Control-plane fetch.** `http` uses the control process's fetch, with egress checks, not
  an OS sandbox.
- **Exposed serve.** Process containment and the gateway/worker split are ADR 0027, not
  local isolation.
- **Template-side I/O.** The worker does not receive `--mount` grants and is hardcoded
  network-off. Passing data in from a module is the supported pattern.
- **Eta/EJS sandboxing.** Those code templates are approved/sandboxed in ADR 0025's target
  model; the approval path is not implemented yet.

## Failure behavior

- Requested backend unavailable: the run fails with guidance; it does not run unsandboxed.
- Docker requested without a daemon: fail closed.
- `--isolation none`: the run proceeds unsandboxed and is warned/traced as the explicit
  last resort.
- `--mount` / `--allow-egress` with `--isolation none`: rejected as a usage error.

## Testing

Linux test runs default to `ROLECALL_ISOLATION=auto`; macOS/Windows use `none` because
bwrap is Linux-only and Docker is not guaranteed. CI installs bubblewrap on Linux and has a
separate Docker job with `ROLECALL_REQUIRE_DOCKER=1`. The checked-in
`examples/local-smoke` playbook runs under the default backend, and
`examples/lxd-lab/README.md` documents the LXD socket grant it needs.

## See also

- [Templates](/concepts/templates)
- [Global Options](/reference/global-options)
- [Transport](/concepts/transport)
- `design/decisions/0025-local-execution-isolation.md`
- `design/decisions/0026-remote-execution-confinement.md`
- `design/decisions/0027-exposed-orchestrator-api-security.md`
