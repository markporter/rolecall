# 0023 — Installation layout, config/state separation, and unprivileged service model

- Status: **Proposed**
- Date: 2026-11-01
- Related: [ADR 0002](0002-embed-docs-version-for-single-file-binary.md) (single-file distributable), [ADR 0004](0004-serverless-and-git-friendly.md) / [ADR 0005](0005-io-abstractions-vfs-db-scratch.md) (env-selected backends and home/state roots), [ADR 0014](0014-project-and-plugin-architecture.md) (§8 trust boundary: project plugins are code), [ADR 0015](0015-collections-and-install-commands.md) (the existing meaning of `rolecall install` — revised here), [ADR 0018](0018-dual-runtime-distribution-npm-node-binaries-bun.md) (npm/Bun/binary channels), [ADR 0020](0020-mcp-server-and-tool-surface.md) (additional long-lived server surface), [ADR 0021](0021-remote-git-project-source.md) (remote project cache lives under the state root), [ADR 0025](0025-local-execution-isolation.md) (local isolation policy referenced here), [ADR 0026](0026-remote-execution-confinement.md) (remote targets), [ADR 0027](0027-exposed-orchestrator-api-security.md) (exposed serve)

## Context

RoleCall ships as an npm package, a Bun package, standalone binaries, and a source
checkout (`docs/content/deployment/ways-to-run.md`). What it does **not** ship is an
installer, a config-file convention, or a service manager:

- Deployment is manual: the systemd doc asks the operator to write a unit by hand with
  `ExecStart=/opt/rolecall/dist/bin/rolecall-linux-x64-musl --serve` and a `User=rolecall`
  they must create (`docs/content/deployment/systemd.md`). The Windows doc explicitly says
  "RoleCall ships no built-in Windows service installer" and lists third-party wrappers
  (NSSM/WinSW/Shawl, `docs/content/deployment/windows-service.md`). macOS is undocumented.
- There is no config file. `loadConfig()` reads `process.env` only
  (`src/config/env.ts:84-101`), relying on Bun's cwd `.env` auto-load; Node has no
  equivalent. A system service therefore has no stable, documented place to put its
  listen address, DB URL, project source, or auth token short of hand-editing a unit.
- Paths are ad hoc: state lives at `~/.rolecall/state.db` with `ROLECALL_HOME` and
  `ROLECALL_PROJECT_STATE` overrides (`src/store/store.ts:5-8,95-99`), plugins at
  `~/.rolecall/plugins.json` (`src/store/plugin-store.ts:33-39`), scratch under the OS
  temp dir, and nothing is split by mutability. No XDG/Windows/macOS conventions are used
  anywhere in `src/`.
- Privilege is undefined. Any user (including root) can run `--serve`; there is no
  service account, no permission model for binary/config/state, and no guard against a
  root-owned server. The serve auth token is a programmatic `ServerOptions.authToken`
  only — `--serve` parses `--port`, `--host`, and `--ui-dist` but not a token
  (`src/orchestrator/serve.ts:98-113`), and the server happily binds a non-loopback
  address without one.
- ADR 0015 already assigns `rolecall install` to "download a pinned Bun runtime into
  `~/.rolecall/runtime/`". That name now collides with the far more common request:
  "install RoleCall itself." This ADR must resolve the collision.
- Every current channel assumes a runtime or package manager is already present: npm and
  Bun global installs need that runtime, and the standalone binaries require the operator
  to pick the right artifact by hand. There is no single `curl … | sh` bootstrap that
  works on a host with no Node, npm, or Bun. The standalone binary already embeds Bun, so
  a separate runtime download is not required; ADR 0015's central-runtime half remains
  unimplemented and is not needed for the binary channel.
- ADR 0014 §8 establishes that project plugins (and JIT-bundled dependencies) are
  executed code. A playbook run is therefore a code-execution event on the control node,
  which is exactly the surface a service model and containment story have to address.

The goal: one consistent install model — **system-wide** (root) and **per-user** — with a
guided installer wizard (full flag parity for automation), a Node-free bootstrap that
installs a **self-contained binary with embedded Bun** (an external toolchain is optional),
config/state separation, service lifecycle, an always-unprivileged runtime, and explicit links to the separate containment/security
decisions (ADRs 0025–0027) that the installer must preflight and the service must permit.

## Decision

### 1. Two install scopes, one layout abstraction

An `InstallLayout` resolves every path from `(platform, scope)`. Scope is `user`
(default) or `system` (root/admin). No command ever guesses: the scope is explicit,
recorded in an install manifest, and later commands read it back.

| Concern | Linux system | Linux user | macOS system | macOS user | Windows system | Windows user |
|---|---|---|---|---|---|---|
| Program (immutable) | `/opt/rolecall` | `~/.local/lib/rolecall` | `/opt/rolecall` | `~/Library/Application Support/RoleCall/lib` | `%ProgramFiles%\RoleCall` | `%LOCALAPPDATA%\Programs\RoleCall` |
| Optional Bun toolchain (`--with-bun`) | `/opt/rolecall/runtime/bun/<ver>` | `~/.local/lib/rolecall/runtime/bun/<ver>` | `/opt/rolecall/runtime/bun/<ver>` | `~/Library/Application Support/RoleCall/lib/runtime/bun/<ver>` | `%ProgramFiles%\RoleCall\runtime\bun\<ver>` | `%LOCALAPPDATA%\Programs\RoleCall\runtime\bun\<ver>` |
| Config | `/etc/rolecall` | `$XDG_CONFIG_HOME/rolecall` (`~/.config/rolecall`) | `/Library/Application Support/RoleCall` | `~/Library/Application Support/RoleCall` | `%ProgramData%\RoleCall` | `%APPDATA%\RoleCall` |
| State (mutable, durable) | `/var/lib/rolecall` | `$XDG_STATE_HOME/rolecall` (`~/.local/state/rolecall`) | `/Library/Application Support/RoleCall/state` | `~/Library/Application Support/RoleCall/state` | `%ProgramData%\RoleCall\state` | `%LOCALAPPDATA%\RoleCall\state` |
| Cache / scratch | `/var/cache/rolecall` | `$XDG_CACHE_HOME/rolecall` (`~/.cache/rolecall`) | `/Library/Caches/RoleCall` | `~/Library/Caches/RoleCall` | `%ProgramData%\RoleCall\cache` | `%LOCALAPPDATA%\RoleCall\cache` |
| PATH entry | `/usr/local/bin/rolecall` symlink | `~/.local/bin` | `/usr/local/bin/rolecall` symlink | `~/.local/bin` | `%ProgramFiles%\RoleCall\bin` | `%LOCALAPPDATA%\Programs\RoleCall\bin` |

The program directory is **root/admin-owned and not writable by the service user**; config
is root-owned but readable by the service account; state and cache are owned by the
service user. This is the privilege separation the rest of the model depends on.

**Backward compatibility:** the existing `~/.rolecall` layout is still honored. The
resolver uses the first of: explicit `--state-dir`/`ROLECALL_PROJECT_STATE` →
`$XDG_STATE_HOME/rolecall` → `~/.rolecall` (if it already exists) → create the XDG path.
A one-time `rolecall install --migrate` moves `state.db`/`plugins.json` and leaves a
note; it is never automatic. `ROLECALL_HOME` keeps its documented meaning as the
user-home override.

### 2. A config file, read on both runtimes

Config becomes a real file instead of ambient environment:

- Format: `rolecall.env` — `KEY=VALUE` lines, `#` comments, the same `ROLECALL_*` names
  `loadConfig()` already reads. No new parser dependency, and the 12-factor env model is
  preserved (the file is loaded into the same typed `Config`).
- Location: the scope's config dir from §1, overridable with `ROLECALL_CONFIG`.
- **Precedence (low → high):** system `rolecall.env` → user `rolecall.env` → project
  `<project>/.rolecall/rolecall.env` → process environment → CLI flags. Service managers
  may also inject env directly; process env always wins over files.
- `loadConfig()` gains a `readRuntimeConfig()` step that parses the resolved file with
  `node:fs` on **both** runtimes (no reliance on Bun's cwd `.env` auto-load). Missing files
  are not an error.
- Permissions: `0600` for user config; `0640` root:`rolecall` (or equivalent) for system
  config. The installer sets them, `rolecall doctor` verifies them.
- Secrets (service Bearer token, DB URL, git credentials) live in this file, not in unit
  files or shell history. The service unit points at it; logs redact values.

### 3. Command surface

`rolecall install` becomes the **self-installer/manager**; ADR 0015's Bun bootstrap is
renamed `rolecall runtime install` and demoted to an **optional toolchain** (still
unimplemented; ADR 0015 is revised only in naming, not in its runtime-vs-project-hydration
split).

```
rolecall install [--system|--user] [--prefix DIR] [--config-dir DIR] [--state-dir DIR]
                 [--user ACCOUNT] [--no-service] [--add-to-path|--no-add-to-path]
                 [--with-bun [--bun-version X]] [--version X] [--offline] [--from-dir DIR]
                 [--interactive|--non-interactive|--yes] [--dry-run] [--force] [--migrate]
rolecall uninstall [--system|--user] [--purge]
rolecall update --check [--json]
rolecall update [--version X] [--channel stable|pre] [--from-dir DIR] [--offline]
                [--yes] [--dry-run] [--force] [--no-restart] [--rollback]
rolecall service install|uninstall|start|stop|restart|status [--system|--user]
rolecall --serve [--exposed] [--port N] [--host H] [--ui-dist DIR]
rolecall runtime install|status|remove [--system|--user] [--bun-version X]
rolecall isolation allow <source> [--target DIR] [--ro|--rw] [--project DIR] [--from-request]
rolecall isolation revoke <source> [--project DIR]
rolecall isolation allow-egress <host> [--port N] [--project DIR] [--scope shell|module|all]
rolecall isolation revoke-egress <host>[:port] [--project DIR]
rolecall isolation list [--project DIR] [--explain] [--egress]
rolecall doctor
```

- First install still needs a bootstrap because `rolecall` does not exist yet:
  `install.sh` / `install.ps1` (§4). They are Node-free: download the release artifact
  for the host, verify its checksum, place it, and invoke `<binary> install` to finish
  layout/config/service. The binary embeds Bun (§5), so there is no separate runtime to
  fetch. OS packages (deb/rpm, MSI/pkg) are wrappers around the same layout and call
  `rolecall service install`. The self-installer is for configure/upgrade/repair, not the
  initial fetch.
- Bare `rolecall install` starts the interactive wizard (§6) when it has a terminal.
  Flags pre-answer and skip their prompts, and `--non-interactive` is the complete
  automation contract: the wizard and the flags build the same `InstallPlan`.
- `install` does **not** install a separate Bun runtime by default; the binary embeds it
  (§5). `--with-bun` opts into a standalone toolchain (with optional `--bun-version`), and
  `rolecall runtime install|status|remove` manages only that optional toolchain.
- `install` is idempotent and writes an install manifest (scope, RoleCall version,
  `runtime: embedded` or the optional Bun version, paths, service account) into the config
  dir so `service`/`uninstall` do not need re-specification.
- Upgrades are atomic: `/opt/rolecall/versions/<ver>/` plus a `current` symlink, switched
  only after the new binary passes `<bin> --version`; an optional external Bun toolchain
  has its own versioned directory, and the service restarts after the swap. Uninstall keeps
  config/state unless `--purge`.
- `rolecall isolation allow|revoke|list` manages the per-project filesystem grants, and
  `isolation allow-egress|revoke-egress|list --egress` manages the destination whitelist
  described in ADR 0025. `playbook run` gains `--isolation` (default `auto`),
  `--isolation-network` (default `module`), repeatable `--mount src:dst[:ro|rw]`,
  one-off `--allow-egress host:port`, and the explicit unsafe
  `--allow-unsafe-template-code` last resort for Jinja/code templates when no backend is
  available.

### 4. Node-free bootstrap: `install.sh` / `install.ps1`

The entrypoints are published at stable URLs and must work on a host with **no Node, npm,
Bun, or git**:

```sh
curl -fsSL https://raw.githubusercontent.com/markporter/rolecall/main/install.sh | sh
```

```powershell
irm https://raw.githubusercontent.com/markporter/rolecall/main/install.ps1 | iex
```

- `install.sh` is POSIX `sh` (not bash-only) and uses only standard host tools: `uname`,
  `curl` or `wget`, `tar`/`unzip`, and a SHA-256 tool (`sha256sum`/`shasum`/`openssl`).
  `install.ps1` uses stock PowerShell (`Invoke-WebRequest`, `Get-FileHash`,
  `Expand-Archive`). Neither invokes npm, npx, node, or bun to bootstrap.
- The script detects OS/arch, selects the release artifact (the static Linux musl binary,
  the macOS binary, or the Windows exe per ADR 0018), downloads the release checksum
  manifest, and **verifies SHA-256 before executing anything**. A mismatch or missing
  checksum is fatal; there is no `--insecure` bypass.
- Scope defaults to **system when run as root/Administrator, user otherwise**. Flags pass
  through: `--system`/`--user`, `--prefix`, `--state-dir`, `--no-service`,
  `--add-to-path`, `--with-bun`/`--bun-version`, `--version`, `--from-dir`.
- The script only bootstraps: it puts the binary (and, only if requested, the optional Bun
  toolchain, §5) in the layout, then executes
  `<binary> install --apply-bootstrap …` so the actual layout/config/service policy lives in
  tested TypeScript, not shell. Package managers (deb/rpm/MSI/pkg) run the same second
  stage from their post-install step.
- **Air-gapped:** `--from-dir DIR` installs from a pre-populated directory (the binary,
  optionally the Bun toolchain, and the checksum manifest) with no network access.
- **No hidden elevation:** system scope must already be root/Administrator; the script
  never calls `sudo`. Running it as a normal user yields a user-scope install.
- **Trust note:** piping a remote script to a shell is a real risk. The docs present the
  download-inspect-run form as the default recommendation; release artifact checksums (and,
  when available, signatures) are the actual trust anchor.

### 5. The binary is the runtime; no separate Bun install by default

The released native binary is built with `bun build --compile`, which **embeds the Bun
runtime** (ADR 0002/0018). Downloading that one artifact over `curl`, verifying its
checksum, and running it is sufficient: there is no Node, npm, or external Bun prerequisite
to start RoleCall.

- **The binary is not a general `bun` CLI.** It runs the RoleCall entrypoint; it does not
  expose `bun build`, `bun install`, or arbitrary script execution. "Use the binary as the
  runtime" means "RoleCall needs no other runtime," not "you get a Bun toolchain."
- **Runtime capabilities are embedded.** Verified experimentally on Linux x64 with
  `bun build --compile` (Bun 1.3.14): the compiled executable retains the `Bun` global, can
  dynamically `import()` a `.ts` file from disk, and exposes `Bun.build`. That covers today's
  `.ts` project-plugin loading (the loader imports
  directly; see `src/modules/loader.ts`) and means a future JIT bundler should call the
  **in-process `Bun.build`**, never shell out to an external `bun`.
- **Add a regression guard.** Because this is a capability we rely on, the binary build
  should assert (in `scripts/` CI smoke) that a compiled artifact can import a `.ts` fixture
  and sees `Bun.build`. A future Bun change that drops either must fail the build, not
  surface as a broken plugin load in production.
- **npm/Node channel is separate.** `lib/cli.js` runs on Node >=22.19 and embeds nothing.
  The current loader cannot import `.ts` without a Bun loader, so TS project plugins require
  the native binary (or `.js`/`.mjs` plugins on Node). This is a channel difference, not a
  reason to install Bun for the binary channel.
- **No JIT bundling exists yet.** ADR 0014's `_bundled.js`/JIT design is not implemented;
  today the loader imports source directly. When it lands, it uses the embedded runtime's
  API (or a JS bundler on the Node channel); an external Bun binary is not the plan.

**Optional standalone Bun (`--with-bun`):** an operator who wants source-mode development,
`bun install`, or a general Bun toolchain can opt in. It is not installed by default, is not
added to PATH unless `--add-bun-to-path` is given, and lives in a versioned directory under
the prefix. `rolecall runtime install|status|remove` manages that optional toolchain;
`status` reports `embedded` when no external runtime is present. Offline installs and OS
packages ship the single binary; there is no Bun archive to vendor.

### 6. Interactive installer wizard

`rolecall install` is a **guided wizard by default**, not a flags-only command. The wizard
is a thin front-end over the options in §3: every prompt has a flag, and every flag that
is supplied skips its prompt, so the same `InstallPlan` drives both paths and they cannot
drift.

**Trigger and terminal handling**

- Bare `rolecall install` starts the wizard when stdin and stdout are TTYs.
  `--interactive` forces it (and errors if there is no TTY); `--non-interactive`, `--yes`,
  `CI=1`, or `ROLECALL_NONINTERACTIVE=1` disables it and uses flags/defaults.
- Because the recommended entrypoint is `curl … | sh`, the shell pipeline owns stdin.
  `install.sh` re-attaches the wizard to the **controlling terminal** (`/dev/tty` on
  POSIX, `CONIN$`/`CONOUT$` on Windows) before execing `<binary> install`. If no
  controlling terminal exists (containers, unattended CI), it passes
  `--non-interactive` and relies on flags/defaults rather than hanging.
- Prompts are plain numbered choices with defaults (no full-screen TUI, no mandatory
  arrow keys), read through a small `node:readline/promises` layer, and colored only on a
  TTY with `NO_COLOR` unset.

**Wizard flow** (safe defaults in parentheses)

1. **Existing install?** If the manifest exists: action menu — reconfigure / upgrade /
   repair / uninstall — with current values as defaults. (Fresh install when none.)
2. **Scope:** user or system; default system when already root/Administrator, else user.
   Choosing system explains that it requires root and creates a service account.
3. **Service** (system scope): install the service? start now? enable at boot? choose or
   create the non-root account. For user scope the wizard only handles PATH; a user-level
   supervisor is future work.
4. **Listen address:** host and port (default `127.0.0.1:8080`). A non-loopback host
   requires a token; the wizard **generates** a random token and shows it once rather than
   asking the user to type a secret.
5. **Optional Bun toolchain:** install a standalone Bun (default **no**; the binary already
   embeds the runtime). If chosen, show the version/download size with an optional override.
6. **PATH:** add the install bin directory to the user PATH (default yes for user scope;
   system scope uses the symlink).
7. **Advanced paths:** prefix/config/state/cache overrides, hidden behind a "customize
   paths?" question (defaults from §1).
8. **Summary and confirm:** print the resolved plan (scope, paths, RoleCall version plus
   optional toolchain, service, account, listen, auth) and apply only on an explicit yes.
   The confirmation defaults to **no**.

**Safety and idempotency**

- Answers are collected and validated first; nothing is written until the final confirm.
  Ctrl-C/EOF aborts with no changes.
- Re-running is idempotent: existing manifest values become the defaults; upgrades reuse
  them unless the user chooses to reconfigure.
- Destructive choices (purge, overwrite config, create a system account) default to no.
- The wizard never escalates privileges: system scope must already be root, and the
  service is started as the chosen account by the supervisor.
- `--dry-run` prints the same resolved plan without applying it, interactively or in CI.

**Testing**

- Prompt I/O is injected (`PromptIo`: input/output streams plus a TTY flag), so wizard
  tests are deterministic and need no terminal.
- `--non-interactive` is the contract CI and OS packages exercise; the wizard and the
  flag path share the `InstallPlan` builder, and tests assert both produce identical
  plans for equivalent answers.

### 7. Service lifecycle and the service account

`rolecall service install` registers a native supervisor per platform:

- **Linux:** a systemd unit (`ExecStart=<prefix>/current/bin/rolecall --serve`,
  `User=<account>`, `EnvironmentFile=<config>/rolecall.env`, `Restart=always`) plus a
  hardening baseline: `NoNewPrivileges=yes`, `PrivateTmp=yes`,
  `ProtectSystem=strict`, `ProtectHome=yes` (with explicit `ReadWritePaths=` for
  state/cache and `ReadOnlyPaths=` for project dirs), `ProtectKernelTunables=yes`,
  `ProtectControlGroups=yes`, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`,
  empty `CapabilityBoundingSet`, `UMask=0077`. Default port stays `8080`; binding a
  privileged port requires an explicit `AmbientCapabilities=CAP_NET_BIND_SERVICE` opt-in
  (TLS termination belongs in a reverse proxy).
- **macOS:** a LaunchDaemon plist (`UserName=<account>`, `RunAtLoad`, `KeepAlive`) reading
  the same config file; logs to the unified log.
- **Windows:** a service registered through the SCM (`sc.exe create`) running a shipped
  service host shim, with `--user` required to name a dedicated low-privilege account or
  the virtual `NT SERVICE\RoleCall` account where available. No third-party wrapper is
  required or endorsed. A native SCM host is a work item; until it lands, the Windows doc
  keeps pointing at a wrapper, labeled unsupported.

**Account selection (global install):**

- `--user <account>` selects the runtime account. It must be non-root/Administrator;
  `rolecall install` rejects `root`, `SYSTEM`, `LocalSystem`, and Administrator with a
  usage error.
- With no `--user`, Linux/macOS create a system account `rolecall` (no login shell, home
  set to the state dir) and use it. The installer reports the chosen account and refuses
  `--user root` even with `--force`.
- The service user gets its own `~/.ssh`/known-hosts material under the state dir; it
  never borrows root's keys. The installer prints the exact path for the operator to
  install credentials into.
- `rolecall service install` refuses to proceed if the unit would run as root, and
  `rolecall --serve` refuses to start as uid 0 (or an elevated Windows token) unless
  `ROLECALL_ALLOW_ROOT=1` is set explicitly. Running the CLI as root remains possible
  for one-shot commands but prints a warning.

### 8. Upgrades and self-update

There is **no self-update today**: npm/Bun installs are upgraded with their package
manager, and binary installs are re-downloaded by hand. The versioned layout above
(`versions/<ver>/` + `current`) is the foundation, but nothing drives it. Add an explicit,
operator-run update path.

**Command surface**

```
rolecall update --check [--json]
rolecall update [--version X] [--channel stable|pre] [--from-dir DIR] [--offline]
                [--yes] [--dry-run] [--force] [--no-restart] [--rollback]
```

- `update --check` is read-only: prints current/latest/channel/artifact and exits non-zero
  when an update exists. It never downloads or installs.
- `update` is interactive (confirm) unless `--yes`, supports `--dry-run`, and is **never
  exposed over the HTTP API** (ADR 0027). It is an operator action, not a webhook.
- `--rollback` switches `current` back to the previous retained version.
- Add `rolecall update` to `GLOBAL_OPTS`/HELP; the wizard's "upgrade" action calls the same
  plan builder.

**Install-kind awareness**

The install manifest records `kind` (`binary`, `npm`, `bun-global`, `os-package`), scope,
prefix, channel, and update URL. Update behaves accordingly:

- `binary` (the installer channel): full self-update.
- `npm` / `bun -g`: do not mutate `node_modules`; print (or run with explicit `--yes`) the
  package manager command, e.g. `npm i -g @rolecall/cli@<ver>`.
- `os-package`: delegate to apt/dnf/brew/MSI; never replace package-owned files behind the
  package manager's back.

**Source and trust**

- Default source is the project's release metadata (version manifest + per-platform
  artifact + checksums) with **signature verification** (minisign/cosign or equivalent).
  `ROLECALL_UPDATE_URL` / `--update-url` supports internal mirrors and air-gapped setups.
- Never trust a mutable "latest" without verifying the signed checksum manifest, and never
  execute the downloaded artifact before verification. After verification, run
  `<newbin> --version` as a smoke check.
- `--channel stable|pre` (default `stable`) with semver comparison. Downgrades require an
  explicit `--version` **and** `--allow-downgrade`; no silent downgrade.
- `--from-dir` / `--offline` installs from a pre-downloaded, checksum-verified artifact.

**Atomic apply, restart, and rollback**

- Download to the same filesystem, verify, install into `versions/<ver>/`, then flip
  `current` atomically; retain the previous N versions for rollback.
- Stop/drain the service, swap, restart, and health-check (`/health` or `--version`); on
  failure, automatically switch back to the previous `current` and report. `--no-restart`
  leaves the service untouched for manual control.
- systemd/launchd/SCM each provide stop/start hooks; user-scope installs use the user
  service or require a manual restart. Running CLI processes keep the old inode; only new
  invocations and restarted services see the new version.

**State and config compatibility**

- Check the state DB schema version before the swap and take a backup (SQLite backup or a
  copy beside the live DB). Refuse an upgrade that needs an unsupported migration unless
  the operator passes `--force` after acknowledging the backup.
- Refuse a downgrade that would run a newer state schema unless `--allow-downgrade`.
- Config files are additive and unknown keys are preserved; project files, plugins, and
  `isolation.yaml` are untouched. An optional `--with-bun` toolchain is updated separately;
  the embedded runtime updates with the binary.

**Release integrity (ADR 0028 §3)**

- The release pipeline publishes an **SBOM** and signed checksums; where feasible the build
  is reproducible, and `rolecall update` verifies the manifest before executing anything.
- CI runs a dependency audit (lockfile + `npm audit` or equivalent), pins build tools, and
  fails on an unexpected runtime/native dependency.
- Signing keys have a documented rotation and revocation path; `rolecall doctor` reports the
  key/artifact state for the installed version.
- These are pipeline work, not installer code, but install/update must not be considered
  complete without them.

**Notifications and non-goals**

- No telemetry or phone-home by default. `update --check` is on demand; `doctor` may include
  a cached check when `ROLECALL_UPDATE_CHECK=1` or `doctor --check-updates` is set.
- No background auto-update daemon and no auto-install. Deployments that want that run
  `rolecall update` from their own scheduler/CI, which is explicit and auditable.
- Update is not a remote API: cron/webhook/MCP callers cannot trigger it.

**Testing**

- `--check` semver/channel/downgrade parsing; checksum/signature failure aborts before
  execution; atomic swap with rollback on failed restart; service stop/start; offline
  `--from-dir`; install-kind delegation; state-schema guard; no update route in `--serve`.

### 9. Always unprivileged, and never expose an unauthenticated server

- The binary is root-owned; the service user can read but not modify it (§1).
- Config is read-only to the service; state is writable only by the service.
- **Non-loopback binding requires auth and the exposed profile.** `rolecall --serve` must
  refuse to bind a non-loopback address unless a Bearer token is configured (config
  file/env) **and** `--exposed` is set; the restricted profile and the full threat model
  are in ADR 0027. The current server accepts an optional token and otherwise leaves triggers
  open (`src/orchestrator/routes.ts:39-40`, `src/orchestrator/serve.ts:98-113`). `service
  install --system` generates a random token into the config file if none exists and
  prints it once. A `--allow-anonymous` escape hatch exists for tests only and is
  documented as unsafe.
- The `install` command never elevates the running process: it performs privileged
  file/service steps and then exits; the service is started by the supervisor as the
  chosen account, not as root.

### 10. PATH handling

- System scope installs a `/usr/local/bin/rolecall` symlink (or a package-owned
  `/usr/bin/rolecall`), already on PATH.
- User scope installs into `~/.local/bin` (Linux/macOS) or the per-user program bin
  (Windows) and ensures that directory is on PATH:
  - Linux/macOS: append a marker-delimited block to the detected shell profile
    (`~/.profile`, `~/.zshrc`, `~/.config/fish/config.fish`); `--no-add-to-path` opts out.
  - Windows: update the **user** `Path` environment variable (never the machine-wide one
    in user scope).
- Adding to PATH is idempotent (marker block is replaced, not duplicated) and is reported,
  never silent.

### 11. Security and execution containment (separate ADRs)

This ADR is about installing and operating RoleCall; it deliberately does **not** define
the containment or API-exposure policy. Those concerns were split out so each can change
without rewriting the install contract:

- **[ADR 0025](0025-local-execution-isolation.md)** — local execution isolation: default-on
  `auto` (Linux rootless `bwrap`/`unshare`, else Docker), `none` as a warned last resort,
  filesystem grants, module network capability, and the egress broker/destination whitelist.
- **[ADR 0026](0026-remote-execution-confinement.md)** — remote target confinement: opt-in
  per host (`none` default), what a remote `bwrap`/Docker wrapper can and cannot cover, and
  why target-side policy is the practical answer for general fleets.
- **[ADR 0027](0027-exposed-orchestrator-api-security.md)** — externally reachable
  `--serve`: `--exposed` + mandatory auth, restricted routes/paths/URLs, control-plane SSRF
  policy, process containment, and the gateway/worker split.

The install surfaces still own the prerequisites and defaults:

- **Isolation prerequisites:** local isolation defaults to `auto`, so `rolecall install` and
  `rolecall doctor` preflight `bwrap`/unprivileged userns or a Docker-compatible runtime and
  report the result. This includes `engine: jinja` template rendering, which is code-capable
  and always sandboxed (ADR 0025 §7). The installer must not silently disable isolation; a
  missing backend fails local execution — including Jinja templates — with the guidance in
  ADR 0025. The only escape is the same explicit, warned, traced last resort
  (`--isolation none` plus `--allow-unsafe-template-code`), never a silent fallback.
- **Service permissions:** the systemd/launchd/SCM unit must allow unprivileged namespaces
  or rootless Docker access and expose project/state paths (`ReadOnlyPaths=`/
  `ReadWritePaths=`), while keeping the hardening baseline in §7.
- **Exposure:** a non-loopback `--serve` requires `--exposed` and a token (ADR 0027). The
  installer/wizard asks about bind/exposure, generates a token if needed, and refuses an
  unauthenticated external bind.
- **Remote targets:** installation does not install anything on targets. Remote confinement
  is opt-in and may require `bwrap` or Docker on the target (ADR 0026); the control-node
  installer does not assume it.
- **Config location:** isolation grants, egress entries, and restricted-code approvals live
  in `isolation.yaml` under the config dir defined in §1–§2. Project keys are canonical VFS
  URIs (`file:///abs/path` for local, future schemes for git/S3) so approval follows the
  source transport, not a bare folder path.

### 12. Relationship to ADR 0015

ADR 0015 §7 distinguishes the **central runtime** (`rolecall install` = fetch a pinned Bun
into `~/.rolecall/runtime/`) from **project hydration** (`rolecall collections install`).
This ADR keeps the runtime-vs-project split but revises the command naming:

- `rolecall install` installs RoleCall itself; its runtime is **embedded** in the binary
  (§5), and a standalone Bun is optional (`--with-bun`).
- The optional toolchain entry point is `rolecall runtime install|status|remove`.
- Project hydration (`rolecall collections install`) is untouched.

The runtime half is therefore optional and not required by the binary channel; the broader
`rolecall runtime` surface (source-mode execution, vendored/offline runtime bundles)
remains future work.

## Alternatives considered

- **Rely on OS package managers only (deb/rpm/brew/MSI), no self-installer.** Rejected as
  the sole model: packaging cannot express per-user installs, upgrades from the npm/Bun
  channels, or a uniform `service` lifecycle across all three platforms without tripling
  the surface. Packages stay a supported *bootstrap* channel over the same layout.
- **Keep all config in environment variables / unit files.** Rejected: the current state
  already forces operators to hand-write unit `Environment=` lines, and secrets end up in
  world-readable units or shell history. A permissioned file read on both runtimes is the
  smallest durable fix.
- **Run the service as root and drop privileges per task.** Rejected: the server itself
  parses YAML, imports plugins, and forks children; root at rest means any bug is root.
  Drop to a dedicated account at process start instead.
- **Use literal `chroot` as the containment story.** Rejected: needs root, ignores
  network, and is unavailable on Windows/macOS. A Docker-backed run delivers the intent
  (deny access outside the project) without making the product itself privileged.
- **Ship only Docker as the isolation mechanism.** Rejected for Linux-first production:
  it adds a daemon, an image to pin/pull, and root-equivalent daemon access where a
  rootless namespace needs none of that. bwrap/`unshare` is the cheap default backend on
  Linux; Docker remains the portable fallback.
- **Ship bwrap, Docker, chroot, and platform sandboxes.** Rejected: three-plus mechanisms
  each need their own platform matrix and failure modes. Two (one Linux namespace path
  with two launchers, plus Docker) is the ceiling; `chroot` and OS-specific sandboxes stay
  out until a real need justifies their tests.
- **Broad-mount the host (e.g. all of `$HOME`) instead of grants.** Rejected: it hands
  the playbook every credential and socket on the machine, which makes isolation theater.
  Explicit per-project grants keep the default deny while allowing real workflows.
- **Let a project self-grant paths from its own manifest.** Rejected: a cloned repo could
  expose `~/.ssh` or `/srv` without the operator noticing. Project files may *request*
  access; only the operator's config/CLI can approve it.
- **Disable isolation for runs that need outside files.** Rejected: all-or-nothing turns a
  single edge case into a full host view. Grants add the one path needed without removing
  the boundary.
- **Give the sandbox ambient network and rely on the module list.** Rejected: any
  `command`/`shell`/`script` could then exfiltrate or fetch arbitrary URLs. Per-module
  capability keeps trusted modules working while user shell stays net-off.
- **Block `connect()` with `LD_PRELOAD`/seccomp instead of a network namespace.**
  Rejected: brittle across runtimes and statically linked binaries, and easy to bypass.
  The namespace/`--network none` boundary is the enforcement point.
- **Give every module network, or no module network.** Rejected: the former lets
  third-party plugins exfiltrate; the latter breaks `http`/`get_url`/`git`. Declared and
  approved capabilities split the difference.
- **Keep isolation opt-in (default `none`).** Rejected: the whole point is safe-by-default
  and steering users to modules. The backend is materialized lazily, so remote-only runs
  pay no cost on a host without bwrap/Docker; the explicit `none` opt-out remains for the
  last-resort case.
- **Enforce the whitelist with per-run nftables/iptables.** Rejected: a rootless namespace
  has no route to the host, so a firewall alone cannot allow some destinations without
  privileged networking; Docker would need a different implementation. One egress broker
  works across both backends and keeps the mechanism count down.
- **Require modules for all network and skip the whitelist.** Rejected: some scripts must
  reach one fixed endpoint. The whitelist is the narrow escape valve that avoids disabling
  isolation for the whole run.
- **Put state under `/opt` alongside the binary.** Rejected: it mixes immutable and
  mutable data, forces the binary directory to be writable by the service (removing the
  tamper barrier), and breaks package-managed upgrades.
- **Bootstrap through npm (`npx @rolecall/cli`) or an existing Bun.** Rejected as the
  default: both require exactly the runtime the user may not have. Downloading the
  standalone artifact is the only Node-free path; npm/Bun stay optional channels.
- **Download Bun and run RoleCall from source (`bun install -g`).** Rejected as the
  default: a global package layout is harder to keep atomic, versioned, and offline, and
  leaves a runtime resolution graph. The self-contained binary is smaller and deterministic.
- **Install a separate Bun runtime by default.** Rejected: the binary already embeds Bun,
  including dynamic `.ts` import and `Bun.build`, so a second download/supply-chain artifact
  adds skew without adding capability. `--with-bun` remains the explicit opt-in.
- **Treat the compiled binary as a general Bun CLI.** Rejected: it runs the RoleCall
  entrypoint only; it cannot replace `bun install`/`bun build`/arbitrary script execution.
  Operators who need that toolchain opt into `--with-bun`.
- **Ship a full-screen TUI or add `@clack/prompts`/`inquirer`.** Rejected: a new runtime
  dependency and stylized TUI for an eight-question flow, with accessibility and
  dual-runtime cost. `node:readline/promises` is built into both runtimes; plain numbered
  prompts suffice.
- **Prompt from `install.sh` instead of the binary.** Rejected: it duplicates validation
  in shell, fights the `curl | sh` stdin pipe, and cannot share the `InstallPlan` with the
  flag path. The script reattaches the terminal and delegates to `<binary> install`.
- **Make the wizard the only install path.** Rejected: CI, containers, and OS packages
  must run unattended. The wizard is a front-end; flags remain the complete contract.

## Consequences

**Positive**
- One documented install model with explicit paths on Linux, macOS, and Windows, for both
  root and per-user installs.
- Config/state/cache separation gives package upgrades, backups, and purge a clean
  boundary, and fixes the Node "no cwd `.env` auto-load" inconsistency.
- A native service lifecycle replaces hand-written units and third-party Windows wrappers.
- The runtime is unprivileged by construction, with a root-owned binary and a
  least-privilege state directory.
- Non-loopback serving is authenticated by default once the installer generates a token.
- A single Node-free `curl … | sh` yields a working RoleCall from one artifact: the native
  binary embeds Bun, so there is no runtime download or runtime-resolver graph.
- The compiled binary retains the embedded runtime's dynamic `.ts` import and `Bun.build`,
  so TS project plugins (and a future JIT bundler) need no external Bun install.
- The wizard makes the safe choices obvious (user scope, loopback, generated token,
  non-root service account) and shows the full plan before anything is written, which
  reduces the most common security misconfigurations.
- Every wizard answer has a flag, so the interactive and unattended installs are the same
  code path and the same documented options.
- One artifact to verify (plus optional signatures) instead of a binary + runtime pair.

**Negative / risk**
- Three platform service backends and a service-host shim (especially Windows) are real
  implementation cost and a long tail of distro/shell quirks.
- Migrating `~/.rolecall` to XDG paths (and keeping a fallback) is user-visible and must
  not lose the state DB or plugins.
- Editing shell profiles on PATH setup can surprise users; the marker/idempotent design
  and `--no-add-to-path` mitigate but do not remove that.
- Privilege separation means operators must provision SSH keys/credentials for the
  service account; forgetting this yields confusing auth failures at run time.
- Refusing non-loopback without a token is a behavior change that can break existing
  deployments; it is the correct default but needs clear messaging in the release notes.
- `curl … | sh` is convenient but encourages running unreviewed remote code; the
  download-inspect-run form, checksums, and optional signatures are mitigations, not a
  guarantee.
- The wizard doubles the UI surface; the shared `InstallPlan` builder prevents drift but
  both paths still need coverage.
- TTY detection and terminal reattachment are fragile across `curl | sh`, containers,
  Windows consoles, and CI; the `--non-interactive` fallback is essential, and unattended
  users must learn the flags.
- A generated token shown once can be lost; the wizard must point at the config file and
  `rolecall doctor` for rotation.
- The npm/Node channel still requires Node >=22.19 and cannot load `.ts` project plugins
  without a Bun loader; those users need the native binary or `.js`/`.mjs` plugins.
- Relying on embedded dynamic `.ts` import and `Bun.build` is a runtime capability; the
  build must regression-test it so a Bun upgrade cannot silently break plugin loading.
- Optional `--with-bun` is another artifact to verify and version when enabled; it must
  stay off by default to avoid the embedded/external skew it was meant to avoid.

## Work items
- [ ] Add `src/install/layout.ts` (`InstallLayout`: platform × scope path resolution, install manifest, legacy `~/.rolecall` fallback)
- [ ] Add `readRuntimeConfig()` to `src/config/env.ts` (env-file parsing on Bun **and** Node, documented precedence, `ROLECALL_CONFIG`), keeping process env highest
- [ ] Add `rolecall install` / `uninstall` / `service` / `runtime` / `doctor` to `GLOBAL_OPTS`/HELP; rename ADR 0015's bootstrap to the optional `rolecall runtime install`
- [ ] Add `src/cli/prompt.ts`: injected `PromptIo` (streams + TTY flag), numbered/default prompts over `node:readline/promises`, `NO_COLOR` handling
- [ ] Implement the install wizard + shared `InstallPlan` builder; add `--interactive` / `--non-interactive` / `--yes` / `--dry-run`; test wizard-vs-flags plan parity and abort-leaves-nothing
- [ ] Add `install.sh` (POSIX `sh`) and `install.ps1`: platform/arch detection, release + checksum fetch, `--from-dir` offline mode, flag pass-through, terminal reattachment (`/dev/tty`, `CONIN$`/`CONOUT$`) with `--non-interactive` fallback, and the `<binary> install --apply-bootstrap` second stage; publish stable raw URLs
- [ ] Add the optional `--with-bun` toolchain install (pinned download + SHA-256, versioned layout, manifest entry) and `rolecall runtime install|status|remove`; `status` reports `embedded` when no external runtime is present
- [ ] Add a compiled-binary smoke test (build + run) proving dynamic `.ts` import and `Bun.build` are available, so a Bun upgrade cannot silently break project plugins or future JIT
- [ ] Add `rolecall update --check|--rollback` and update apply: install-kind detection (binary/npm/bun-global/os-package), signed release manifest + checksum/signature verification, semver/channel/downgrade guard, `--from-dir`/offline, and `--dry-run`
- [ ] Atomic update apply: download+verify into `versions/<ver>`, flip `current`, stop/start the service, health-check and auto-rollback; state-schema backup/guard before the swap
- [ ] `doctor --check-updates` / `ROLECALL_UPDATE_CHECK=1` cached check (no telemetry, no auto-install); ensure no update route exists in `--serve`
- [ ] Linux systemd backend: hardened unit, account creation/selection, environment file, atomic version symlink + restart
- [ ] macOS LaunchDaemon backend and Windows SCM backend (service host shim); mark the wrapper path unsupported in `docs/content/deployment/windows-service.md` until it lands
- [ ] PATH integration per scope/platform (idempotent marker blocks; Windows user `Path`)
- [ ] Serve hardening: non-loopback requires `--exposed` **and** a token (ADR 0027); installer generates one; root/elevated start guard (`ROLECALL_ALLOW_ROOT`); `SIGTERM` drain already exists
- [ ] Installer/`doctor` preflight for the local isolation backend (`bwrap`/userns or Docker) and service namespace/rootless-Docker access; never silently disable isolation (ADR 0025)
- [ ] Wizard/service exposure prompt: ask about bind/exposure, generate a token, refuse non-loopback without `--exposed`; installation touches no remote target (ADRs 0026/0027)
- [ ] Contract tests per platform in CI where available (path resolution, config precedence, idempotent install, uninstall-preserves-state, non-root guard), a **bare-host** test proving `install.sh` needs no Node/npm/Bun, an air-gapped `--from-dir` test, and dual-runtime tests per ADR 0018
- [ ] Four-surface sync once implemented: `AGENTS.md` (commands/status), `README.md`, `design/` (this ADR + `design/README.md` map, `vfs-and-io-abstractions.md` env/paths, `goals.md`), `docs/` (install, systemd, Windows service, macOS, security/privilege chapter)

## References
- `package.json` (`bin`, `engines`, `files`), `scripts/build-bin.mjs` (`bun build --compile`, which embeds the runtime), `scripts/build-js.mjs` (Node bundle), `docs/content/deployment/{ways-to-run,systemd,windows-service,native-binaries}.md`, `docs/content/guide/install.md`
- `src/modules/loader.ts` (direct `.ts`/`.js` import; TS depends on the Bun loader), `src/util/runtime.ts` (`detectRuntime`)
- `src/config/env.ts:84-101` (process-env-only config), `src/store/store.ts:5-8,95-99` (state precedence), `src/store/plugin-store.ts:33-39` (`~/.rolecall` global root)
- `src/cli/index.ts` (`parseArgs` + HELP: the flag surface the wizard must mirror; there is no prompt dependency today), `node:readline/promises` (the built-in prompt layer, available on Bun and Node)
- `src/orchestrator/serve.ts:98-113` (`--serve` flag parsing; no token flag), `src/orchestrator/routes.ts:39-40` (optional Bearer token), `src/orchestrator/shutdown.ts` (graceful drain)
- ADR 0014 §8 (project plugins are executed code), ADR 0015 §7 (install naming/runtime vs hydration), ADR 0018 (artifact channels and dual-runtime), ADR 0021 (project cache under the state root)
- ADR 0025 (local execution isolation), ADR 0026 (remote execution confinement), ADR 0027 (exposed serve security) — the policies this install must preflight and authorize
