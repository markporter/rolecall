---
title: First Playbook
---

Writing a playbook means describing state declaratively: who the targets are, and what each one should look like. This guide walks through the smallest valid playbook RoleCall will accept — a YAML **list of plays** with a single entry — then shows how `rolecall playbook run` turns it into a plan without touching a single remote host. Everything below reflects the live schema and output captured from the live CLI.

## An inventory defines your targets

RoleCall inventories group hosts together and carry per-group variables. A minimal file looks like this:

```yaml
groups:
  web:
    hosts:
      - web1.example.com
      - web2.example.com
    vars:
      http_port: 80
```

The top level must name a `groups` record. Each group carries a `hosts` list and optional `vars`. You can inspect exactly what RoleCall resolves with two commands:

```sh
rolecall inventory show inventory.yaml
rolecall inventory list inventory.yaml
```

`show` prints resolved hosts plus their merged variables, while `list` simply enumerates the group names.

## A playbook declares tasks

A playbook file is a YAML **list of plays** — Ansible's document form. Each play starts with `- ` and binds a set of hosts to an ordered task list; a bare single-play object (no leading `- `) is rejected at load time. RoleCall accepts **both** task shapes and converts them to the same internal form, so use whichever reads better:

- **Ansible-style (collapsed)** — the module name *is* the key and its value is the args map.
  This is the style used throughout these docs:

  ```yaml
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

- **Explicit (`module:` + `args:`)** — the alternative form, where `module` names the module
  and `args` carries its parameters. It is exactly equivalent to the collapsed form above:

  ```yaml
  - name: Install web server package
    module: package
    args:
      name: nginx
      state: present
  ```

Every task needs a `name` and a module; args are optional. Unknown keys are rejected, so keep
to `name`, the module key (or `module` + `args`), and the documented extras such as `when`,
`loop`, `notify`, `register`, `delegate_to`, `run_once`, and `listen`. Control-flow fields
like `strategy` and `serial` sit at play level instead.

## Run it and read the plan

Invoke RoleCall against both files:

```sh
rolecall playbook run playbook.yaml --inventory inventory.yaml
```

With nothing else on the command line RoleCall resolves the matched hosts and applies tasks live over SSH or local transports, recording a run trace; adding `--output json` gives machine-readable output instead of the default `syslog` realtime stream or the `human_summary` table.

## What is deliberately not happening

Be clear-eyed about the gaps so the tool keeps its honesty label:

- **Execution is live.** RoleCall resolves matched hosts and runs each task over SSH or local transports; the outcome lines reflect actual convergence, proven end-to-end by an integration test against an in-process ssh2 simulator.
- **Templating stays literal by default.** RoleCall does not auto-render `{{ }}` in task arguments, so a literal `"{{ http_port }}"` passes through verbatim; structured `$var`/`$concat`/`$call` and typed `when`/`loop` are what render. The only Jinja rendering is opt-in inside `copy`, via a `content` template spec with `engine: jinja` (the default engine is Eta). A global argument-level Jinja renderer remains scaffolded.
- **Facts gathering works.** ` rolecall facts gather <inv>` gathers targeted/cached facts per resolved host through its built connection, failing gracefully on unreachable hosts.
- **Plugin CLI works; the SDK authoring surface is partial.** `rolecall plugin list` and `rolecall plugin register` are implemented: registered module/fact plugins persist to `.rolecall/plugins.json` and auto-load at startup, and project plugins under `plugins/<type>/<namespace>/` are auto-discovered at `playbook run`. Only the richer Plugin SDK authoring/test harness remains partial.

An identical second run of a well-formed playbook is now expected to report `changed=false` because converge detects already-satisfied state; confirm exact per-module idempotence against their docs.
