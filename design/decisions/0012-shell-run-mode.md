# 0012 — shell module `run_mode` enum (idempotent / readonly / always)

- Status: **Accepted**
- Date: 2026-10-10
- Supersedes: the experimental `guarded` / `changed_when` / `intentional` triad
  that shipped briefly on `shell_guarded` (pre-0.1.0 alpha).

## Context

The `shell` module (originally `shell_guarded`) needed a way to express *how* a
shell task behaves across re-runs, because a bare `shell: echo done` applies on
every single playbook run and silently drifts state. The first cut exposed three
overlapping properties:

- `guarded` (bool, default `true`) — threw at apply time when no idempotency guard
  was set, nudging users toward convergent commands.
- `changed_when` (bool, Ansible-inspired) — reported `changed: false` for pure
  read-only checks that must still run every time.
- `intentional` (bool) — asserted that a repeatable, *guarded-off* change was a
  deliberate one-shot.

Three booleans describing one axis (run cadence × changed reporting) were confusing
to author and to lint. `changed_when` also collided semantically with Ansible's
`changed_when` (a *post-hoc* expression), which RoleCall does not implement — RoleCall keeps
Jinja `{{ }}` literal, so the Ansible meaning does not apply here.

## Decision

Collapse the three properties into a single `run_mode` enum on the `shell` module:

| `run_mode` | Runs | Reports `changed` | Guard required? |
| --- | --- | --- | --- |
| `idempotent` (default) | only when guard not yet satisfied | per guard | **yes** — throws if missing |
| `readonly` | every time | `false` | no |
| `always` | every time | `true` | no |

- `idempotent` is the default. When set (explicitly or by default) and the task has
  no idempotency guard (`creates` / `removes` / `creates_cmd` / `removes_cmd`), the
  module **throws at apply time** with a message telling the author how to add a
  guard or opt out via `run_mode`.
- `readonly` is the replacement for the old `changed_when: false`: a pure check
  (lint, health probe, preflight) that runs every pass but never reports a change.
- `always` is the replacement for the old `guarded: false` / `intentional: true`: a
  one-shot / fire-and-forget command that always runs and always reports `changed`.

The idempotency lint in `src/config/loader.ts` suppresses its "no guard" warning for
`run_mode: readonly` and `run_mode: always`, matching the old "intentional opts out"
behavior.

Authoring guidance (multi-line scripts, `$template` var/fact references, and the
`/bin/sh`-vs-`expect` caveat) lives in
`docs/content/concepts/shell-idempotency.md`.

## Consequences

- One clear control instead of three overlapping booleans; the default still fails
  loudly on unguarded shell, preserving the safety net.
- Breaking change versus the experimental triad. Acceptable in alpha (pre-0.1.0) per
  `AGENTS.md`; examples, tests, and docs were updated in lockstep (four-surface sync).
- The lint guard's opt-out semantics are preserved under a single, discoverable name.
