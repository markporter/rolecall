# 0026 — Remote execution confinement: wrapping remote shells is opt-in, not a default

- Status: **Proposed**
- Date: 2026-11-01
- Related: [ADR 0014](0014-project-and-plugin-architecture.md) (§8: plugins/commands are code), [ADR 0023](0023-installation-layout-and-service-model.md) (control-node install/service), [ADR 0025](0025-local-execution-isolation.md) (local containment; deliberately does not cover targets), [ADR 0027](0027-exposed-orchestrator-api-security.md) (exposed serve containment)

## Context

On a remote target, the shell is the most dangerous surface: `command`, `shell`, `script`,
`raw`, and module-initiated `connection.exec` all send a shell command over SSH (or
WinRM/HTTP) that runs with the target account's full privileges. Local isolation
(ADR 0025) cannot help: the process runs on the target.

Wrapping remote shells in `bwrap` or a container is technically possible, but the semantics
differ fundamentally from local isolation:

- **Local isolation protects the control node by hiding host resources.** Remote config
  management usually needs the opposite: the task exists to change `/etc`, install packages,
  manage services, or write paths outside any project directory. A project-scoped sandbox on
  the target would break the common case.
- **A sandbox that can change the host is not containment.** Mounting the target root
  read-write into a container makes the workload behave, but a compromised command inside it
  still owns the host filesystem. Mounting only the project protects the host but prevents
  normal operations.
- **Bootstrap and privilege costs are real.** `bwrap` needs to be installed and unprivileged
  user namespaces enabled on every target; Docker/Podman needs a daemon, an image, and
  usually root-equivalent socket access. A tool that wraps shells in Docker to protect a host
  while granting `docker` group membership has moved the privilege boundary, not removed it.
- **Coverage gaps are wide.** File transfer (`copy`, `fetch`, `template`), `become`/sudo,
  package managers, reboot, and service management do not fit a per-command wrapper. A
  partial wrapper can create a false sense of safety.

So the question is not "can we wrap?" (yes, narrowly) but "when is wrapping the right tool?"
For most fleets, target-side policy is stronger and simpler than per-command wrappers.

## Decision

### 1. Remote confinement is opt-in per connection, never the default

Add an optional per-target/connection setting:

```yaml
# inventory host_vars or a connection profile
rolecall_remote_isolation: none   # none (default) | bwrap | docker
```

- Default `none`. Unlike local isolation, remote behavior does not change until an operator
  opts in for a host/group.
- At connect, probe the requested backend (`bwrap` + userns, or a Docker-compatible CLI). If
  it is unavailable, **fail closed** with a typed error; never silently run the command
  unwrapped.
- `rolecall doctor`/inventory inspection reports the negotiated mode per host and why.

### 2. Wrapping applies only to project-scoped, unprivileged execution

When enabled, only untrusted command execution is wrapped:

- `command`, `shell`, `script`, `raw` and their children.
- Trusted module exec (`get_url`, `git`, package managers) may pass through or use a
  declared profile; wrapping every module's helper breaks them and provides little benefit.
- **Refused/unsupported under a wrapper:** `become`/sudo, reboot, service management, and
  file-transfer operations that target host paths outside the mounted project. These either
  error with guidance or require explicit `remote_isolation: none` for that task/host. This
  is honest: a partial wrapper must not pretend to cover them.

The wrapper is built from the same validated pieces as ADR 0025: a pinned image (Docker) or
a minimal read-only root plus project bind mount (`bwrap`), non-root inside, capabilities
dropped, no host home, and a network mode (`off` for no egress; `on` for the command's
needs). Because the control-plane egress broker is local-only, destination whitelisting on a
target requires target-side enforcement; v1 offers `off`/`on`, not an allow-list.

### 3. Prefer target-side policy for real fleets

For general remote configuration management, the recommended controls are:

- least-privilege SSH accounts and sudo allow-lists (Command allow-listing rather than
  arbitrary shells);
- a restricted shell or SSH `forced_command` wrapper on the target;
- SELinux/AppArmor and host firewalls;
- running managed workloads in containers (the target, not RoleCall, owns the boundary);
- declarative modules instead of `shell:` for routine work, so the policy is in the module,
  not in arbitrary script text.

These are deployment choices, not a new RoleCall mechanism, and they apply uniformly to
every provisioning tool, not just RoleCall.

### 4. Explicit non-goals

- No remote agent/service, no per-target registry, and no attempt to "chroot the target"
  from the controller. Those are large, platform-specific projects and would not change the
  fact that the target account can already run code.
- No claim that `rolecall_remote_isolation: none` is safe for hostile playbooks. It is the
  default for compatibility; trusted operators and target-side policy remain the boundary.
- No control-plane destination whitelist for remote shell traffic. The egress broker cannot
  see target-side connections; only target firewalls/namespaces can enforce that.

## Alternatives considered

- **Wrap every remote shell by default in bwrap.** Rejected: requires bwrap/userns on every
  target, breaks host-wide management and `become`, and is unavailable on Windows/macOS
  targets. Opt-in avoids a fleet-wide outage.
- **Wrap every remote shell by default in Docker/Podman.** Rejected for the same reasons,
  plus a daemon/image on every target and root-equivalent socket access. Rootless Docker is
  better but still a deployment prerequisite.
- **Mount the target root into a container and call it isolation.** Rejected: a read-write
  root mount means a compromised command still owns the host; a read-only root breaks the
  work. It is a packaging convenience, not containment.
- **Run the egress broker on the target or reverse-tunnel it.** Rejected for v1: requires
  deploying and securing another service per target; target-side firewalls/SELinux already
  solve the destination problem more directly.
- **Build a remote agent with a constrained RPC.** Deferred: the right long-term answer if a
  fleet needs uniform enforcement, but it is a new binary, protocol, service, and update
  surface — too large for this ADR.
- **Do nothing and pretend local isolation protects targets.** Rejected: false assurance;
  this ADR exists to state the boundary plainly.

## Consequences

**Positive**
- Operators can confine project-scoped remote work on targets that have bwrap or Docker,
  without changing behavior elsewhere.
- Fail-closed negotiation prevents a requested wrapper from silently disappearing.
- The honest non-goals keep the maintenance surface bounded and push general host hardening
  to the layer that can actually enforce it.

**Negative / risk**
- Opt-in means most fleets remain unconfined by RoleCall; the safety story rests on target
  policy and trusted operators.
- Even where enabled, `become`, file transfer, and host-wide operations are excluded, so
  coverage is partial and must be documented loudly.
- Requires bwrap/userns or a container runtime on targets, plus image distribution/offline
  preload; heterogeneous fleets will have mixed capabilities.
- Remote egress has only `off`/`on`, not the local destination whitelist; operators may
  assume parity that does not exist.
- A per-command wrapper can give a false sense of security; the docs must state exactly
  what is and is not enclosed.

## Work items
- [ ] Add `rolecall_remote_isolation` (connection/host var + inventory profile) defaulting to `none`, with schema validation and per-host negotiation in `SshConnection`/connection factory
- [ ] Probe `bwrap`+userns and Docker-compatible targets; fail closed when the requested mode is unavailable; surface negotiation and refusal reasons in `doctor`/inventory output
- [ ] Build the remote wrapper for untrusted exec only (minimal root/project mount for bwrap; pinned image + mounts for Docker), with `net: off|on`, non-root, dropped capabilities, and no host home
- [ ] Refuse or require an explicit opt-out for `become`/sudo, reboot, service management, and file-transfer paths under a wrapper; document the coverage matrix
- [ ] Tests against the SSH simulator: wrapper availability/refusal, project-scoped success, `become` refusal, network off/on, and no behavior change when `none`
- [ ] Docs: when to use remote confinement, its gaps, and the target-side alternatives (restricted accounts, forced commands, SELinux/AppArmor, containers)

## References
- `src/transport/ssh.ts`, `src/transport/local.ts`, `src/transport/connection.ts` (`Connection`/`ExecOptions`), `src/inventory/engine.ts` (host vars/connection profiles)
- `src/modules/builtins/{command,shell,script,raw,get_url,git,copy,fetch}.ts` (exec vs file-transfer paths)
- `design/architecture/connectivity.md` (transport design), `docs/content/reference/module-reference.md` (`command`/`shell`/`become` semantics)
- ADR 0014 §8, ADR 0023 (control-node install), ADR 0025 (local isolation), ADR 0027 (exposed serve)
