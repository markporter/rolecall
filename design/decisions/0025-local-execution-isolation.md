# 0025 — Local execution isolation: backends, filesystem grants, and egress policy

- Status: **Proposed**
- Date: 2026-11-01
- Related: [ADR 0005](0005-io-abstractions-vfs-db-scratch.md) (execution/IO seams), [ADR 0014](0014-project-and-plugin-architecture.md) (§8: project plugins are executable code), [ADR 0017](0017-execution-isolation-and-run-scope.md) (run scope / fork-per-run), [ADR 0021](0021-remote-git-project-source.md) (project cache location), [ADR 0023](0023-installation-layout-and-service-model.md) (install/service; this ADR supplies the containment policy it references), [ADR 0026](0026-remote-execution-confinement.md) (remote targets are separate), [ADR 0027](0027-exposed-orchestrator-api-security.md) (exposed serve process containment)

## Context

A playbook run executes code locally: builtin `command`/`shell`/`script`/`raw`, project
plugins (ADR 0014 §8), and JIT-bundled dependencies. Today there is no containment: a local
task runs with the invoking user's full filesystem, network, and credentials. The risk is
asymmetric — a malformed or malicious shell task can read `~/.ssh`, reach cloud metadata, or
change anything the service account can change.

Two facts constrain the design:

- **Modules run in-process.** `mod.run(...)` is called directly in
  `src/executor/runner.ts:441`; the untrusted local exec path is `LocalConnection` spawning
  `/bin/sh -c` (`src/transport/local.ts:47-58`). Isolation therefore wraps **command
  execution**, not the whole RoleCall process. ssh2, Express, the store, the scheduler, and
  approved module code stay outside the sandbox.
- **Remote targets are a different problem.** SSH/WinRM/HTTP work executes on the target;
  no local namespace or container changes that. Remote confinement is [ADR 0026](0026-remote-execution-confinement.md).

## Decision

### 1. Isolation is on by default, with two backends

Keep a small `IsolationBackend` seam; ship **two mechanisms**:

- `auto` — **the default.** Linux resolves `namespace` → `docker`; elsewhere `docker`. If
  neither is usable, local execution fails with guidance rather than running exposed.
  Remote-only runs materialize no backend because nothing executes locally.
- `namespace` — **Linux, rootless**: `bwrap`, with `unshare` as the same-contract launcher
  when `bwrap` is absent. One mechanism, two thin launchers.
- `docker` — the portable fallback, also the only backend on macOS/Windows.
- `none` — explicit **last resort**, never the default. It prints a prominent warning,
  records `isolation: none` in the run trace, and `doctor` flags the install.

Explicit `namespace`/`docker` fails rather than silently choosing the other. No
literal-chroot backend and no macOS sandbox/Windows AppContainer backends: two mechanisms
is the deliberate ceiling; every added mechanism must justify its own test matrix.

### 2. The boundary is `LocalConnection`, not the process

- `command`/`shell`/`script`/`raw` and the programs they spawn are the untrusted boundary
  and run under the selected backend.
- `ExecOptions` gains an execution profile (`untrusted` default, `networked` for
  `get_url`/`git`/package modules) so a trusted module's local `connection.exec` selects
  the net-on profile. `http` runs in-process and is unaffected.
- Project plugins are trusted code after approval; the sandbox is **not** a jail for
  in-process module code. To jail the whole process, run RoleCall itself in a
  container/VM (deployment choice), or expose only a constrained gateway ([ADR 0027](0027-exposed-orchestrator-api-security.md)).
- **Local `become` and resource limits.** `become`/sudo inside the sandbox is denied by
  default; a task that needs privileged local changes must use a module that performs them
  through a granted mechanism or an explicit privileged execution mode (documented and
  traced). Shell processes get PID/CPU/memory/output limits (cgroups where available,
  rlimits/`ulimit` otherwise) so a fork bomb or output bomb cannot take down the host.

### 3. `namespace` backend (cheap Linux path, no daemon)

- One `NamespaceRunner`; prefer `bwrap`, fall back to `unshare` when `bwrap` is absent.
  Both launch the same contract, so there is one test suite.
- Minimal read-only root (`/usr`, `/lib`, `/lib64`, `/bin`, a minimal `/etc`), project
  directory bind-mounted, private tmpfs `/tmp`, no `/home` or `/root`,
  `--unshare-pid --unshare-ipc --unshare-uts --die-with-parent --new-session`, and
  `--cap-drop ALL`. Credentials mount read-only only when granted.
- Rootless via unprivileged user namespaces. `doctor`/first use probes support (including
  AppArmor-restricted userns and setuid-`bwrap` installs); when unavailable, `auto` moves
  to Docker and explicit `namespace` errors with the probe reason.

### 4. `docker` backend (fallback / non-Linux)

- Docker Engine (including rootless) on Linux, Docker Desktop on macOS/Windows. Podman may
  work through the Docker-compatible CLI, but is best-effort, not a separate backend.
- Run as `docker run --rm --user <uid>:<gid> --read-only --cap-drop ALL
  --security-opt no-new-privileges --tmpfs /tmp`, with the project at the working dir and
  only state/scratch added. No host home, no Docker socket inside.
- One pinned image by digest, pulled at install/preflight, never per run. Offline installs
  pre-load it; `doctor` verifies it.
- **Privilege caveat:** a rootful Docker daemon is root-equivalent on the host. Use rootless
  Docker where possible; adding the service user to the `docker` group is an explicit
  trade-off `doctor` reports. This is why Docker is the fallback, not the Linux default.

### 5. Filesystem: explicit, approved grants

Isolation denies by default. A run that needs a host path, socket, or credential gets an
explicit grant rather than a broad mount:

- **Precedence:** one-off `--mount src:dst[:ro|rw]` → approved grants in the per-project
  `isolation.yaml` under the config dir → **never** a project self-grant. A project may
  *request* access; requests are advisory and require operator approval.
- A project declares requests in `.rolecall/isolation.yaml`; `rolecall isolation list
  --explain` shows them unapproved. `rolecall isolation allow --from-request` promotes one.
  This is deliberate: cloning a repo must not expose `~/.ssh` or `/srv`.
- Manage grants with `rolecall isolation allow|revoke|list`:

```yaml
version: 1
projects:
  /home/me/infra:
    grants:
      - source: /srv/shared/certs
        target: /mnt/certs
        mode: ro
      - source: ~/.ssh
        target: /home/rolecall/.ssh
        mode: ro
        optional: false
```

- **Fields:** canonical absolute `source`, absolute `target` (default `/mnt/<basename>`),
  `mode` (`ro` default; `rw` explicit and warned), `optional` (missing source warns rather
  than fails). `~` expands for the service user.
- **Validation:** `realpath` before mounting; a grant is for the resolved path, not a
  symlink edge. Reject `/`, `/proc`, `/sys`, `/dev`, `/root`, and container/agent/Docker
  sockets unless the grant is explicitly `type: socket` (document that `SSH_AUTH_SOCK`
  grants the agent's authority). Reject `target: /` and collisions with the project mount.
  A required, unsatisfiable grant is a typed error before the run.
- **Compilation:** the validated `IsolationGrant` list becomes `--ro-bind`/`--bind`
  (namespace) or `-v src:dst:ro|rw` (Docker). One parser, two backends.
- `--mount` is ephemeral and shown in the run plan; durable access belongs in
  `isolation.yaml` via the CLI so it is auditable.

### 6. Network: module capability first, destination whitelist second

The sandbox has **no direct egress by default**.

- `command`/`shell`/`script`/`raw` start with the network namespace detached
  (`--unshare-net` / `--network none`). Direct `curl`, `wget`, `git clone`, raw sockets, or
  any program they call fail with no route/DNS. Whitelisted destinations are reachable only
  through the egress broker below.
- Networked built-ins declare metadata and run net-on for that invocation: `http`
  (control-process `fetch`), `get_url`, `git`, package managers (target-side via
  `connection.exec`), facts/transport gatherers.
- The capability attaches to the module, not the binary: a trusted module may spawn a
  networked helper (`git`, `apt`); a user shell may not. Plugins default to no egress;
  `network: true` is a request the operator approves.

**Destination whitelist (`isolation.yaml`):**

```yaml
version: 1
projects:
  /home/me/infra:
    egress:
      - host: api.example.com
        ports:
          - 443
        protocol: tcp
      - host: 10.20.0.0/16
        ports:
          - 22
        protocol: tcp
```

- Fields: `host` (DNS/IP/CIDR), `ports`, `protocol` (`tcp` default), `scope`
  (`shell` default, `module`, `all`). DNS is resolved **after** the policy check so queries
  do not leak. A project may request an egress entry but cannot approve it.
- Enforcement is an `EgressBroker` outside the sandbox exposing a Unix socket that is the
  untrusted profile's only route. It accepts HTTP CONNECT, HTTP Host, and SOCKS5 (TCP),
  checks host/port/CIDR, and records allow/deny in the trace without secrets. The sandbox
  gets loopback plus a proxy shim bridged to the socket; direct egress stays off.
  **TOCTOU/DNS-rebinding hardening:** resolve once, validate every A/AAAA record, connect
  to the validated IP (not a second lookup), pin that result for the request, re-check on
  redirect, and disable cross-origin redirects by default.
- `--isolation-network module` (default), `none` (deny even modules), `all` (ambient egress;
  last resort, warned and traced).
- **Fail-closed limitation:** proxy-unaware programs opening raw TCP/UDP fail even when
  whitelisted; use a module for those. A per-destination TCP forwarder is future work.
- Manage with `rolecall isolation allow-egress|revoke-egress|list --egress`; one-off
  `--allow-egress host:port` is shown in the run plan.

### 7. Templates are an execution surface too

Templates are not automatically data-only. Two current paths execute code:

- `src/templating/fast.ts` uses **Eta**, which compiles a template to a JavaScript
  function. It is created with `useWith: true`, and the data proxy falls back to
  `globalThis[key]` for unknown names, so `<% %>` and `<%= %>` can reach `process`,
  `fetch`, `Bun`, and other globals. `$template` renders through this path, as does
  `copy` with the default `engine: eta`.
- `$call` loads **project-local `.ts` helper modules** and invokes them (`loadHelpers` in
  `src/templating/refs.ts`). That is arbitrary code, even though the ref DSL itself has no
  eval.

`engine: jinja` is **Nunjucks**, a Jinja2-compatible engine that compiles templates to
JavaScript. It is code-capable, but it is the compatibility engine and is therefore
**allowed by default only inside the sandbox worker** — no per-template approval. Structured
refs (`$var`/`$concat`/`$eq`/…) have no eval path and remain the data-only fast path.

Decision: classify templates explicitly instead of treating "template" as safe.

- **Data-only (in-process):** structured refs only. There is no safe in-process code engine
  in the Jinja compatibility path. Structured refs still get path/resource limits and
  own-property access.
- **Jinja compatibility (code-capable, sandboxed by default, no per-template approval):**
  `engine: jinja` (Nunjucks) renders only in the hidden `__render-template` worker. It is
  allowed without `templates.allow_restricted_code`; the isolation backend is the control. If no
  backend exists, it fails closed with guidance unless the explicit unsafe override below.
- **Code-capable (untrusted, denied by default):** Eta/EJS `<% %>` or `<%= %>`,
  `$template`, `engine: eta|ejs`, and project `$call` helpers. These are the template
  equivalent of `command`/`shell` and follow the same rule: **use a data template or a
  module first; allow code explicitly if you must.** `templates.allow_restricted_code` /
  `templates.allow_restricted_helpers` gate these; they do not gate `engine: jinja`.
- **What “restricted code” means:** executable code templates and helper modules — Eta/EJS
  `<% %>`/`<%= %>`, `$template`, and `$call` helpers — that are permitted only inside the
  sandbox worker. “Restricted” describes the execution envelope, not a claim that the code
  is safe: no project filesystem, no network, no inherited environment, no `process`/
  `require`/`globalThis`/`Bun`, minimal data-only context, and timeout/memory/output caps.
  Nunjucks/Jinja is a bounded template language (fixed statement grammar + registered
  filters/tests), not “restricted code” in this policy sense; it is always sandboxed and
  does not need per-project approval.
- **Project identity is a VFS URI.** Approval and project-scoped config key on the
  canonical VFS URI, never a bare filesystem path: local projects use
  `file:///home/me/infra`; future transports use their own scheme (for example a pinned
  `git+https://…@<commit>` or `s3://…`). The approval layer canonicalizes symlinks, `..`,
  case, and percent-encoding before lookup, and a mutable remote ref must not inherit
  approval meant for a different resolved commit.
- **Approval:** restricted code and project helpers are operator-approved per project (a
  project may *request* them but cannot self-approve):

```yaml
version: 1
projects:
  "file:///home/me/infra":
    templates:
      allow_restricted_code: false
      allow_restricted_helpers: false
  "git+https://git.example.com/infra.git@9f3c2a1":
    templates:
      allow_restricted_code: true
      allow_restricted_helpers: false
```

- **Sandboxed render:** every `engine: jinja` template and every approved code template
  renders in a hidden `rolecall __render-template` worker under the selected
  `IsolationBackend` (bwrap/Docker), not in the control process. The worker receives only
  `{engine, template, context}` as JSON on stdin and returns text on stdout: no filesystem,
  no network, no inherited environment, minimal globals, timeout/memory/output caps. The
  worker is persistent per run so container startup is amortized. Structured refs stay
  in-process.
- **No backend / `--isolation none`:** `engine: jinja` and approved code templates fail with
  guidance unless the operator also passes an explicit unsafe override
  (`--allow-unsafe-template-code`, or the per-project equivalent). That run is warned and
  traced like `--isolation none`. This is the **same last-resort escape** as ADR 0023's
  isolation preflight; there is no separate template-only bypass. Windows/macOS hosts
  without Docker therefore have two choices: install Docker, or accept the warned/traced
  unsafe path.
- **Path and context confinement:** `template_file`/`src` resolve under the project root
  (canonicalize, reject `..`/symlink escapes); anything outside needs a filesystem grant
  (§5). The render context carries only declared vars/facts/loop data, never the process,
  environment, helpers, or secret registry internals.
- **Defense in depth:** remove the `globalThis` fallback in the Eta data proxy and block
  `process`/`require`/`globalThis`/`Bun` even when code templates are approved. That is not
  a sandbox by itself; the worker is.
- **Remote:** `copy` renders on the control node before transfer, so this policy applies.
  If a future module renders on a target, that is target-governed (ADR 0026).

Errors point at the safe path: "`engine: jinja` requires a working isolation backend.
Install bubblewrap (Linux) or Docker, or use `--isolation none --allow-unsafe-template-code`
as a warned last resort. Eta/EJS/$template are restricted code: approve them with
`templates.allow_restricted_code` in `isolation.yaml` and run with isolation if you must. Helper `$call` modules are a separate
approval."

### 8. Default-on errors steer to modules, then the whitelist, then opt-out

- Denied shell connection → task hint: use `http`/`get_url`/`git`; add
  `rolecall isolation allow-egress <host> --port <port>` if a shell truly must reach it;
  `--isolation none` is a last resort and is traced.
- No usable backend → typed error: install `bubblewrap` (Linux) or run Docker; use a module
  so work happens on the target; `--isolation none` is a last resort. Remote-only runs do
  not trigger this.
- `--isolation none` / `--isolation-network all` warn, are tagged in the trace, and are
  flagged by `doctor`.

### 9. Serve and CLI

- CLI runs and forked serve children share the same config/defaults. The backend is
  materialized lazily, so a server driving only remote hosts needs no local backend.
- The egress broker may be per child (v1) or shared by the serve parent later. Denials must
  reach the run trace and jsonl event detail because scheduled/webhook/MCP runs have no
  terminal. Exposed-serve process containment is [ADR 0027](0027-exposed-orchestrator-api-security.md).
- Linux CI exercises `namespace` (skip without bwrap/userns) and `docker` (skip without a
  daemon); the auto matrix covers namespace-only, Docker-only, both, and neither. One
  `IsolationBackend` contract suite covers grants, network profiles, and denial hints.

### 10. Deferred

Literal `chroot`, macOS `sandbox-exec`/App Sandbox, Windows AppContainer/Job Objects, and
container runtimes beyond the Docker-compatible CLI. Hosts with neither userns nor Docker
get no containment; `none` is explicit, warned, and traced. Remote confinement is a
separate decision (ADR 0026).

## Alternatives considered

- **Use literal `chroot`.** Rejected: needs root/capability, ignores network, unavailable on
  Windows/macOS, and contradicts the unprivileged-service model.
- **Ship only Docker.** Rejected for Linux-first production: a daemon, image pinning, and
  root-equivalent daemon access where a rootless namespace needs none.
- **Ship bwrap, Docker, chroot, and platform sandboxes.** Rejected: every mechanism adds a
  platform matrix and failure modes; two is the ceiling.
- **Keep isolation opt-in (default `none`).** Rejected: safe-by-default and module-first
  guidance is the point; lazy materialization keeps remote-only hosts cheap.
- **Broad-mount the host or let projects self-grant.** Rejected: hands a playbook every
  credential/socket and makes isolation theater; cloned repos must not approve their own access.
- **Ambient network for the sandbox.** Rejected: shell could exfiltrate or fetch arbitrary
  URLs; per-module capability plus a destination broker keeps trusted modules working.
- **Enforce the whitelist with per-run nftables/iptables.** Rejected: rootless namespaces
  have no route to the host, Docker would need a different implementation, and privilege
  requirements grow. One broker works across both backends.
- **Block `connect()` with `LD_PRELOAD`/seccomp.** Rejected: brittle, bypassable, and
  runtime/static-binary dependent; the namespace is the boundary.
- **Treat templates as data because they are "just templating".** Rejected: Eta compiles to
  JavaScript and its data proxy falls back to `globalThis`; `$template` and `$call` are
  direct code surfaces. They belong in the untrusted class.
- **Static-lint dangerous template syntax instead of enforcing a policy.** Rejected:
  regex/AST allow-lists are easy to bypass across engines and do not bound resource use;
  engine selection plus a sandbox is the enforceable boundary.
- **Use Node's `vm` or `isolated-vm` as the template sandbox.** Rejected: `vm` is not a
  security boundary, and `isolated-vm` adds a native dependency and runtime-specific build
  work. The existing process sandbox (bwrap/Docker) already provides the boundary.
- **Sandbox every template, including structured refs.** Rejected: structured refs are
  data-only and render in-process cheaply; forcing a container per render is slow and adds
  no security. `engine: jinja` is different: Nunjucks is code-capable, so it is sandboxed
  by default.

## Consequences

**Positive**
- Safe by default; trusted modules keep working while shell network and host filesystem
  access are explicit.
- Two backends, one contract: Linux gets a cheap daemon-free path, other platforms get Docker.
- Filesystem and egress grants are per-project, auditable, and cannot be self-approved.
- Denials teach the module-first workflow and are visible in traces for unattended runs.
- Templates are no longer an unguarded ACE path: structured refs keep working in-process,
  while `engine: jinja` (Nunjucks) is always sandboxed, and Eta/EJS/`$template`/project
  helpers require explicit approval and run in the same sandbox.

**Negative / risk**
- Default-on isolation breaks existing playbooks that rely on shell networking or host
  paths; errors must be excellent and `--isolation none` must remain available but discouraged.
- The sandbox does not cover in-process module code; a malicious approved plugin is not
  contained (ADR 0027 covers process-level containment for serve).
- `namespace` depends on userns availability (AppArmor, setuid bwrap); Docker adds daemon
  privilege, image supply chain, and startup cost.
- The egress broker is a new security component (proxy parsing, DNS, log redaction), and
  proxy-unaware programs fail even when whitelisted.
- Whitelists rot (IP/CIDR drift, CDN changes); denial logging is the only signal.
- Code-capable templates (Eta/EJS/`$template`) break by default; projects relying on them
  must be approved and pay a sandbox-render cost per invocation. `engine: jinja` does not
  need approval but now requires a working isolation backend, so it no longer works on a
  bare Windows/macOS host without Docker unless the unsafe override is used. Removing the
  `globalThis` fallback also changes behavior for templates that leaned on ambient globals.
- Nunjucks is closer to Jinja2 than LiquidJS but still not exact; JS-vs-Python truthiness,
  scoping, macro-argument forms, and missing Ansible filters/tests/lookups require a
  compatibility layer and handoff items. Every Jinja render now pays the sandbox-worker
  startup/round-trip cost (amortized by a persistent per-run worker), and context
  minimization can break templates that assumed every variable was present.
- Project `$call` helpers are code and need the same approval discipline as plugins; an
  approved helper runs with the code-template policy, which is a trust decision, not a jail.
- The hidden render worker adds another command surface to test (stdin schema, timeouts,
  output caps, sandbox integration) and must never be reachable through `--serve`.

## Work items
- [ ] `IsolationBackend` seam: `none` + `namespace` + `docker` + `auto`; `NamespaceRunner` (bwrap preferred, `unshare` fallback), `ContainerRunner` (pinned image, offline preload), probes, typed errors, `doctor`
- [ ] Wrap only `LocalConnection` exec; add the `ExecOptions` profile; mark `get_url`/`git`/package modules `networked`; prove ssh2/Express/store/approved modules stay outside
- [ ] `isolation.yaml` grant + egress schema, realpath canonicalization, deny-list, `ro`/`rw`, optional/required, socket type, project requests never auto-applied
- [ ] `EgressBroker`: Unix-socket HTTP CONNECT/HTTP/SOCKS5, host/port/CIDR policy, post-check DNS, redacted allow/deny tracing, proxy env/shim for both backends
- [ ] Commands: `isolation allow|revoke|list`, `allow-egress|revoke-egress|list --egress`, run flags `--isolation` / `--isolation-network` / `--mount` / `--allow-egress`
- [ ] Module `network` capability metadata (`Module`/`ModuleSummary`); mark `command`/`shell`/`script`/`raw` untrusted; plugin egress approval
- [ ] Default-on guidance: module-first errors, whitelist hint, `none`/`all` warnings and trace tags
- [ ] Template policy: add `templates.allow_restricted_code` / `templates.allow_restricted_helpers` to `isolation.yaml` (operator-approved, project requests only), with structured refs allowed in-process; `engine: jinja` is sandboxed by default and is not gated by `allow_restricted_code`
- [ ] Hidden `rolecall __render-template` worker: JSON stdin/stdout, runs under the isolation backend, no fs/net/inherited env/globals, timeout/memory/output caps, persistent per run; `engine: jinja` and approved code templates fail if no backend unless the explicit unsafe override is given
- [ ] Harden in-process structured refs and remove the Eta `globalThis` fallback; block `process`/`require`/`Bun`/`globalThis` in code templates
- [ ] Confine `copy` `template_file`/`src` paths to the project root (canonicalize, reject `..`/symlink escapes) or require a filesystem grant
- [ ] Template tests: Eta `process.env` blocked; structured refs unchanged; Nunjucks sandbox-only render; Ansible filter/test/global layer; helper approval; path traversal; sandbox-unavailable guidance plus unsafe override; render caps; no `__render-template` route in `--serve`
- [ ] Egress hardening: DNS pinning/no-rebinding, connect-to-validated-IP, redirect re-checks and cross-origin redirect denial; tests for mixed A/AAAA, rebinding, and redirect-to-internal
- [ ] Local `become` policy (deny by default, explicit privileged mode) and PID/CPU/memory/output limits for sandboxed commands (cgroups/rlimits); fork-bomb and output-bomb tests
- [ ] Shared contract tests for both backends, grants, network profiles, denial hints, and the auto matrix; dual-runtime per ADR 0018

## References
- `src/executor/runner.ts:441` (in-process module run), `src/executor/module.ts` (`Module` contract), `src/modules/search.ts` (`ModuleSummary`), `src/transport/local.ts:47-58` (`LocalConnection` spawn), `src/transport/connection.ts` (`ExecOptions`)
- `src/modules/builtins/{http,get_url,git,command,script,raw}.ts` (network paths: control-process `fetch` vs `connection.exec`)
- `src/config/env.ts` (`ROLECALL_*` selection), `src/orchestrator/{engine,child-run}.ts` (forked serve runs)
- `src/templating/fast.ts` (Eta, `useWith`, `globalThis` fallback), `src/templating/jinja.ts` (Nunjucks + Ansible compat layer), `src/templating/refs.ts` (`$template`, `$jinja`, `$call`, `loadHelpers`), `src/templating/filters.ts`, `src/modules/builtins/copy.ts` (`renderTemplate`, `resolveTemplatePath`)
- ADR 0014 §8, ADR 0017, ADR 0021, ADR 0023 (install/service), ADR 0026 (remote), ADR 0027 (exposed serve)
