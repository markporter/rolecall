# 0001 — Record Architecture Decisions (ADR convention)

- Status: **Accepted**
- Date: 2026-09-18

## Context
RoleCall is a long-lived project that will be built and improved over time by multiple
developers and agents. Decisions (e.g. embedding docs for a single-file binary, the
Zod-driven agent surface) were being captured ad hoc. We need a durable, searchable,
append-only record of *why* things were done.

## Decision
Adopt Architecture Decision Records (ADRs) in `design/decisions/`, numbered
sequentially (`0001-...`, `0002-...`). Each ADR records context, decision, and
consequences. **Never rewrite history** — supersede with a new ADR instead.

**Supersession convention.** When a newer ADR replaces all or part of an existing
one, write a *replacement* ADR that records only the corrected decision (do not
leave the old decision partly in force), then **retire** the original rather than
deleting it: move the retired file to `design/decisions/superseded/`, set its
`Status:` to `Retired` with a one-line banner pointing at the replacement, and add
it to `design/decisions/superseded/README.md` and the `design/README.md` map's
`Retired / superseded` row. This keeps history discoverable while ensuring agents
and contributors never read a retired ADR as current guidance.

## Consequences
- Decision rationale is preserved and discoverable by both humans and agents.
- New contributors can read `design/decisions/` to understand constraints quickly.
- Minor overhead: every significant decision gets a short numbered file.
- Retired decisions remain available for rationale but are clearly marked and moved
  out of the active `decisions/` set.
