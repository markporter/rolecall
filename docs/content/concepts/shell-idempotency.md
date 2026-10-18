# Writing idempotent shell tasks

RoleCall's `shell` module is controlled by a single `run_mode` (default `idempotent`). (`command` and `raw` tasks are thin aliases of `shell` — they forward to it, so everything below applies to them too; see [Alternate modules](/concepts/alternate-modules).)
When `run_mode` is `idempotent` and you run a shell task without an idempotency
guard, it throws at apply time with a message explaining how to make the command
repeatable:

```text
shell: run_mode is 'idempotent' but no idempotency guard set (creates/removes/creates_cmd/removes_cmd).
Add a guard so re-runs are safe, set run_mode: always to run unconditionally,
or run_mode: readonly for a pure check.
```

This is deliberate. A bare `shell: echo done` looks harmless, but it **runs on every
single playbook run** — re-downloading, re-restarting, re-touching state in ways that
drift and surprise you at 3am. The guard nudges you to write shell that converges to
the same result no matter how many times it runs.

For the full argument list, see the [shell module reference](/reference/module-reference#shell).

## `run_mode` at a glance

| `run_mode` | Runs | Reports `changed` | Guard required? |
| --- | --- | --- | --- |
| `idempotent` (default) | only when guard not yet satisfied | per guard | **yes** — throws if missing |
| `readonly` | every time | `false` | no |
| `always` | every time | `true` | no |

**Guards require `idempotent`.** A guard (`creates`/`removes`/`creates_cmd`/`removes_cmd`)
only makes sense in `run_mode: idempotent`. Setting a guard together with `run_mode: readonly`
or `run_mode: always` is contradictory — the guard says "skip if already done" while the
mode says "always run" — and throws at apply time. If you want a guard, omit `run_mode`
(it defaults to `idempotent`) or set it explicitly. (`command` applies this for you: a
`creates`/`removes` guard auto-selects `idempotent`.)

Use `idempotent` (the default) whenever you can express a guard. Reach for `readonly`
for pure checks (`nginx -t`) and `always` for one-shot / fire-and-forget commands.

## 1. `idempotent` — add a guard (preferred)

Tell RoleCall how to tell the work is already done. On re-runs the guard is checked first,
and if it already passes the task is skipped instead of re-executed.

`creates` / `removes` — the classic path-based hints:

```yaml
- shell:
    command: systemctl restart nginx
    creates: /run/nginx.pid
- shell:
    command: rm -rf /var/cache/build
    removes: /var/cache/build
```

`creates_cmd` / `removes_cmd` — full shell pre-check commands for when a path is not
enough (they win over `creates`/`removes`):

```yaml
- shell:
    command: enable-feature --apply
    creates_cmd: feature --status | grep -q enabled
    verify_cmd: curl -sf http://localhost/health
```

`verify_cmd` is separate from guarding: it runs *after* the command every time and
marks the result `failed` if it exits non-zero, without affecting `changed`.

## 2. `readonly` — pure read-only checks

Some commands must run every time but never mutate managed state — a config lint, a
health probe, a preflight assertion. Set `run_mode: readonly` so the task runs on
every pass but always reports `changed: false` (and never throws for a missing guard):

```yaml
- shell:
    command: nginx -t
    run_mode: readonly
```

`readonly` is often paired with `register`, which stores the task result under a name
you can read in later tasks. The registered result's `data` map holds `stdout`,
`stderr`, and `rc`:

```yaml
- shell:
    command: nginx -t
    run_mode: readonly
    register: nginx_config_check
# later tasks can branch on the captured exit code:
#   when:
#     $eq:
#       - $var: reg.nginx_config_check.data.rc
#       - 0
```

## 3. `always` — one-shot / fire-and-forget

When a command is truly one-shot and you accept it re-running, say so explicitly
with `run_mode: always`. It runs every time and always reports `changed: true`:

```yaml
- shell:
    command: "apt-get install -y nginx"
    run_mode: always
```

## Multi-line scripts

`command`, `creates_cmd`, and `verify_cmd` are all plain strings, so you can use a
YAML literal block (`command: |`) for multi-statement scripts. The whole string is
passed verbatim to `/bin/sh` (or the remote login shell over SSH) — newlines are
preserved, so heredocs and scripts work as-is:

```yaml
- shell:
    command: |
      set -e
      echo "bootstrapping"
      touch /opt/app/.bootstrapped
    run_mode: always
```

### Variables: RoleCall does not render `{{ }}`

RoleCall does NOT interpret Jinja template code in values like Ansible does. For variable substitution use the
`$template` operator with `<%= %>` tags (or structured `$var`/`$concat`):

```yaml
- shell:
    command:
      $template: "echo host <%= vars.cimc_host %> is <%= facts.os %>"
    run_mode: always
```

Inside a multi-line `$template` block you can reference vars and facts the same way:

```yaml
- shell:
    command:
      $template: |
        echo "role is <%= vars.role %>"
        test -f /opt/app/.bootstrapped
    run_mode: always
```

Long-running commands can set `timeout_seconds` (in seconds) to override the
transport default so they are not killed mid-run.

## Why this matters

Without guards, `shell` cannot tell "already done" from "never done", so it always
applies. Guarding is what makes `rolecall playbook run` safe to run repeatedly — the same
property that makes Ansible playbooks trustworthy. The default-on throw is the price
of that safety: it catches the footgun at apply time instead of letting it bite in
production.

## Quick reference

| Want | Use |
| --- | --- |
| Skip when a file/path already exists | `creates: /path` |
| Skip when a file/path is already gone | `removes: /path` |
| Skip based on a custom command's exit code | `creates_cmd: <cmd>` / `removes_cmd: <cmd>` |
| Pure check, runs every time, `changed: false` | `run_mode: readonly` |
| Run unconditionally (one-shot) | `run_mode: always` |
| Fail the task when a post-check fails | `verify_cmd: <cmd>` |
| Set a per-task timeout (seconds) | `timeout_seconds: 900` |
| Run a local script file (on the control node) | `local_src: path/to/s.sh` (alias module: `script`) |
| Run a script already present on the target | `src: /path/on/target.sh` |
