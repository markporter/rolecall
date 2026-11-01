# 0027 — Exposing the orchestrator API: treat `--serve` as an execution surface

- Status: **Proposed**
- Date: 2026-11-01
- Related: [ADR 0017](0017-execution-isolation-and-run-scope.md) (fork-per-run), [ADR 0020](0020-mcp-server-and-tool-surface.md) (MCP tools, including authoring), [ADR 0021](0021-remote-git-project-source.md) (remote project source: SSRF/code-execution surface), [ADR 0022](0022-secrets-vault-and-provider-chain.md) (secret handling), [ADR 0023](0023-installation-layout-and-service-model.md) (service/user/config), [ADR 0025](0025-local-execution-isolation.md) (local exec sandbox), [ADR 0026](0026-remote-execution-confinement.md) (targets), [ADR 0028](0028-security-threat-model-and-gap-register.md) (cross-cutting threat model, control map, and gap register)

## Context

`rolecall --serve` exposes an HTTP API that is **not** read-only. Routes enqueue runs that
load YAML, import plugins, and execute modules; some accept playbook/inventory content,
paths, or project definitions. An authenticated caller is already an operator with
code-execution capability, so the realistic threat is a bug **before or around that
authorization boundary** — a parser bug, auth bypass, path traversal, or SSRF — turning HTTP
input into host RCE.

Today the server is not ready for hostile exposure: the Bearer token is an optional
programmatic `ServerOptions.authToken`, CLI `--serve` does not parse a token, docs/OpenAPI
are unauthenticated, `/run` accepts arbitrary job fields, and there is no RBAC, rate limit,
or path confinement. The default bind is loopback, which is the only reason this has been
acceptable so far.

The cross-cutting threat model, the Ansible/AWX prior art, the security control map, and
the live gap register live in [ADR 0028](0028-security-threat-model-and-gap-register.md).
This ADR owns the exposed-serve controls and the gaps assigned to it there.

## Decision

### 1. Loopback by default; explicit `--exposed` profile

- `--serve` binds `127.0.0.1` unless told otherwise. Binding a non-loopback address requires
  **both** `--exposed` and a configured Bearer token; otherwise the process refuses to start
  with an actionable error.
- `--exposed` is a restricted profile, not just a bind change:
  - only pre-registered project ids and playbook refs; no inline playbook content, no
    arbitrary `playbookPath`/`inventoryPath`, and no filesystem paths from the request;
  - no authoring/write routes (project/playbook create/update, plugin register) and no MCP
    authoring tools;
  - no arbitrary remote-git URLs (ADR 0021) — only allow-listed sources;
  - Swagger UI/route docs disabled or auth-gated;
  - strict request-size, schema validation, run-rate, concurrency, and duration limits.
- Auth is mandatory on every route except `/health`, compared in constant time, read from
  the permissioned config file or environment, rotatable, and never logged. A single shared
  token is a floor, not a tenant boundary; mTLS/OIDC/IP allow-listing at a reverse proxy are
  recommended. Webhooks use HMAC signatures, not just a Bearer header.
- TLS terminates at a reverse proxy; `--serve` never binds TLS itself. No CORS wildcard.

### 2. Contain the process, not just the parser

- Run as the unprivileged service user with the ADR 0023 hardening: empty
  `CapabilityBoundingSet`, `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`, read-only
  root FS where possible, `MemoryMax`/`TasksMax`, explicit `ReadWritePaths=`.
- Strong recommendation: run the serve instance itself in a container/VM with only config
  (ro), state (rw), and pre-approved projects (ro) mounted. Do **not** mount the host home,
  SSH agent, or Docker socket into an externally reachable instance. An RCE is then
  contained to the instance.
- Target architecture for hostile exposure: split the **gateway** (HTTP, auth, schema; no
  executor, no project credentials) from the **worker** (executor, plugins, credentials)
  over a local Unix socket under different users. A gateway bug then cannot directly read
  secrets or exec; it can only submit constrained jobs. Until that split lands, the
  container/VM boundary is the mitigation.
- The local isolation backends do **not** cover this: they sandbox command execution while
  module code runs in-process. Process containment for `--serve` is deployment-level or the
  gateway/worker split.

### 3. Serve-mode execution integration

`--serve` forks a one-shot `playbook run -o jsonl` per job (ADR 0017), so children inherit
the config/defaults from ADR 0025. Practical requirements:

- Start the egress broker per child (simple, policy-isolated) or in the parent and pass its
  socket path to children. Denials must appear in the run trace and jsonl event detail
  because cron/webhook/MCP runs have no terminal.
- The service account needs bwrap/userns or rootless Docker access; the systemd unit must
  expose project dirs via `ReadOnlyPaths=` and must not block namespaces. `doctor` checks both.
- Remote-only jobs materialize no local backend, so isolation-on is practical for a server
  that only drives remote hosts.
- Scrub `ROLECALL_SERVE_TOKEN` and unrelated secrets from forked child environments;
  children need config/state access, not the API credential.
- **Run-scoped event authorization.** A run id is owned by the dispatching token/project;
  status, log, SSE/websocket, and JSONL subscriptions require that ownership. No
  authenticated client may read another project's run output (the AWX websocket-leak
  analog). Per-project state/cache paths are namespaced for the same reason.

### 4. Control-plane SSRF and path safety

- Apply the egress whitelist to module destinations even without isolation: `http`,
  `get_url`, and `git` URLs are validated before dispatch; deny loopback, link-local
  (`169.254.0.0/16`, cloud metadata endpoints), and private ranges unless explicitly
  whitelisted. This is the server-side SSRF defense and also stops remote dispatch from
  targeting internal services.
- Canonicalize and confine every project/playbook/inventory path under a registered project
  root (ADR 0021); reject `..`, symlink escapes, and absolute paths supplied by a request.
- Remote-git sources: allow-list hosts/schemes; an API caller never supplies an arbitrary
  clone URL.
- Request bodies are size-limited and schema-validated before any file or process work;
  parse failures are typed and logged without echoing secrets.
- **Argument construction.** Build argv arrays, never shell-concatenated strings; pass `--`
  before user-supplied positional values; reject leading `-` where a value is expected.
  Apply this to the fork runner, update/service commands, `git clone`, and module helpers —
  the AWX `limit` and Galaxy `--` bugs are the same class.

### 5. Audit and limits

- Log every auth failure, denied egress/path, and run dispatch (project, playbook, action,
  caller identity where available) with secrets redacted; carry denials into the trace.
- **Tamper-evident audit.** Ship audit events to an append-only/off-box sink (syslog, OTel,
  or a remote collector) with sequence/hash chaining, and include update/service actions.
  A compromised service account must not be able to rewrite the only record.
- Rate-limit and cap concurrent runs, request size, run duration, and clone/build size to
  bound DoS and accidental fork bombs.
- Startup/`doctor` warns loudly when `--serve` is non-loopback without `--exposed` and auth,
  when TLS termination is not expected at a proxy, or when the process runs as root.

### 6. Honest boundary

No amount of hardening makes it safe to let untrusted users submit arbitrary playbooks to
one instance: that is remote code execution by design. `--exposed` is for trusted operators
over a protected channel. Multi-tenant untrusted code needs separate instances (or a
worker-per-tenant container) with their own credentials and network policy.

## Alternatives considered

- **Rely on the Bearer token alone.** Rejected: one shared token plus arbitrary playbook
  input is a single bug away from host RCE; restricted routes and process containment are
  the defense in depth.
- **Allow non-loopback with a token but keep all routes.** Rejected: authoring, arbitrary
  paths, and arbitrary git URLs keep a large pre-auth/parser surface and invite SSRF.
- **Put everything behind a reverse proxy and call it secure.** Rejected: a proxy adds TLS
  and identity but does not confine paths, SSRF, or process privilege.
- **Remove run endpoints from `--serve` entirely.** Rejected: dispatch is the product; the
  restricted profile keeps it while shrinking input and blast radius.
- **Run all module code in the local sandbox.** Rejected here: modules are in-process and
  trusted after approval; a whole-process worker/gateway split is the structural fix.
- **Multi-tenant shared server with per-request RBAC.** Deferred: RBAC does not make
  arbitrary code execution safe; separate instances/containers are the honest boundary.

## Consequences

**Positive**
- Exposing the API becomes an explicit, auditable decision with a restricted profile instead
  of a bind flag and an optional token.
- Defense in depth: auth + restricted inputs + SSRF/path policy + process containment.
- Serve-mode runs inherit local isolation and surface denials in traces for unattended use.
- The gateway/worker split gives a clear target architecture for hostile deployments.

**Negative / risk**
- `--exposed` changes behavior and will break integrations that rely on inline playbooks,
  authoring routes, docs, or arbitrary paths; migration must be documented.
- A shared token remains coarse; mTLS/OIDC and per-client tokens are future work.
- Containerized serve deployment adds operational complexity (mounts, socket access, image
  updates), and the gateway/worker split is a significant refactor.
- Control-plane SSRF policy can break legitimate internal endpoints; whitelisting becomes
  security-critical config.
- None of this protects a shared instance from an authorized malicious operator.

## Work items
- [ ] Implement `--serve --exposed`: startup refusal matrix (non-loopback requires exposed +
  token), auth on every non-health route (constant-time), restricted route set (registered
  projects/playbooks only, no authoring/docs, no arbitrary paths/URLs)
- [ ] Add request/rate/concurrency/duration limits, schema-before-work validation, audit
  logging with redaction, and child-env token scrubbing
- [ ] Harden control-plane SSRF/path handling: canonicalize project/playbook/inventory paths
  under registered roots, allow-list remote-git hosts, deny loopback/link-local/private
  module destinations unless whitelisted
- [ ] Serve integration: per-child or shared egress broker, denial hints in jsonl events,
  lazy remote-only backend, `doctor` checks for namespace/Docker access under the service
- [ ] Document and support the container/VM deployment (minimal mounts, no host home/agent/
  Docker socket) and specify the gateway/worker privilege split as the target architecture
- [ ] Close the gaps assigned to this ADR in [ADR 0028 §5](0028-security-threat-model-and-gap-register.md): per-run event/state/cache isolation, tamper-evident audit shipping, argument/option-injection hardening (argv arrays, `--` separators, leading-`-` rejection), event-boundary secret masking, host-key/TLS verification, and MCP per-tool scopes
- [ ] Tests: auth bypass, path traversal, SSRF (metadata/loopback), restricted-route
  enforcement, non-loopback refusal, child-env scrub, and denial-to-trace propagation

## References
- `src/orchestrator/serve.ts:98-113` (flag parsing; no token flag), `src/orchestrator/routes.ts` (`ROUTE_DEFINITIONS`, `authToken` guard), `src/orchestrator/mcp.ts` (`TOOL_DEFS`), `src/orchestrator/engine.ts`/`child-run.ts` (fork-per-run, `env: process.env`)
- `src/orchestrator/docs.ts`, `src/orchestrator/openapi.ts` (unauthenticated docs/OpenAPI)
- `src/store/projects.ts`, `src/config/schema.ts` (project refs, schema validation), `src/vfs/project-source.ts` (path confinement), ADR 0021 (remote project source)
- ADR 0017, ADR 0020, ADR 0021, ADR 0022, ADR 0023, ADR 0025, ADR 0026
