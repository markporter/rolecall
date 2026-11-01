---
title: Inventory Management
---

Good inventory organization keeps hosts, groups, and variables easy to reason about. Start by grouping machines by role (`web`, `db`) inside a single top-level `groups` record, while RoleCall accepts Ansible's `all:`-rooted YAML directly in addition to the native `groups` map. Give each group a `hosts` list plus whatever `vars` genuinely belong to that group, keeping per-machine overrides rare and explicit.

Keep variable names meaningful and consistent across groups so a template can rely on them. Remember that precedence runs from lowest to highest: defaults, then group-all vars, then each membership's group vars merged in sorted-name order, and finally direct host vars on top. A var defined in two overlapping groups resolves through that fixed order, so document the intent once instead of guessing which wins. Verify your mental model directly with `rolecall inventory show <inv>`, whose output sorts hosts and keys for stability.

A few habits pay off. Prefer file-based inventories under version control over ad-hoc inline definitions, name hosts fully (for example `web1.example.com`) so globs stay predictable, and resolve targets explicitly with `--limit` when a play needs just one group. Fact gathering and remote application are live, so the inventory you validate here is the same target set the executor drives. See [/reference/inventory-commands](/reference/inventory-commands).
