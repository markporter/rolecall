---
title: Install Command
---

# Install Command

`rolecall install` plans or applies the ADR 0023 install layout. It is a
self-installer/manager: it configures directories, `rolecall.env`, the install
manifest, and a service unit. It does **not** fetch packages, copy the binary,
enable/start the service, or edit `PATH` yet.

```sh
rolecall install [--system|--user] [--prefix DIR] [--config-dir DIR] [--state-dir DIR]
                 [--no-service] [--exposed] [--dry-run] [--yes] [--non-interactive] [--force]
```

- **Bare invocation in a TTY starts a wizard**: scope, program/config/state
  directories, whether to install a service, the system service account, and a
  final apply confirmation. Flags pre-answer prompts; `--non-interactive` and
  `--yes` skip them.
- **Default is a dry-run outside the wizard.** It prints the resolved layout,
  service manager, isolation preflight, and every planned action. Pass `--yes`
  (or confirm in the wizard) to apply.
- Scope defaults to `system` when root, otherwise `user`. `--system` and
  `--user` are mutually exclusive; applying a system install requires root.
- `--no-service` skips unit generation.
- `--exposed` enables the exposed serve profile: it writes `ROLECALL_SERVE_EXPOSED=1`,
  `ROLECALL_SERVE_HOST`, and a generated `ROLECALL_SERVE_TOKEN` to `rolecall.env`
  (shown once), and adds `--exposed` to the service unit. A non-loopback bind
  without these values is refused at serve time. System-scope service installs
  provision a token even without `--exposed`, so a later exposure cannot start
  unauthenticated.
- `--add-to-path` / `--no-add-to-path` controls the `binDir/rolecall` symlink (default: add).
- `--offline` requires `--from-dir`; update also accepts it with `--rollback`.
- `--migrate` moves legacy `~/.rolecall` state (`state.db`, WAL/SHM, `plugins.json`) into the XDG state root, never overwrites, and leaves `MIGRATED.md` behind. The resolver ignores the legacy fallback during this install.
- `--service-user <name>` sets the system service account (default `rolecall`). The account must already exist and must not be root; `rolecall install` and `rolecall service install` fail closed otherwise.
- `--force` overwrites `rolecall.env` and the manifest (normally existing config
  is preserved).
- `--isolation` participates in the preflight; `rolecall doctor` reports the
  same probe independently.

## Config precedence

`loadConfig()` reads, low → high:

1. system `rolecall.env` (e.g. `/etc/rolecall/rolecall.env`),
2. user `rolecall.env`,
3. project `<project>/.rolecall/rolecall.env`,
4. process environment (CLI flags layer on top).

Missing files are ignored; process env always wins. The install command writes
the user/system file with `0600`/`0640` permissions.

## What apply writes

- the config, state, and cache directories;
- `rolecall.env` (0600 user / 0640 system) if absent; with `--exposed` it also
  receives `ROLECALL_SERVE_EXPOSED=1`, `ROLECALL_SERVE_HOST`, and a generated
  `ROLECALL_SERVE_TOKEN` (an existing token is reused, never echoed);
- `install.json` (scope, version, runtime, paths, service manager, installedAt);
- the service unit/plist under the config dir for user scope, or the system path
  for system scope (for package/bootstrap installs).

It does not create the program directory. The bootstrap or OS package must place
the `rolecall` binary there; the plan warns when it is missing.

## Service managers

| Platform | Manager | Unit path |
|---|---|---|
| Linux | systemd | `/etc/systemd/system/rolecall.service` (system) or `<configDir>/systemd/rolecall.service` (user) |
| macOS | launchd | `/Library/LaunchDaemons/com.rolecall.serve.plist` (system) or `<configDir>/LaunchAgents/...` (user) |
| Windows | SCM | planned; no unit file |

## Uninstall

```sh
rolecall uninstall [--system|--user] [--purge] [--dry-run|--yes]
```

Stops/disables the service when possible, removes `install.json` and the
service unit, and keeps config/state/cache by default. `--purge` removes those
directories too. The program directory/binary is never deleted by the
self-installer. Like install, it plans by default; `--yes` applies.

## Update and rollback

```sh
rolecall update --check [--from-dir DIR]
rolecall update --from-dir DIR [--yes] [--no-restart]
rolecall update --rollback [--yes] [--no-restart]
```

Versions live under `<programDir>/versions/<version>` and `current` is a symlink.
`--check` is read-only. Applying stages a checksummed `--from-dir` artifact,
atomically switches `current`, records `currentVersion`/`previousVersion` in
`install.json`, and restarts the service unless `--no-restart`.
`--rollback` switches back to the recorded previous version.

Network updates use GitHub Releases (ADR 0029). Each release carries
`release.json`, its Ed25519 signature, and `SHA256SUMS`; the client verifies the
signature/checksum before staging. `--update-url` points at a mirror; `--from-dir`
remains the offline path.

Pre-beta has a **single update stream**; channels (`stable`/`alpha`/`beta`/`rc`/
branch) are deferred until beta. Use `update --check` to inspect the latest release
without downloading it.

Signature verification requires the release public key. Official builds embed it;
source/self-built binaries can set `ROLECALL_RELEASE_PUBLIC_KEY` (PEM) or
`ROLECALL_RELEASE_PUBLIC_KEY_FILE`.

The apply path verifies the artifact, runs `<newbin> --version` as a smoke check,
backs up `state.db` (plus WAL/SHM sidecars) when present, stages/switches,
updates the manifest, and restarts the service unless `--no-restart`. If the
restart commands fail, it switches `current` back to the previous version and
updates the manifest. A full state-schema migration guard and `/health` probe are
still pending, as is install-kind delegation (`npm`/`bun -g`/`os-package`).

## Install kinds

`install.json` records how RoleCall was installed:

- `binary` — the self-installer; `update` uses the versioned binary layout.
- `npm` — `update` delegates to `npm i -g @rolecall/cli@<version>`; with
  `--yes` it runs the command, otherwise it prints it.
- `bun-global` — delegates to `bun add -g @rolecall/cli@<version>`.
- `os-package` — update through apt/dnf/brew/MSI; RoleCall refuses to replace
  package-owned files.
- `source` — update with git and rebuild; self-update is refused.

If no manifest exists, the CLI infers the kind from how it was launched.

## Service lifecycle

```sh
rolecall service install|uninstall|start|stop|restart|status [--system|--user] [--dry-run|--yes]
```

`install` writes the unit/manifest via the install helper before enabling it.
Other operations plan by default; pass `--yes` to execute the printed
`systemctl`/`launchctl`/`sc.exe` commands. `status` is read-only and always runs.
System-scope changes require root/Administrator.

## Implemented vs pending

Implemented: the interactive wizard, `install.sh`/`install.ps1` Node-free
bootstrap, `--from-dir` binary placement, `uninstall`, `service` lifecycle plans
(systemd/launchd), `update --from-dir`/`--rollback`, `doctor`, `--migrate`,
`--add-to-path`, and `--exposed` token generation.

Still pending: the optional `--with-bun` toolchain and `rolecall runtime`
commands, network/channel update discovery (offline `--from-dir` is the current
path), and the native Windows SCM service host (Windows remains on the
third-party wrapper path for now). Isolation grants/egress are managed by
`rolecall isolation`; see [/reference/isolation-commands](/reference/isolation-commands).
