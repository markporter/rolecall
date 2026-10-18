---
title: Idempotency
---

Idempotency ensures running the same plan repeatedly converges to one desired state without extra change.

RoleCall leans on declarative modules that follow a check-compare-write cycle: inspect current state, compare it against desired state, and write only when they differ. Side-effecting operations like shell or POST always apply, since there is nothing safe to skip there.

This principle is baked into the schema rather than left to convention. There is deliberately no `idempotent` flag on any task, because adding one would tempt people to opt out. The schema rejects an `idempotent` key at parse time, so the constraint holds even before anything runs. The summary printed after a `playbook run` states the goal: an identical second run should report `changed=false` with zero write commands.

Idempotent describe/converge runs live through the executor: each module compares current target state against desired state and writes only when they differ, so the outcome markers from an apply reflect real per-host state comparisons. Config-write modules reuse this cycle to refuse redundant writes, yielding repeatable deployments where supported, and a comparison cache short-circuits unchanged work. Read [Modules](/concepts/modules) and [Tasks](/concepts/tasks) for the surrounding pieces.
