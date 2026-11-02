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
