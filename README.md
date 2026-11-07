# RoleCall

RoleCall is config management and orchestration for Linux and macOS. One
executable runs as a CLI (`rolecall playbook run …`) and as an orchestrator
server (`rolecall --serve`). It reads Ansible inventories, applies playbooks over
SSH or local transports, and can run on either Node.js or Bun.

> [!WARNING]
> **Alpha — testing only.** RoleCall is pre-1.0 alpha software. The executor,
> SSH/local transports, facts gathering, inventory handling, and orchestrator are
> real and the test suite is green, but **breaking changes land without notice**:
> playbooks, inventory shapes, CLI flags, and module parameters may all change
> before `0.1.0`. Do not run it against production hosts. Issues and pull requests
> are welcome — pin exact versions if you experiment.

## What you can do today

- Run playbooks over SSH and local transports with `--check`, `--diff`, `--force`,
  `--tags`, and `--skip-tags`.
- Consume RoleCall-native or Ansible inventories (INI and `all:`-rooted YAML).
- Gather facts, inspect resolved hosts and variables, and trace variable precedence.
- Use roles, handlers, `when`/`loop`, and structured `$var`/`$concat` references,
  plus Jinja rendering through explicit `copy` content templates.
- Load module plugins with `plugin register`; project plugins auto-load.
- Run the orchestrator with `--serve`: run dispatch, project/schedule CRUD, cron
  schedules, and Bearer-gated webhooks.
- Approve durable filesystem grants and egress destinations with `rolecall isolation`.
- Install, run as a service, update, roll back, and uninstall with `rolecall install`,
  `rolecall service`, `rolecall update`, and `rolecall uninstall`.
- Optionally install a standalone Bun toolchain with `--with-bun`.

## Requirements

- **npm install:** Node.js >= 22.19.0. No Bun needed.
- **Compiled binary / source checkout:** Bun >= 1.4.2. Release binaries embed Bun.

## Install

### npm

```sh
# Global CLI on PATH
npm i -g @rolecall/cli

# One-off usage
npx @rolecall/cli --help

# Or project-local, inside the Bun ecosystem
bun add @rolecall/cli
```

The npm package ships a Node bundle (`lib/cli.js`) and works on a machine with no
Bun installed.

### Self-contained binary (Node-free)

On a host without Node, npm, or Bun, use the bootstrap:

```sh
# Interactive wizard
curl -fsSL https://raw.githubusercontent.com/markporter/rolecall/main/install.sh | sh

# Pre-answer scope; paths/service/confirmation still prompt
curl -fsSL https://raw.githubusercontent.com/markporter/rolecall/main/install.sh | sh -s -- --user

# Unattended
curl -fsSL https://raw.githubusercontent.com/markporter/rolecall/main/install.sh | sh -s -- --non-interactive --yes --user
```

It downloads the platform binary and `SHA256SUMS` from GitHub Releases, verifies
the checksum, then runs the tested `rolecall install` flow. For offline installs,
pass `--from-dir <dir>` to use a pre-downloaded artifact directory.

### Guided install

After the binary is on PATH, `rolecall install` configures directories,
`rolecall.env`, the install manifest, and a systemd/launchd unit. It is a dry-run
unless you pass `--yes` or confirm in the wizard.

```sh
# Interactive: scope, paths, service, exposure, optional Bun, confirmation
rolecall install

# Unattended user install
rolecall install --user --yes

# System install with authenticated non-loopback serving
rolecall install --system --yes --exposed
```

Useful install flags:

- `--system` / `--user` select the scope (system installs require root and use
  the unprivileged `rolecall` service account; create it first or pass
  `--service-user <account>`).
- `--no-service` skips unit generation.
- `--exposed` writes `ROLECALL_SERVE_TOKEN` and exposure settings to `rolecall.env`
  so a non-loopback `--serve` bind is authenticated.
- `--with-bun [--bun-version <ver>]` installs the optional standalone Bun
  toolchain; `--add-bun-to-path` links it into the install bin directory.
- `--migrate` moves legacy `~/.rolecall` state into the XDG state root.
- `--offline` requires `--from-dir`.

Then manage the service:

```sh
rolecall service install --yes
rolecall service start --yes
rolecall service status
```

### Optional Bun toolchain

The native binary already embeds Bun. If you want a general-purpose Bun CLI for
source-mode work, manage it independently:

```sh
rolecall runtime install --yes
rolecall runtime status
rolecall runtime remove --yes
```

### Update and remove

```sh
rolecall update --check
rolecall update --yes
rolecall update --rollback --yes
rolecall uninstall --yes
rolecall uninstall --purge --yes
```

`update` verifies the signed release manifest and checksums, stages the new
version, switches atomically, backs up state, and restarts the service with
rollback on failure. `uninstall` keeps config/state unless `--purge` is passed.

## Quickstart

An inventory names your hosts and variables; a playbook declares the tasks to
apply.

```yaml
# inventory.yaml
groups:
  web:
    hosts:
      - web1.example.com
      - web2.example.com
    vars:
      http_port: 80
```

```yaml
# playbook.yaml
- name: deploy-web
  hosts:
    - web1.example.com
    - web2.example.com
  tasks:
    - name: Install web server package
      package:
        name: nginx
        state: present
    - name: Configure HTTP port
      copy:
        dest: /etc/nginx/nginx.conf
        content: |
          events {
            worker_connections 1024;
          }
          http {
            server {
              listen 80;
            }
          }
    - name: Ensure nginx is running
      service:
        name: nginx
        state: started
```

Inspect before applying:

```sh
rolecall inventory show inventory.yaml
rolecall playbook run playbook.yaml --inventory inventory.yaml --check --diff
rolecall playbook run playbook.yaml --inventory inventory.yaml
```

A larger worked example lives in [`examples/lxd-lab`](examples/lxd-lab).

## Common commands

```sh
rolecall playbook run <playbook> --inventory <inv>
rolecall facts gather <inv>
rolecall inventory show <inv>
rolecall inventory list <inv>
rolecall vars list <playbook>
rolecall vars trace <playbook> --inventory <inv>
rolecall doctor
rolecall docs search <query>
rolecall plugin list
rolecall plugin register <name> --path <file>
```

## Orchestrator

`rolecall --serve` starts the HTTP server on `127.0.0.1:8080` by default.

```sh
rolecall --serve
rolecall --serve --port 9090
rolecall --serve --host 0.0.0.0 --exposed
```

A non-loopback bind requires `--exposed` plus a Bearer token in
`ROLECALL_SERVE_TOKEN`; `rolecall install --exposed` generates and stores one.
In exposed mode every route except `GET /health` requires
`Authorization: Bearer <token>`. Each run is forked to the one-shot CLI with a
materialized playbook/inventory pair, so the full executor applies.

## Isolation

Local execution is sandboxed by default (`--isolation auto`). Explicit grants and
egress destinations can be one-off or durable:

```sh
rolecall playbook run site.yaml --inventory inv.yaml \
  --mount /srv/certs:/srv/certs:ro \
  --allow-egress api.example.com:443

rolecall isolation allow /srv/shared/certs --target /mnt/certs --ro
rolecall isolation allow-egress api.example.com --port 443 --scope all
rolecall isolation list --egress --explain
```

Durable grants live in the operator-owned `isolation.yaml`; a project's own
requests are advisory and require `rolecall isolation allow --from-request`.

## Documentation

- User guide and command reference: [`docs/`](docs/)
- Design goals, roadmap, and ADRs: [`design/`](design/README.md)

## Development

```sh
bun install
bun test
bun run build
```

The test suite runs on both runtime branches:

```sh
ROLECALL_RUNTIME=bun bun test
ROLECALL_RUNTIME=node bun test
```

For contributor and agent guidance, see [`AGENTS.md`](AGENTS.md).
