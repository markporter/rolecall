# 0022 — Secrets: `$secret` references, vault providers, and masking

- Status: **Proposed**
- Date: 2026-11-01
- Related: ADR 0004 (serverless/git-friendly), ADR 0008 (literal-by-default templating / `$template`), ADR 0009 (Ansible compatibility), ADR 0013 (`$var` namespacing), ADR 0014 (project & plugin architecture), ADR 0016 (plugin SDK authoring), ADR 0017 (execution isolation / run scope), ADR 0018 (dual-runtime distribution), ADR 0019 (store over PAL sqlite), ADR 0021 (remote git project source)

## Context

RoleCall has no secret store today. The only supported injection path is an operator
putting values into environment variables or inventory/play vars, and those values
are then indistinguishable from ordinary variables: they can be rendered into
`--output json`, module stdout/stderr, `--diff` output, run traces, and the
serve orchestrator's status endpoints. `no_log: true` exists, but it is a manual
per-task switch that drops whole fields; it is not a secret-sourcing or masking
system.

The target capability is already stated in `design/goals.md` and
`design/ansible-comparison.md` §4.1: a vault-reference resolution layer plus
secret injection that never renders secrets into logs/stdout. This ADR turns that
goal into a concrete contract, covering:

1. the authoring syntax,
2. the provider interface and the initial provider set, and
3. the fallback/security policy that keeps unmanaged sources from silently
   becoming authoritative.

The ADR also records the masking rules that must hold regardless of provider, and
how serve mode (fork-per-run, ADR 0017) keeps secret values inside one child
process.

## Decision

### 1. `$secret` is a structured reference operator

Add `$secret` to the structured-ref family in `src/templating/refs.ts`, next to
`$var`, `$concat`, `$call`, `$if`, `$each`, and `$template`. Bare strings stay
literal (ADR 0008); secrets are never auto-rendered from `{{ }}` or bare strings.

Canonical form:

```yaml
- name: Create application database
  module: postgresql_user
  args:
    name: app
    password:
      $secret: db.password
```

Provider-qualified form when the project needs to be explicit:

```yaml
- name: Call the billing API
  module: http
  args:
    url: https://billing.example.com/charge
    headers:
      authorization:
        $secret:
          provider: aws-secrets
          name: prod/billing/api-key
```

Rules:

- `$secret` resolves to a raw value (string or structured JSON, depending on the
  provider). It is escapeless, like every other structured node.
- The resolved value is registered in a per-run `SecretRegistry` for masking.
- `$secret` is allowed anywhere a structured node is allowed (`args`, nested
  arrays/objects, `$concat`, `$if`). It is **not** allowed in `when` or `loop`
  conditions in v1: comparisons over secrets are an explicit non-goal and would
  widen the masking surface.
- Secret values are resolved **late**, at task dispatch, not during inventory or
  playbook loading. They must not be merged into `vars`, `facts`, `reg`, or
  `inv`.
- `$secret` is not a new namespace, so ADR 0013's namespace table is unchanged.

### 2. Provider interface and plugin type

A provider is a small async adapter:

```ts
interface SecretRef {
  name: string;
  key?: string;
}

interface SecretProviderContext {
  projectRoot: string;
  runId: string;
  host?: string;
  env: Record<string, string | undefined>;
  signal?: AbortSignal;
  /** Provider/ref metadata only; never pass a secret value here. */
  log?: (event: SecretProviderEvent) => void;
}

interface SecretProvider {
  readonly name: string;
  resolve(ref: SecretRef, ctx: SecretProviderContext): Promise<string>;
  close?(): Promise<void>;
}
```

Providers are registered through the existing plugin model:

```text
plugins/
  secret_providers/
    myorg/
      hashicorp-vault.ts
```

This extends ADR 0014's plugin-type list with `secret_providers`; the FQCN is
`<namespace>.<name>`, and the same trust boundary applies as for modules: a
provider plugin is executable code and can exfiltrate secrets. Provider plugins
are loaded only from the project (or an explicitly registered global plugin),
never auto-discovered from an untrusted working directory in serve mode.

Project configuration lives in `.rolecall/secrets.yaml`. It contains provider
selection and chain order, not secret values:

```yaml
providers:
  env:
    kind: env
  main:
    kind: file
    path: .rolecall/secrets.vault
  ansible:
    kind: ansible-vault
    path: group_vars/all/vault.yml
chain:
  - main
  - env
```

### 3. Initial provider set (v1 scope)

The first cut ships four providers, in this order of implementation:

1. **`env`** — reads a named process environment variable. Simple, CI-friendly,
   and explicitly marked as unmanaged provenance.
2. **`file` / native vault** — a RoleCall-native encrypted YAML map. Format:
   - AES-256-GCM with a fresh random 96-bit nonce per encryption.
   - scrypt-derived 256-bit key (minimum `N=2^15`, `r=8`, `p=1`) with a 32-byte
     random salt. Parameters are stored in the envelope and authenticated as AAD.
   - Versioned JSON envelope carrying `version`, `kdf`, KDF parameters, `nonce`,
     and `ciphertext`; AAD binds the envelope metadata.
   - Password source: `--vault-password-file`, `--ask-vault-pass` (TTY only), or
     `ROLECALL_VAULT_PASSWORD` / `ROLECALL_VAULT_PASSWORD_FILE`. The password is
     never written to disk by RoleCall.
3. **`ansible-vault`** — **read-only** compatibility in v1. Detect the
   `$ANSIBLE_VAULT;1.1;AES256` / `1.2;AES256[;<vault-id>]` header, derive key
   material with PBKDF2-HMAC-SHA256, decrypt AES-256-CTR, and verify the
   HMAC-SHA256 before parsing. Cross-check against `ansible-vault` fixtures in the
   test suite. Writing Ansible Vault files is out of scope for v1; new vaults use
   the native AEAD format.
4. **`command`** — an explicitly configured command alias, not an arbitrary
   per-ref shell string. Example config:

   ```yaml
   providers:
     one-password:
       kind: command
       argv:
         - op
         - read
         - "op://prod/db/password"
       timeout_ms: 5000
   ```

   Execution rules: `spawn` with an argv array (never a shell), a fixed binary
   path or a PATH allowlist, no secret values in argv, a short timeout, and
   stderr captured but masked. The command provider is an unmanaged source by
   provenance and is disabled in strict mode unless the project explicitly
   allows it.

HashiCorp Vault, AWS/GCP/Azure secret managers, SOPS, OS keychains, and
Kubernetes/Docker/systemd file mounts are **not** in v1. The provider interface
and the command adapter make them addable without changing the `$secret`
surface. SOPS is a strong candidate for a file-format/provider follow-up because
it fits the git-friendly model (ADR 0004).

### 4. Provider chain and fallback policy

A `$secret` reference resolves against exactly one provider unless the project
declares an ordered chain. There is **no implicit global env fallback**.

Resolution semantics:

- A ref with `provider` uses that provider only. If it is unavailable, the task
  fails; no other provider is tried.
- A ref without `provider` walks the declared chain in order.
- Fallback happens only on a structured **`not_found`** result. Authentication
  failures, network errors, timeouts, malformed ciphertext, and provider crashes
  are **fatal** and stop resolution. They never fall through.
- Every fallback is recorded as a non-secret audit event: provider name, ref
  name, outcome, and whether the source is `managed` or `unmanaged`.
- The resolved value carries provenance (`managed` | `unmanaged`). Chain
  metadata is available to the masked logger but never to module output.
- `--strict-secrets` (and serve mode by default, unless the project opts in)
  rejects unmanaged providers. `env` and `command` are unmanaged; `file` native
  and `ansible-vault` are managed.
- If no provider produces a value, the task fails before the module runs. There is
  no empty-string or `undefined` fallback.

#### Security risk of falling back to an unmanaged source

Yes, this is a real risk and is why the default is no implicit fallback. The
specific hazards:

- **Source confusion / injection.** An attacker who can set environment
  variables, modify `PATH`, or drop a user-local config can satisfy a reference
  that was meant to come from the managed vault. The task succeeds with
  attacker-chosen data.
- **Fail-open on outage.** If the vault is unreachable or the credential is
  rotated, a fallback to a stale env/command value hides the outage and may run
  against the wrong environment.
- **Cross-environment reuse.** A CI or developer environment often contains a
  secret for a different environment. Implicit fallback can silently use the
  wrong one.
- **Lost audit and rotation guarantees.** Unmanaged sources have no lease,
  version, or audit trail; a secret that should have been rotated can persist
  indefinitely.
- **Broader exposure.** Env vars are visible to child processes, crash dumps, and
  process inspection; command output can land in logs.
- **Code execution.** A command or plugin provider is executable code. A fallback
  to an attacker-controlled provider is equivalent to arbitrary code execution
  with access to the other providers' context.
- **Masking cannot restore trust.** Masking prevents display leaks; it does not
  make an untrusted value safe to use.

The mitigations are the policy above: explicit chains, `not_found`-only fallback,
fatal provider errors, provenance tagging, audit events, strict mode, and a
server default that denies unmanaged sources unless the project opts in.

### 5. Resolution lifecycle and the `SecretRegistry`

The executor owns a per-run registry:

1. `renderArgs` encounters a `$secret` node.
2. A `SecretResolver` (injected through `ExecOptions` / run scope, ADR 0017)
   resolves it through the provider.
3. The raw value is placed in the rendered args.
4. The value is added to the `SecretRegistry`.
5. The registry is never serialized, stored, or logged.

The registry is also used by child-run mode: the forked child resolves and masks;
the parent applies `redact()` again before persisting status or traces. Raw values
never cross the `jsonl` boundary.

### 6. Masking rules

Masking is a boundary concern, independent of `no_log`:

- Apply a deep `redact()` to module `msg`, `stdout`, `stderr`, `data`, every
  `iterationData` entry, rendered `$template` output, `--diff` patches, trace
  `detail`, run outcomes, HTTP response bodies, and error strings.
- Mask exact occurrences of registered values with a minimum length (default 4).
  For shorter values, redact the whole field and emit a warning instead of
  corrupting unrelated output.
- `no_log: true` remains the stronger switch: it drops the fields entirely.
- Tasks that resolve secrets are excluded from the idempotency cache by default,
  or may cache only a salted hash of the rendered args. The cache must never
  store a raw secret or an observed value derived from one.
- `SecretRef` names are safe to log; values are not.

### 7. CLI, config, and serve behavior

CLI/env surface:

- `--vault-password-file <path>`
- `--ask-vault-pass` (TTY only)
- `--secrets-config <path>` (default `.rolecall/secrets.yaml`)
- `--strict-secrets`
- `ROLECALL_VAULT_PASSWORD`, `ROLECALL_VAULT_PASSWORD_FILE`,
  `ROLECALL_SECRETS_CONFIG`, `ROLECALL_STRICT_SECRETS`

Serve mode:

- Each run is already forked (ADR 0017); the child resolves secrets and emits only
  masked events/result lines.
- The parent redacts before writing traces or `/runs/:id/status`.
- The `POST /run` body may carry `$secret` refs, but never raw secret values.
- Serve defaults to strict secrets: unmanaged providers are denied unless the
  project's `.rolecall/secrets.yaml` explicitly allows them.
- Provider credentials come from ambient identity (env, IAM role, service-account
  file, Vault token), never from the job body.

**Credential scoping and transport trust:**

- **Per-target scope.** Credentials are resolved per run and connection profile, never as a
  single global vault unlock. Use separate keys per environment and do not reuse a
  personal/agent key across targets.
- **Short-lived and rotated.** Prefer short-lived/STS-style credentials or per-run keys, and
  support rotation. The resolver is injected through `ExecOptions`/run scope (ADR 0017), so
  the raw value stays inside the run.
- **Transport trust.** SSH strict host-key checking is on by default (`known_hosts`), agent
  forwarding is off by default, and TLS verification is never disabled behind an implicit
  flag. Any `--insecure`/skip-verify path is explicit, warned, and traced.
- **Child env allow-list.** Forked children receive an explicit environment allow-list, not
  `process.env`, so the serve token, vault password, and unrelated credentials never reach
  module subprocesses.
- **Credential broker (open work).** A future broker mints and scopes target credentials per
  run; until it lands, per-environment files/keys plus the defaults above are the boundary.

### 8. Non-goals

- RBAC for the orchestrator.
- Secret rotation, lease management, or dynamic credentials in v1.
- A full HashiCorp Vault SDK, cloud secret-manager SDKs, or SOPS integration in
  v1.
- Writing Ansible Vault files in v1.
- Secret values in `when`/`loop` predicates.
- A management CLI (`secrets init/set/get`) in v1; the vault is operator-managed.

## Alternatives considered

- **Implicit env fallback** — rejected. Convenient, but it is exactly the
  fail-open/source-confusion hazard described in §4. Env remains available, but
  only as an explicitly declared provider/chain entry.
- **Ansible Vault only** — rejected as the sole format. It offers compatibility
  but uses a custom AES-CTR/HMAC format with no AAD and weaker KDF defaults. It
  remains a read-only compatibility adapter.
- **SOPS-first** — deferred. SOPS is git-friendly and a good future provider or
  file format, but it is another dependency and format to validate before the
  basic native/env/command path exists.
- **A single `secret://` URI syntax** — rejected. The `$secret` operator composes
  with the existing structured-ref system and fails closed without string parsing.
- **Resolve secrets during inventory/var loading** — rejected. It would put raw
  values into `vars`, making masking and trace safety much harder.

## Consequences

- New templating operator and executor plumbing (`ExecOptions`, `RunState`,
  `SecretRegistry`).
- New plugin type (`secret_providers`) and project config
  (`.rolecall/secrets.yaml`).
- New crypto surface in the PAL/`node:crypto` seam for scrypt + AES-GCM; Ansible
  Vault adds PBKDF2/AES-CTR/HMAC.
- More test vectors and cross-runtime tests (Bun + Node), including
  `ansible-vault` fixtures.
- Documentation and four-surface sync (AGENTS/README/design/docs) must describe
  the provider chain, strict mode, and masking rules.

## Work items

1. Add `$secret` to `src/templating/refs.ts` and thread a `SecretResolver` through
   `renderArgs` / `ExecOptions` / `RunState` (ADR 0017 run scope).
2. Implement `SecretRegistry`, `redact()`, and masking at every result/output/
   trace boundary.
3. Implement the native vault format and scrypt/AES-GCM crypto under the PAL.
4. Implement the `env` provider.
5. Implement the read-only `ansible-vault` adapter and fixtures.
6. Implement the argv-safe `command` provider with timeout/stderr masking.
7. Add the `secret_providers` plugin type and `.rolecall/secrets.yaml` loading.
8. Add CLI flags/env and strict-mode enforcement.
9. Wire serve/child-run masking and parent-side defense in depth.
10. Add tests for fallback semantics (not-found vs fatal), masking, short secrets,
    cache exclusion, and both runtimes.
11. Update AGENTS/README/design/docs and regenerate embedded docs/API.

## Open questions

- Should `command` be disabled by default even outside strict mode, requiring an
  explicit project opt-in?
- Is the masking minimum length 4 sufficient, or should short-secret tasks always
  redact the whole field?
- Should `$secret` be allowed inside `$concat` in v1, or only as a whole value?
- Do we want `rolecall secrets check` (lists refs/providers, never values) in v1?
