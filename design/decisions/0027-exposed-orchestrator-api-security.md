# 0027 — Exposing the orchestrator API: treat `--serve` as an execution surface

- Status: **Proposed**
- Date: 2026-11-01
- Related: [ADR 0017](0017-execution-isolation-and-run-scope.md) (fork-per-run), [ADR 0020](0020-mcp-server-and-tool-surface.md) (MCP tools, including authoring), [ADR 0021](0021-remote-git-project-source.md) (remote project source: SSRF/code-execution surface), [ADR 0022](0022-secrets-vault-and-provider-chain.md) (secret handling), [ADR 0023](0023-installation-layout-and-service-model.md) (service/user/config), [ADR 0025](0025-local-execution-isolation.md) (local exec sandbox), [ADR 0026](0026-remote-execution-confinement.md) (targets)

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

## Prior art: what actually goes wrong with Ansible

The incident record is less "Ansible had a 0-day" and more "the control plane was the
prize":

- **Abused after compromise.** In the BlackSuit/Unit 42 case, attackers used Ansible to
  orchestrate ransomware across hundreds of VMs on ~60 ESXi hosts after vishing/VPN access
  and domain takeover ([Unit 42](https://unit42.paloaltonetworks.com/anatomy-of-an-attack-blacksuit-ransomware-blitz/)).
  MITRE ATT&CK [T1072](https://attack.mitre.org/techniques/T1072/) lists Ansible with
  SCCM/Puppet/Chef as a deployment tool abused for execution and lateral movement.
- **AWX/Tower weaknesses.** Job-isolation escape
  ([CVE-2021-20253](https://nvd.nist.gov/vuln/detail/cve-2021-20253),
  [CVE-2021-4112](https://nvd.nist.gov/vuln/detail/CVE-2021-4112)), OAuth2 token validation
  letting a read-only user become admin
  ([CVE-2023-21769](https://nvd.nist.gov/vuln/detail/CVE-2023-21769)), non-expiring refresh
  tokens ([CVE-2020-10709](https://nvd.nist.gov/vuln/detail/CVE-2020-10709)), and missing
  websocket RBAC ([CVE-2026-16544](https://app.opencve.io/cve/CVE-2026-16544)). The
  offensive-AWX playbook shows the post-auth path — extra-vars injection, credential
  theft, `delegate_to` execution on the controller:
  [offensive-awx](https://github.com/lm-sec/offensive-awx).
- **Supply chain.** `ansible-galaxy` role/collection argument injection enabling code
  execution on the controller
  ([CVE-2026-11332](https://github.com/advisories/GHSA-w8p5-mx5w-cpqj),
  [CVE-2026-16493](https://github.com/advisories/GHSA-m37p-hmh2-w6j2)), and research
  showing malicious Galaxy payloads are feasible and poorly detected
  ([SURF](https://sue.nl/en/insights/research/ansible-security-malicious-packages/)).
- **Artifact exposure.** The Red Hat consulting GitLab breach (Oct 2025) reportedly exposed
  Ansible playbooks, SSH keys, VPN configs, and credentials — not an Ansible flaw, but a
  reminder that the repo and its secrets are the blast radius
  ([Anomali](https://www.anomali.com/blog/red-hat-security-incident-crimson-collective-breach)).
- **Disclosure bugs.** Templating variable bleed
  ([CVE-2019-10156](https://github.com/advisories/GHSA-grgm-pph5-j5h7)), LDAP bind password
  in logs ([CVE-2020-1746](https://github.com/advisories/GHSA-j2h6-73x8-22c4)), and
  credentials in tracebacks ([CVE-2021-3620](https://github.com/advisories/ghsa-4r65-35qq-ch8j)).

The recurring lesson: compromise the control node, the repo/CI, or a credential and you own
the estate; the playbook engine is rarely the initial vector. That is the threat model
below.

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

### 5. Audit and limits

- Log every auth failure, denied egress/path, and run dispatch (project, playbook, action,
  caller identity where available) with secrets redacted; carry denials into the trace.
- Rate-limit and cap concurrent runs, request size, run duration, and clone/build size to
  bound DoS and accidental fork bombs.
- Startup/`doctor` warns loudly when `--serve` is non-loopback without `--exposed` and auth,
  when TLS termination is not expected at a proxy, or when the process runs as root.

### 6. Honest boundary

No amount of hardening makes it safe to let untrusted users submit arbitrary playbooks to
one instance: that is remote code execution by design. `--exposed` is for trusted operators
over a protected channel. Multi-tenant untrusted code needs separate instances (or a
worker-per-tenant container) with their own credentials and network policy.

### 7. Gaps this threat model exposes

The prior art above found several things the current ADRs **do not fully cover yet**. Each
is a work item with an owner; this section is deliberately a gap list, not a claim that the
design is complete.

1. **Control-node credentials are the crown jewels.** ADR 0022 covers a provider chain, but
   not per-target credential scoping, short-lived credentials, key rotation, disabled agent
   forwarding, or strict host-key checking. Add per-environment keys, no global vault/agent,
   host-key verification on by default, and a credential broker that scopes material to the
   run's targets. *Owner: ADR 0022 with this ADR.*
2. **Project/repo integrity.** ADR 0021 pins a resolved commit, but does not require signed
   commits/tags, an allow-listed ref/URL, or a lockfile for collections/plugins. A moving
   branch or a compromised repo becomes next-run RCE because project `.ts` plugins are
   auto-imported. Add signed-tag/commit verification where required, `--frozen`/lockfile
   semantics, and an explicit **trusted project** flag before plugin auto-import.
   *Owner: ADR 0021/0014/0015.*
3. **Argument/option injection.** AWX's `limit` bug and the Galaxy `--` bugs show the class.
   RoleCall must build argv arrays (never shell-concatenate), pass `--` before user-supplied
   positionals, reject leading `-` where a value is expected, and apply this to the fork
   runner, update commands, `git clone`, and module helpers. *Owner: this ADR + module
   implementations.*
4. **Per-run and per-tenant isolation.** The gateway/worker split is specified, but not
   run-scoped authorization on event streams (the AWX websocket-leak analog), per-project
   state/cache confinement, or a fresh worker/container per run. Any authenticated client
   must not subscribe to another project's output, and a run must not read another
   project's cache or state. *Owner: this ADR + ADR 0021.*
5. **Egress TOCTOU, DNS rebinding, and redirects.** The whitelist validates a host string,
   then resolution/connection happens. Add: resolve once, validate every A/AAAA record,
   connect to the validated IP, re-check on redirect, disable cross-origin redirects by
   default, and pin the broker's DNS result for the request. *Owner: ADR 0025.*
6. **Secret redaction at the event boundary.** Scrubbing only the serve token is not
   enough: module stdout/stderr, rendered templates, error tracebacks, and child
   environments can leak vault values. Add structured `no_log`/secret-reference masking in
   the event bus and JSONL, and build child env by allow-list, not deny-list.
   *Owner: ADR 0022 + this ADR.*
7. **Host-key and TLS verification.** Ensure SSH strict host-key checking and TLS
   verification are on by default; no silent `StrictHostKeyChecking=no`/`--insecure` paths,
   and no agent forwarding by default. *Owner: transport + this ADR.*
8. **Local `become` and resource limits.** Isolation does not yet state the policy for
   local `become` under the sandbox, nor bound fork/output bombs. Add: local `become`
   requires an explicit privileged mode (default fail-closed), and apply PID/CPU/memory/
   output limits (cgroups where available, rlimits/`ulimit` otherwise). *Owner: ADR 0025.*
9. **Tamper-evident audit.** The dispatch/auth logs are ordinary files a compromised
   service account can edit. Add an append-only/shipped audit sink (syslog/OTel/remote),
   sequence or hash chaining, and include update/service actions. *Owner: this ADR.*
10. **MCP and authoring scopes.** ADR 0020's tool surface is broader than the HTTP run API;
    exposed mode must deny or scope authoring/plugin-write tools per token and audit tool
    calls, not just hide routes. *Owner: ADR 0020 + this ADR.*
11. **RoleCall's own supply chain.** Update signatures are specified, but not SBOM,
    reproducible builds, dependency audit, or signing-key rotation/verification at install.
    Add these to the release/update pipeline. *Owner: ADR 0023.*
12. **JIT dependency installation.** If bundling or `bun install` runs over project code, it
    is another code-execution surface. Lock it, sandbox it, and apply the egress whitelist
    like shell/templates. *Owner: ADR 0014/0025.*

**What is already covered** (so the gap list is not mistaken for "nothing is designed"):
loopback-by-default and the `--exposed` gate, auth on every non-health route, restricted
routes/paths/URLs, control-plane SSRF validation, container/VM containment, the
gateway/worker target, default-on local isolation, filesystem/egress grants, template
classification, and remote confinement being explicitly out of scope.

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
- [ ] Close the §7 gaps: credential scoping + host-key/TLS verification, signed/locked
  project refs + trusted-project flag, argument/option-injection hardening (argv arrays,
  `--` separators, leading-`-` rejection), per-run event/state/cache isolation, DNS pinning
  + redirect policy, event-boundary secret masking, local `become`/resource limits,
  tamper-evident audit shipping, MCP per-tool scopes, SBOM/reproducible builds, and
  JIT-install sandboxing
- [ ] Tests: auth bypass, path traversal, SSRF (metadata/loopback), restricted-route
  enforcement, non-loopback refusal, child-env scrub, and denial-to-trace propagation

## References
- `src/orchestrator/serve.ts:98-113` (flag parsing; no token flag), `src/orchestrator/routes.ts` (`ROUTE_DEFINITIONS`, `authToken` guard), `src/orchestrator/mcp.ts` (`TOOL_DEFS`), `src/orchestrator/engine.ts`/`child-run.ts` (fork-per-run, `env: process.env`)
- `src/orchestrator/docs.ts`, `src/orchestrator/openapi.ts` (unauthenticated docs/OpenAPI)
- `src/store/projects.ts`, `src/config/schema.ts` (project refs, schema validation), `src/vfs/project-source.ts` (path confinement), ADR 0021 (remote project source)
- ADR 0017, ADR 0020, ADR 0021, ADR 0022, ADR 0023, ADR 0025, ADR 0026
