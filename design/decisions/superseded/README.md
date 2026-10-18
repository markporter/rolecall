# Retired ADRs

These ADRs are **retired**. Their decisions were replaced by newer ADRs that hold the
current, corrected guidance. They are preserved here for historical rationale only
(per ADR 0001: never rewrite history) — **do not use them for new work.**

| Retired ADR | Superseded by | What changed | What still stands |
| --- | --- | --- | --- |
| [0007 — Project Layout & npm-Distributed Modules/Roles](0007-project-layout-and-npm-distribution.md) | [ADR 0014](../0014-project-and-plugin-architecture.md) (architecture) + [ADR 0015](../0015-collections-and-install-commands.md) (distribution) | The npm `imports:` distribution model (`rolecall.yaml.imports[]` → `node_modules` → FQCN) was replaced by RoleCall-native, git-first **collections** (`collections.yml` + `rolecall collections install`). | The project-layout / role-as-project model (a dependency is another RoleCall project) was carried forward and extended by ADR 0014/0015. |
| [0011 — Module and plugin namespacing](0011-module-and-plugin-namespacing.md) | [ADR 0014](../0014-project-and-plugin-architecture.md) | The runtime package-manager / npm-tier resolution assumptions were replaced by a local-file + JIT-bundle model. | The FQCN + builtin-namespacing + collision-policy scheme was carried forward and refined in ADR 0014. |

Each retired file also carries a `Status: Retired` header and an inline banner pointing at its replacement.
