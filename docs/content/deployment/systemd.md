---
title: Deployment (systemd)
---

On Linux hosts, run `rolecall --serve` under systemd so it restarts automatically and survives reboots. Start from an installed native binary placed somewhere stable like `/opt/rolecall/dist/bin/rolecall-linux-x64-musl`, then point the unit's `ExecStart` at it with the `--serve` flag appended. A minimal unit looks like this:

```ini
[Unit]
Description=RoleCall orchestrator server
After=network-target

[Service]
Type=simple
User=rolecall
ExecStart=/opt/rolecall/dist/bin/rolecall-linux-x64-musl --serve
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Tune the remaining knobs to your setup. Set a dedicated non-root `User`, wire up journaling through `StandardOutput`/`StandardError`, and adjust `Environment` entries if you want to fix the listen address through `ROLECALL_SERVE_HOST` and `ROLECALL_SERVE_PORT` instead of relying on defaults. Reload daemon config, enable on boot, and check status with the usual `systemctl daemon-reload`, `systemctl enable --now rolecall.service`, and `systemctl status rolecall.service` commands.

One caveat stays upfront: the served binary path above mirrors the README's documented example rather than an artifact produced on this machine, since native compilation happens elsewhere. Confirm the exact filename against your own `dist/bin` listing before wiring the unit. For the command surface the service exposes once listening, read [/reference/serve-command](/reference/serve-command).
