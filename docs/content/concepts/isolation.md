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
- only the runtime/CLI files and system runtime paths are bound read-only (no `/etc`);
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

`--isolation none` disables the worker boundary and renders in-process. Nunjucks still has
no filesystem/network APIs, but Eta/EJS are executable JavaScript and must be treated as
untrusted code; use the sandbox. Eta/EJS also render in the worker when isolation is
enabled, with the same no-project/no-network boundary (system runtime files remain
read-only).

## Restricted code and approval

“Restricted code” means executable code templates and helper modules — Eta/EJS
`<% %>`/`<%= %>`, `$template`, and `$call` helpers — that may run **only inside the
sandbox worker**. “Restricted” describes the execution envelope, not a claim that the
template is safe: no project filesystem, no network, no inherited environment, no
`process`/`require`/`globalThis`/`Bun`, minimal data-only context, and time/memory/output
caps.

Nunjucks/Jinja is a **bounded template language**, not restricted code in this policy
sense. It has a fixed statement grammar (`if`/`for`/`macro`/`set`) and registered
filters/tests; it is always sandboxed and does not need per-project approval.

The planned operator policy is per-project and lives outside the project:

```yaml
# /etc/rolecall/isolation.yaml (system) or $XDG_CONFIG_HOME/rolecall/isolation.yaml (user)
version: 1
projects:
  "file:///home/me/infra":
    templates:
      allow_restricted_code: false
      allow_restricted_helpers: false
```

- Project keys are **canonical VFS URIs** (`file:///home/me/infra`), not bare paths, so future git/S3 sources can use their own scheme. A mutable remote ref must not inherit approval for a different resolved commit.
- A project may request restricted code, but cannot approve itself by editing its repo.
- `allow_restricted_code` gates Eta/EJS, `engine: eta|ejs`, and `$template`.
- `allow_restricted_helpers` gates project `$call` helpers.
- `engine: jinja` is not gated.
- Approval is not a sandbox; approved code still renders in the worker.
- With no backend, approved code fails closed unless the operator uses the explicit,
  warned `--isolation none --allow-unsafe-template-code` last resort.

**Current status:** the approval config and `--allow-unsafe-template-code` flag are not
implemented. Today `copy` with `engine: eta|ejs|jinja` renders in the worker when isolation
is enabled, while `$template` and `$call` still render in-process and are not gated. Treat
`--isolation none` as unsafe for untrusted Eta/EJS or `$call` helpers.

**For agents:** discover this policy from the CLI with:

```sh
rolecall docs search "restricted code"
rolecall docs search "allow_restricted_code"
rolecall docs search "isolation"
rolecall agent manifest | jq '.policy.templates'
```

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
- **Eta/EJS approval policy.** They now render in the worker when isolation is enabled, but
  the per-project approval/config path (`templates.allow_restricted_code` /
  `templates.allow_restricted_helpers`) is not implemented yet.

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
