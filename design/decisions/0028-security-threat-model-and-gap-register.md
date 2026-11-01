# 0028 — Security control index and remaining gaps

- Status: **Proposed**
- Date: 2026-11-01
- Related (security-relevant ADRs): [0003](0003-zod-driven-agent-surface.md), [0005](0005-io-abstractions-vfs-db-scratch.md), [0008](0008-literal-by-default-templating-and-template-operator.md), [0013](0013-explicit-variable-namespacing.md), [0014](0014-project-and-plugin-architecture.md), [0015](0015-collections-and-install-commands.md), [0016](0016-plugin-and-module-sdk-authoring-surface.md), [0017](0017-execution-isolation-and-run-scope.md), [0018](0018-dual-runtime-distribution-npm-node-binaries-bun.md), [0019](0019-store-over-pal-sqlite-drop-drizzle.md), [0020](0020-mcp-server-and-tool-surface.md), [0021](0021-remote-git-project-source.md), [0022](0022-secrets-vault-and-provider-chain.md), [0023](0023-installation-layout-and-service-model.md), [0025](0025-local-execution-isolation.md), [0026](0026-remote-execution-confinement.md), [0027](0027-exposed-orchestrator-api-security.md)

## Context

Security controls are spread across the ADRs above: install/service privilege in 0023,
local isolation and templates in 0025, remote confinement in 0026, exposed-API controls in
0027, secrets in 0022, project trust in 0021, and so on. The per-area ADRs are normative
for their mechanisms. This ADR is the index: it records which ADRs cover which security
surface and what is still missing.

## Decision

### 1. Security control map

| ADR | Security role |
| --- | --- |
| [0003](0003-zod-driven-agent-surface.md) | Zod-derived agent surface; typed input validation (not an auth boundary) |
| [0005](0005-io-abstractions-vfs-db-scratch.md) | VFS/DB/scratch seams; path and state confinement substrate |
| [0008](0008-literal-by-default-templating-and-template-operator.md) | Literal-by-default strings; opt-in `$template` is a code surface, expanded by 0025 §7 |
| [0013](0013-explicit-variable-namespacing.md) | Explicit variable namespacing; reduces ambiguity, not a trust boundary |
| [0014](0014-project-and-plugin-architecture.md) | Project/plugin architecture; §8 trust boundary, no runtime JIT by default |
| [0015](0015-collections-and-install-commands.md) | Dependency supply chain; pinning/lockfile, signed refs, no runtime hydration |
| [0016](0016-plugin-and-module-sdk-authoring-surface.md) | Plugin/module SDK; authoring surface, capability declarations |
| [0017](0017-execution-isolation-and-run-scope.md) | Per-run run scope and fork-per-run last-run isolation; process/global separation |
| [0018](0018-dual-runtime-distribution-npm-node-binaries-bun.md) | Dual runtime/artifact channels; build parity |
| [0019](0019-store-over-pal-sqlite-drop-drizzle.md) | Store over the PAL SqliteDb seam; state integrity/permissions |
| [0020](0020-mcp-server-and-tool-surface.md) | MCP tool surface; per-tool scopes, exposed-mode authoring limits |
| [0021](0021-remote-git-project-source.md) | Remote git project source; untrusted code, cache, signed refs/trust flag |
| [0022](0022-secrets-vault-and-provider-chain.md) | `$secret`, vault providers, masking, credential scoping, transport trust |
| [0023](0023-installation-layout-and-service-model.md) | Install layout, unprivileged service, config perms, signed updates, exposed-bind gate |
| [0025](0025-local-execution-isolation.md) | Local shell/template isolation, filesystem grants, egress policy, templates |
| [0026](0026-remote-execution-confinement.md) | Remote shell confinement (opt-in) and explicit non-goals |
| [0027](0027-exposed-orchestrator-api-security.md) | Exposed orchestrator API; auth, restricted routes, SSRF/path policy, containment |

Adjacent input-surface ADRs: [0009](0009-ansible-compatibility-and-mechanical-conversion.md)
and [0024](0024-ansible-analyzer-and-mechanical-converter.md) parse external Ansible input;
they stay schema-first and never execute analyzed content.

### 2. Remaining design gaps

Only these two areas still lack a full design decision:

1. **Credential broker.** ADR 0022 §7 now sets the policy (per-target scope, short-lived
   credentials, rotation, no agent forwarding, strict host-key/TLS), but the broker itself
   has no interface, lifetime, storage, or failure model. *Owner: [ADR 0022](0022-secrets-vault-and-provider-chain.md).*
2. **Per-run security identity and multi-tenancy.** ADR 0017 already isolates per-run
   process/global state and crashes; ADR 0027 §3 decides event authorization and per-project
   state/cache namespacing. What is still undesigned is a per-run worker identity/container
   (every child currently shares the service account, DB, and cache) and a tenant model.
   *Owner: [ADR 0017](0017-execution-isolation-and-run-scope.md) + [ADR 0027](0027-exposed-orchestrator-api-security.md) + [ADR 0021](0021-remote-git-project-source.md).*

### 3. Design closed, implementation remaining

These are no longer design gaps; the owning ADRs specify the boundary and the remaining
work is implementation and tests.

| Area | Decision | ADR |
| --- | --- | --- |
| Project/repo integrity | signed tags/commits where required, `--frozen`/lockfile, trusted-project flag before `.ts` plugin import | [0021 §7](0021-remote-git-project-source.md), [0015 §6](0015-collections-and-install-commands.md), [0014 §8](0014-project-and-plugin-architecture.md) |
| Argument/option injection | argv arrays, `--` before user positionals, reject leading `-` | [0027 §4](0027-exposed-orchestrator-api-security.md) |
| Egress TOCTOU / DNS rebinding / redirects | resolve once, validate A/AAAA, connect to validated IP, re-check redirects | [0025 §6](0025-local-execution-isolation.md) |
| Secret redaction at the event boundary | mask every event field; child-env allow-list | [0022 §6–7](0022-secrets-vault-and-provider-chain.md), [0027 §3](0027-exposed-orchestrator-api-security.md) |
| Host-key/TLS/agent forwarding | strict verification on, agent forwarding off, no implicit insecure flag | [0022 §7](0022-secrets-vault-and-provider-chain.md) |
| Local `become` + resource limits | deny by default; explicit privileged mode; PID/CPU/memory/output caps | [0025 §2](0025-local-execution-isolation.md) |
| Tamper-evident audit | append-only/off-box sink, hash chaining, update/service actions included | [0027 §5](0027-exposed-orchestrator-api-security.md) |
| MCP/authoring scopes | per-tool scopes; author/plugin-write disabled in exposed mode | [0020 §9](0020-mcp-server-and-tool-surface.md), [0027 §1](0027-exposed-orchestrator-api-security.md) |
| RoleCall supply chain | SBOM, dependency audit, reproducible builds, signing-key rotation | [0023 §8](0023-installation-layout-and-service-model.md) |
| JIT dependency installation | no runtime JIT by default; if enabled, locked, sandboxed, egress-whitelisted | [0014 §8](0014-project-and-plugin-architecture.md), [0015 §6/§8](0015-collections-and-install-commands.md) |

### 4. Maintenance rule

Any change that adds a new execution surface (shell path, template engine, plugin loader,
update mechanism, API route, transport, remote cache, dependency installer) must add or
update a control-map row, close or register a gap here, and add a failing test that proves
the boundary.

## Alternatives considered

- **Leave the index scattered across the area ADRs.** Rejected: cross-cutting gaps
  (credentials, supply chain, event isolation) fall between owners.
- **Make this ADR own every control.** Rejected: per-area ADRs own mechanism; a single
  mega-ADR would drift.
- **Treat the gap list as documentation only.** Rejected: it must drive work items and
  release gates or it goes stale.

## Consequences

**Positive**
- One index of the security-relevant ADRs and the remaining design gaps.
- The design-closed list keeps the outstanding implementation work visible without
  re-litigating decisions.

**Negative / risk**
- The index must be updated as ADRs land or it goes stale.
- The two open gaps are large and cannot be closed quickly.
- The map can imply coverage where an ADR is still Proposed and unimplemented.

## Work items
- [ ] Design the credential broker in ADR 0022 (interface, lifetime, storage, failure model).
- [ ] Design per-run worker identity/container and the tenant model in ADR 0017/0027/0021.
- [ ] Implement the design-closed areas above in their owning ADRs (project integrity,
  argument handling, DNS/redirect pinning, event redaction, host-key/TLS, `become`/rlimits,
  audit shipping, MCP scopes, SBOM/reproducible builds, JIT-install sandboxing).
- [ ] Keep the control map and gap list current as ADRs land (§4).

## References
- Security ADRs listed in the header; especially [0014 §8](0014-project-and-plugin-architecture.md), [0017](0017-execution-isolation-and-run-scope.md), [0021 §7](0021-remote-git-project-source.md), [0022](0022-secrets-vault-and-provider-chain.md), [0023 §8](0023-installation-layout-and-service-model.md), [0025 §2/§6/§7](0025-local-execution-isolation.md), [0026](0026-remote-execution-confinement.md), [0027](0027-exposed-orchestrator-api-security.md).
- Execution surfaces named in the map: `src/executor/*`, `src/transport/*`, `src/orchestrator/*`, `src/templating/*`, `src/modules/*`, `src/vfs/*`.
