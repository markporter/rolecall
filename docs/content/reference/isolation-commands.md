---
title: Isolation Commands
---

# Isolation Commands

`rolecall isolation` manages the operator-owned grants and egress entries that
durable local isolation reads at run time (ADR 0023 §3, ADR 0025 §5–6). They are
written to `isolation.yaml` in the ADR 0023 config directory
(`ROLECALL_ISOLATION_CONFIG` overrides the path) and keyed by canonical
`file://` project URIs.

```sh
rolecall isolation allow <source> [--target DIR] [--ro|--rw] [--project DIR] [--from-request]
rolecall isolation revoke <source> [--project DIR]
rolecall isolation list [--project DIR] [--explain] [--egress]
rolecall isolation allow-egress <host> [--port N] [--scope shell|module|all] [--project DIR]
rolecall isolation revoke-egress <host>[:port] [--project DIR]
```

- `--project DIR` selects the project; it defaults to the current directory.
- `allow` canonicalizes the source (expands `~`, resolves symlinks), defaults the
  target to `/mnt/<basename>`, and defaults the mode to `ro`. `--rw` is explicit
  and audited. `/`, `/proc`, `/sys`, `/dev`, and `/root` are refused; socket
  grants require `type: socket`.
- `--from-request` promotes a grant from the project's advisory
  `.rolecall/isolation.yaml` instead of self-approving it.
- `allow-egress` defaults to scope `shell`; `--port` pins one destination port.
  `--scope all` applies the rule to both shell and module checks.
- `list` prints the project's grants. `--egress` includes destination rules and
  `--explain` shows project requests that are not yet approved.
- Writes are atomic and `0600`; a group/world-writable config is rejected.

## Precedence

One-off `--mount` / `--allow-egress` flags take precedence and are merged with the
approved project policy for `playbook run` and `facts gather`:

```
one-off CLI flags  ->  approved isolation.yaml grants/egress  ->  never a project self-grant
```

A project may request access, but only the operator can approve it. Requests are
advisory and are never applied automatically.

## Example

```sh
rolecall isolation allow /srv/shared/certs --target /mnt/certs --ro
rolecall isolation allow-egress api.example.com --port 443 --scope all
rolecall isolation list --egress --explain
rolecall playbook run site.yaml --inventory inv.yaml
```

See [/concepts/isolation](/concepts/isolation) for the sandbox boundary and
[/reference/global-options](/reference/global-options) for the run-time flags.
