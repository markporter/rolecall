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
                 [--no-service] [--dry-run] [--yes] [--non-interactive] [--force]
```

- **Default is a dry-run.** It prints the resolved layout, service manager,
  isolation preflight, and every planned action. Pass `--yes` to apply.
- Scope defaults to `system` when root, otherwise `user`. `--system` and
  `--user` are mutually exclusive; applying a system install requires root.
- `--no-service` skips unit generation.
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
- `rolecall.env` (0600 user / 0640 system) if absent;
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

## Service lifecycle

```sh
rolecall service install|uninstall|start|stop|restart|status [--system|--user] [--dry-run|--yes]
```

`install` writes the unit/manifest via the install helper before enabling it.
Other operations plan by default; pass `--yes` to execute the printed
`systemctl`/`launchctl`/`sc.exe` commands. `status` is read-only and always runs.
System-scope changes require root/Administrator.

## Not yet implemented

The interactive wizard, bootstrap scripts, binary placement, service
enable/start/stop/status, update/uninstall, `--with-bun`, `--from-dir`,
`--offline`, and the `rolecall runtime`/`rolecall isolation` management commands
are still pending.
