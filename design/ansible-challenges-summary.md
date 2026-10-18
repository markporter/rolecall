# Ansible Challenges vs. RoleCall — Summary

> Concise version of `ansible-comparison.md`. Evidence base: Carreira et al.
> (EASE 2026, arXiv:2504.08678) — 59,157 posts + 20 interviews — plus UpGuard,
> TechTarget, and RoleCall's own plan/code.

---

## 1. Where Ansible hurts (top complaints, by prevalence)

| Theme | Share | What users actually hit |
|---|---|---|
| **Control / data-flow & execution** | 44.4% | Loops (13.9%), SSH connection issues (12.7%), variable mgmt (12.3%), conditionals (10.6%), undefined vars (10.4%); sequential slowdown, **no state**, push/agentless |
| **Lack of support** | 38.2% | AWX/Tower (17.3%), **"write your own module"**, Windows/WinRM (7.7%) |
| **Reliability** | 37.2% | **Hard to debug (n=10)**, stuck runs (B2: "15 min, no terminal change"), **cryptic errors (n=5)** |
| **Usability** | 18.8% | **Jinja2 (29.1%)**, quoting (19.7%), YAML (9.8%); **escaping hell** (E5: "8h on YAML SQL escaping") |
| **Performance / scale** | 8.1% | Dynamic inventories (29%), **no agent, doesn't scale past hundreds of hosts** (E4) |

**Study's 4 recommended fixes:** (1) stronger failure locality, (2) clearer
language/templating boundary, (3) targeted docs, (4) better execution backends.

**Industry adds:** no notion of state; JSON-serialization CPU cost at scale;
secrets leaking into logs; limited debug tooling.

---

## 2. How RoleCall addresses them

**Addressed (built or in MVP):**
- Templating speed → fast compiled eta/vento + optional LiquidJS Jinja-mode.
- Painful Python modules → first-class **JS/TS plugin SDK** (author ~1 function, no build, dynamic `.ts` load) — the #1 user differentiator.
- No state → **idempotency intrinsic to module contract**; observe-reconcile + cache + skip-unchanged; `rolecall_managed_only` governs drift ownership.
- SSH overhead → **pure-JS ssh2, channel multiplexing** + resilient runner (retry/timeout/concurrency).
- Scale → Bun + bounded fan-out (`p-limit`) + CPU worker pool.
- AWX/Tower → built-in Express orchestrator (scheduler + webhooks + REST) + optional SPA, one binary.
- Variable precedence → explicit, documented; unknown var → clean error, not NaN.

**Partial:**
- Error clarity → typed `ExecResult.error.class` + retry/bail decorators (no step-through/replay yet).
- Continuous enforcement → optional agent mode (opt-in, not default).
- Dynamic inventory → plugin interface (static + dynamic file/env built-ins).

**Gap (now target capabilities — see `goals.md`):**
> **Status:** Windows/WinRM and secrets/Vault are no longer deferred; they are
> explicit project goals in `goals.md`. The bullets below record the MVP snapshot.
- **Windows/WinRM** — sidecar behind `Connection` trait sketched, not built.
- **Secrets / Vault** — only env-var injection in MVP.

---

## 3. Gaps we've designed solutions for (not yet built)

The full designs live in `ansible-comparison.md` §6–§10 and the plan's
todos 24–28.

| Gap | Design | Where |
|---|---|---|
| Language/templating boundary (rec #2) | Structured refs (`$var`/`$concat`/`$call`), typed `when`/`loop`, template error location | §6 / todo 24 |
| Debugging + perf profiling (rec #1) | **RunTrace** in SQLite (per run/host/task/phase, timestamped) → replay + failure-locality + built-in profiler; `--trace`/`--profile`/`replay` | §7 / todo 25 |
| Rollback / resume | `tx:` (dependency + rollback boundary) + `checkpoint:` (savepoint + resume anchor) on the trace ledger; best-effort inverse | §8 / todo 26 |
| Non-idempotent shell overuse | Batteries-included module picklist + `rolecall/module` idempotency helper lib + `rolecall modules search` + lint guard | §9 / todo 27 |
| LLM-agent ergonomics | Clientless MCP over REST: `GET /mcp` manifest from Zod schema, no separate MCP server; harness stays outside RoleCall | §10 / todo 28 |

**Top priorities:** secrets management and Windows/WinRM are now explicit target
capabilities (see `goals.md`); remaining open work includes large-fact-set perf,
module/OS coverage, and compliance/drift reporting.

---

## 4. Sources
- Carreira, Saavedra, Mendes, Ferreira (2026). *The Ultimate Configuration Management
  Tool? Lessons from a Mixed Methods Study of Ansible's Challenges.* EASE 2026, arXiv:2504.08678.
- UpGuard — *Pros and Cons of Ansible*; TechTarget — *Ansible limitations for network automation*.
- RoleCall repo: `README.md`, `architecture/connectivity.md`, `.omo/plans/rolecall.md`,
  `.omo/plans/documentation.md`, `src/inventory/plugin.ts`, `src/transport/ssh.ts`.
