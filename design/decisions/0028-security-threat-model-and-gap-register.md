# 0028 — Security threat model, control map, and gap register

- Status: **Proposed**
- Date: 2026-11-01
- Related (security-relevant ADRs): [0003](0003-zod-driven-agent-surface.md), [0005](0005-io-abstractions-vfs-db-scratch.md), [0008](0008-literal-by-default-templating-and-template-operator.md), [0013](0013-explicit-variable-namespacing.md), [0014](0014-project-and-plugin-architecture.md), [0015](0015-collections-and-install-commands.md), [0016](0016-plugin-and-module-sdk-authoring-surface.md), [0017](0017-execution-isolation-and-run-scope.md), [0018](0018-dual-runtime-distribution-npm-node-binaries-bun.md), [0019](0019-store-over-pal-sqlite-drop-drizzle.md), [0020](0020-mcp-server-and-tool-surface.md), [0021](0021-remote-git-project-source.md), [0022](0022-secrets-vault-and-provider-chain.md), [0023](0023-installation-layout-and-service-model.md), [0025](0025-local-execution-isolation.md), [0026](0026-remote-execution-confinement.md), [0027](0027-exposed-orchestrator-api-security.md)

## Context

Security in RoleCall is currently spread across the ADRs above: install/service privilege
in 0023, local isolation and templates in 0025, remote confinement in 0026, exposed-API
controls in 0027, secrets in 0022, project trust in 0021, and so on. That is the right
place for the **controls**, but it leaves the **cross-cutting threat model** and the
**things we have not built yet** without a home. A gap that spans two ADRs tends to be
owned by neither.

This ADR is that home. It does **not** replace the per-area decisions; it states the
overall model, links every security-relevant ADR, and keeps a live gap register. A change
that introduces a new execution surface must update this ADR.

## Decision

### 1. Adopt this threat model and gap register as the cross-cutting security authority

- Per-area ADRs remain normative for their controls.
- This ADR is normative for the **inventory** of controls and gaps: if a security surface
  exists without a row here, the design is incomplete.
- The gap register is deliberately explicit. "Not yet covered" is a tracked state, not a
  claim that the design is finished.

### 2. Security invariants

1. **The control plane is a code-execution surface by design.** Playbooks, plugins,
   templates, and update artifacts run code. Minimize reach rather than pretending it is
   inert.
2. **No ambient trust from data.** A cloned project, playbook, template, URL, extra var, or
   API body cannot authorize its own filesystem access, egress, code execution, or
   clipboard of secrets. Approval is an operator action.
3. **Default deny, fail closed.** Network, filesystem, code templates, exposed routes, and
   remote confinement default to off/limited. "Last resort" overrides are explicit, warned,
   and traced.
4. **Defense in depth.** Parse → validate (Zod) → authorize → confine → audit. A single
   check is never the boundary.
5. **Least privilege.** Unprivileged service, per-target credentials, no root, no agent
   forwarding by default, root-owned binary, least-privilege state.
6. **Secrets are minimized and redacted at the boundary.** Do not pass ambient env; mask at
   the event bus; never log tokens, vault values, or tracebacks with credentials.
7. **External exposure is explicit.** Loopback by default; non-loopback requires the
   `--exposed` profile and auth, and assumes the process may be compromised.
8. **Integrity of artifacts.** Signed/checksummed releases, pinned commits/collections,
   and an update path that verifies before executing.
9. **Audit off the compromised host.** A control-node attacker must not be able to rewrite
   the only record of what happened.
10. **Remote targets are not ours to sandbox.** Target-side policy is the boundary; do not
    imply protection the controller cannot provide.
11. **Structured argv, never shell strings.** Build argument arrays, use `--` before
    user-supplied positionals, and reject leading `-` where a value is expected. The AWX
    `limit` and Galaxy `--` bugs are the same class.
12. **Integrity of the toolchain, not just the artifact.** SBOM, dependency audit,
    reproducible builds where feasible, and a signing-key rotation/revocation path.

### 3. Security control map

Every ADR that addresses a security concern, and what it actually covers:

| ADR | Security role | Notes / residual |
| --- | --- | --- |
| [0003](0003-zod-driven-agent-surface.md) | Zod-derived agent surface | Typed input validation; not an auth boundary |
| [0005](0005-io-abstractions-vfs-db-scratch.md) | VFS/DB/scratch seams | Path and state confinement substrate |
| [0008](0008-literal-by-default-templating-and-template-operator.md) | Literal-by-default strings; opt-in `$template` | The template operator is a code surface; expanded by 0025 §7 |
| [0013](0013-explicit-variable-namespacing.md) | Explicit variable namespacing | Reduces ambiguity/precedence surprises; not a trust boundary |
| [0014](0014-project-and-plugin-architecture.md) | Project/plugin architecture; §8 trust boundary | Plugins are code; needs a trusted-project gate (gap) |
| [0015](0015-collections-and-install-commands.md) | Collections/install | Dependency supply chain; needs lockfile/signature policy (gap) |
| [0016](0016-plugin-and-module-sdk-authoring-surface.md) | Plugin/module SDK | Authoring surface; capability declarations still thin |
| [0017](0017-execution-isolation-and-run-scope.md) | Dependency-injected run scope, forked runs | Per-run global isolation; not a host sandbox |
| [0018](0018-dual-runtime-distribution-npm-node-binaries-bun.md) | Dual runtime/artifact channels | Build/parity; artifact integrity is 0023/0028 |
| [0019](0019-store-over-pal-sqlite-drop-drizzle.md) | Store over the PAL SqliteDb seam | State integrity/permissions (indirect) |
| [0020](0020-mcp-server-and-tool-surface.md) | MCP server/tool surface | Broader than HTTP; needs per-tool scopes (gap) |
| [0021](0021-remote-git-project-source.md) | Remote git project source | Untrusted code and cache; signed refs/trust flag (gap) |
| [0022](0022-secrets-vault-and-provider-chain.md) | `$secret`, vault providers, masking | Needs per-target scoping and event-boundary redaction (gap) |
| [0023](0023-installation-layout-and-service-model.md) | Install layout, unprivileged service, config perms, signed updates, exposed-bind gate | Foundation for privilege separation |
| [0025](0025-local-execution-isolation.md) | Local shell/template isolation, grants, egress, templates | Needs DNS pinning, local `become`, resource limits (gap) |
| [0026](0026-remote-execution-confinement.md) | Remote shell confinement (opt-in) and explicit non-goals | Targets remain target-governed |
| [0027](0027-exposed-orchestrator-api-security.md) | Exposed orchestrator API controls | Gaps moved here (§5) |

Adjacent input-surface ADRs: [0009](0009-ansible-compatibility-and-mechanical-conversion.md)
and [0024](0024-ansible-analyzer-and-mechanical-converter.md) parse external Ansible input;
they must stay schema-first and must not execute analyzed content.

### 4. Prior art: what actually goes wrong with Ansible

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
the estate; the playbook engine is rarely the initial vector.

### 5. Gap register

Status legend: **Closed by decision** means the owning ADR now specifies the boundary and
what remains is implementation work. **Open** means no decision yet. This register tracks
design coverage, not whether code has shipped.

1. **Control-node credentials are the crown jewels.** ADR 0022 covers a provider chain, but
   not per-target credential scoping, short-lived credentials, key rotation, disabled agent
   forwarding, or strict host-key checking. Add per-environment keys, no global vault/agent,
   host-key verification on by default, and a credential broker that scopes material to the
   run's targets. *Owner: [ADR 0022](0022-secrets-vault-and-provider-chain.md) + this ADR.*
   **Policy closed by decision (ADR 0022 §7); credential broker open.**
2. **Project/repo integrity.** ADR 0021 pins a resolved commit, but does not require signed
   commits/tags, an allow-listed ref/URL, or a lockfile for collections/plugins. A moving
   branch or a compromised repo becomes next-run RCE because project `.ts` plugins are
   auto-imported. Add signed-tag/commit verification where required, `--frozen`/lockfile
   semantics, and an explicit **trusted project** flag before plugin auto-import.
   *Owner: [ADR 0021](0021-remote-git-project-source.md)/[ADR 0014](0014-project-and-plugin-architecture.md)/[ADR 0015](0015-collections-and-install-commands.md).*
   **Closed by decision (ADR 0021 §7, 0015 §6, 0014 §8); implementation open.**
3. **Argument/option injection.** AWX's `limit` bug and the Galaxy `--` bugs show the class.
   RoleCall must build argv arrays (never shell-concatenate), pass `--` before user-supplied
   positionals, reject leading `-` where a value is expected, and apply this to the fork
   runner, update commands, `git clone`, and module helpers. *Owner:
   [ADR 0027](0027-exposed-orchestrator-api-security.md) + module implementations.*
   **Closed by decision (ADR 0027 §4, invariant 11); implementation open.**
4. **Per-run and per-tenant isolation.** The gateway/worker split is specified in 0027, but
   not run-scoped authorization on event streams (the AWX websocket-leak analog),
   per-project state/cache confinement, or a fresh worker/container per run. Any
   authenticated client must not subscribe to another project's output, and a run must not
   read another project's cache or state. *Owner:
   [ADR 0027](0027-exposed-orchestrator-api-security.md) + [ADR 0021](0021-remote-git-project-source.md).*
   **Partially closed by decision (ADR 0027 §3: event authorization + cache namespacing);
   per-run worker/container open.**
5. **Egress TOCTOU, DNS rebinding, and redirects.** The whitelist validates a host string,
   then resolution/connection happens. Add: resolve once, validate every A/AAAA record,
   connect to the validated IP, re-check on redirect, disable cross-origin redirects by
   default, and pin the broker's DNS result for the request.
   *Owner: [ADR 0025](0025-local-execution-isolation.md).*
   **Closed by decision (ADR 0025 §6); implementation open.**
6. **Secret redaction at the event boundary.** Scrubbing only the serve token is not
   enough: module stdout/stderr, rendered templates, error tracebacks, and child
   environments can leak vault values. Add structured `no_log`/secret-reference masking in
   the event bus and JSONL, and build child env by allow-list, not deny-list.
   *Owner: [ADR 0022](0022-secrets-vault-and-provider-chain.md) + [ADR 0027](0027-exposed-orchestrator-api-security.md).*
   **Closed by decision (ADR 0022 §6–7, ADR 0027 §3); implementation open.**
7. **Host-key and TLS verification.** Ensure SSH strict host-key checking and TLS
   verification are on by default; no silent `StrictHostKeyChecking=no`/`--insecure` paths,
   and no agent forwarding by default. *Owner: transport +
   [ADR 0027](0027-exposed-orchestrator-api-security.md).*
   **Closed by decision (ADR 0022 §7); implementation open.**
8. **Local `become` and resource limits.** Isolation does not yet state the policy for
   local `become` under the sandbox, nor bound fork/output bombs. Add: local `become`
   requires an explicit privileged mode (default fail-closed), and apply PID/CPU/memory/
   output limits (cgroups where available, rlimits/`ulimit` otherwise).
   *Owner: [ADR 0025](0025-local-execution-isolation.md).*
   **Closed by decision (ADR 0025 §2); implementation open.**
9. **Tamper-evident audit.** Dispatch/auth logs are ordinary files a compromised service
   account can edit. Add an append-only/shipped audit sink (syslog/OTel/remote), sequence
   or hash chaining, and include update/service actions.
   *Owner: [ADR 0027](0027-exposed-orchestrator-api-security.md).*
   **Closed by decision (ADR 0027 §5); implementation open.**
10. **MCP and authoring scopes.** ADR 0020's tool surface is broader than the HTTP run API;
    exposed mode must deny or scope authoring/plugin-write tools per token and audit tool
    calls, not just hide routes.
    *Owner: [ADR 0020](0020-mcp-server-and-tool-surface.md) + [ADR 0027](0027-exposed-orchestrator-api-security.md).*
    **Closed by decision (ADR 0020 §9, ADR 0027 §1); implementation open.**
11. **RoleCall's own supply chain.** Update signatures are specified, but not SBOM,
    reproducible builds, dependency audit, or signing-key rotation/verification at install.
    Add these to the release/update pipeline.
    *Owner: [ADR 0023](0023-installation-layout-and-service-model.md).*
    **Closed by decision (ADR 0023 §8); pipeline work open.**
12. **JIT dependency installation.** If bundling or `bun install` runs over project code, it
    is another code-execution surface. Lock it, sandbox it, and apply the egress whitelist
    like shell/templates.
    *Owner: [ADR 0014](0014-project-and-plugin-architecture.md)/[ADR 0025](0025-local-execution-isolation.md).*
    **Closed by decision (ADR 0014 §8, 0015 §6/§8); implementation open.**

**What is already covered** (so the gap list is not mistaken for "nothing is designed"):
loopback-by-default and the `--exposed` gate, auth on every non-health route, restricted
routes/paths/URLs, control-plane SSRF validation, container/VM containment, the
gateway/worker target, default-on local isolation, filesystem/egress grants, template
classification, and remote confinement being explicitly out of scope.

### 6. Maintenance rule

Any change that adds a new execution surface (shell path, template engine, plugin loader,
update mechanism, API route, transport, remote cache, dependency installer) must:

1. add or update a row in the control map;
2. add a threat-model paragraph to the owning ADR (assets, trust boundary, abuse cases);
3. either close the relevant gap here or register a new one;
4. add the failing test that proves the boundary (not just the happy path).

## Alternatives considered

- **Leave gaps scattered in the area ADRs (as before).** Rejected: cross-cutting gaps
  (credentials, supply chain, event isolation) fell between owners and the prior art had no
  home.
- **Make this ADR own every control.** Rejected: per-area ADRs are the right place for
  mechanism; a single mega-ADR would drift and hide the detail.
- **Treat the gap register as documentation only.** Rejected: it must drive work items and
  release gates, or it becomes stale.
- **Rely on "trusted operators" and skip the gaps.** Rejected: the Ansible record shows the
  control plane is compromised by bugs upstream of operator intent; defense in depth is the
  point.

## Consequences

**Positive**
- One place to see the security posture, the prior art that motivates it, and what is still
  missing.
- Every security-relevant ADR is linked and has a stated role, so new work can find the
  relevant decision.
- Gaps have owners and a maintenance rule, reducing the "nobody owns the cross-cutting
  concern" failure mode.

**Negative / risk**
- A living gap register is maintenance work and will go stale if PRs do not update it.
- Some gaps are large (credential brokering, gateway/worker split, supply chain) and cannot
  be closed quickly; listing them sets expectations that must be managed.
- The control map can imply coverage where an ADR is still Proposed and unimplemented.

## Work items
- [ ] Design-side closure landed for gaps 2, 3, 5, 6, 7, 8, 9, 10, 11, and 12; gap 1 has its policy closed but the broker open; gap 4 is partially closed (event auth + cache namespacing). Remaining work below is implementation.
- [ ] Keep the control map and gap register current as ADRs land (maintenance rule §6).
- [ ] Implement gap 1 (credential broker, scoping, host-key/TLS, no agent forwarding) in ADR 0022.
- [ ] Implement gap 2 (signed/locked refs, trusted-project flag) in ADR 0021/0014/0015.
- [ ] Implement gap 3 (argument/option injection) across the fork runner, update, git, and modules.
- [ ] Implement gaps 4 and 9 (per-run event/state isolation, tamper-evident audit) in ADR 0027.
- [ ] Implement gaps 5 and 8 (DNS pinning/redirects, local `become`, resource limits) in ADR 0025.
- [ ] Implement gap 6 (event-boundary secret masking) in ADR 0022/0027.
- [ ] Implement gaps 7 and 10 (host-key/TLS, MCP per-tool scopes) in the transports and ADR 0020/0027.
- [ ] Implement gaps 11 and 12 (SBOM/reproducible builds, JIT-install sandboxing) in ADR 0023/0014/0025.

## References
- Security ADRs listed in the header; especially 0014 §8, 0017, 0021 §7, 0022, 0023, 0025 §7, 0026, 0027.
- `src/config/schema.ts`, `src/config/loader.ts` (validation/parsing), `src/executor/*`, `src/transport/*`, `src/orchestrator/*`, `src/templating/*`, `src/modules/*` (execution surfaces named in the gaps).
- Incident sources linked in §4.
