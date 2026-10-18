---
title: Playbook operators
---

Playbook operators bind dynamic values into task arguments, `when` guards, and `loop` sources before execution.

Tasks may be written in **Ansible-style collapsed form** (`copy: { dest, content }`) or the **explicit** `module:` + `args:` form — the two are equivalent. See [First Playbook](/guide/first-playbook) for the task-shape rules.

Templating binds dynamic values into task arguments, `when` guards, and `loop` sources before execution. RoleCall does **not** auto-render Jinja/<code v-pre>{{ }}</code> at the argument level: a literal <code v-pre>{{ ... }}</code> in an argument, `when` guard, or `loop` source is passed through verbatim. The one place Jinja renders is the `copy` module's `content` template spec, where setting `engine: jinja` opts in explicitly (the default engine there is `eta`). What ships broadly is the **structured-ref** system: explicit, escapeless, type-checked data *nodes* whose keys start with `$`. Nodes resolve against one of RoleCall's 9 reserved namespaces (`vars`, `facts`, `reg`, `loop`, `play`, `inv`, `role`, `run`, `rolecall`), so a lookup must be fully qualified — e.g. `$var: vars.foo` or `$var: facts.os`. The `$template` operator is the one opt-in escape hatch for EJS-style string templates (delimiters `<%= %>` for output, `<% %>` for logic). Note: `{{ }}` is **not** a RoleCall delimiter — it is passed through literally.

## Why structured refs

A bare <code v-pre>command: "echo {{ host }}"</code> stays a literal string — it is **never** interpolated. Structured refs make interpretation **opt-in**: a value is only dynamic when it is a `$`-prefixed node; everything else stays literal byte-for-byte. There is no `eval`/`new Function` anywhere — operators are a fixed, closed set that fails closed on an unknown key.

## Reference & composite operators

These nodes bind dynamic values into task arguments, `loop` sources, and `when` guards. Every node is an object whose key starts with `$`; values resolve against one of RoleCall's 9 reserved namespaces (`vars`, `facts`, `reg`, `loop`, `play`, `inv`, `role`, `run`, `rolecall`), so `$var` requires a fully-qualified `namespace.key` path (no bare names).

| Operator | Description |
| --- | --- |
| `$var` | Single-value lookup against any reserved namespace (`vars`, `facts`, `reg`, `loop`, `play`, `inv`, `role`, `run`, `rolecall`); paths are fully qualified, e.g. `$var: vars.foo` or `$var: facts.os`. |
| `$concat` | Joined string of resolved operands. |
| `$call` | Invoke a registered helper (a real TS function) with an args array. |
| `$if` | Ternary over a boolean predicate; `condition` is optional and defaults to true (then/else required). |
| `$each` | List source for `loop`: a literal array or a `$var` reference. |
| `$template` | Opt-in EJS render of a literal string — the escape hatch for EJS `<%= %>`/`<% %>` syntax. |

## `when` / predicate operators

These typed predicates resolve to a boolean and are reused for `when` guards and `$if` conditions. Each takes an array of operands unless noted; `$var`/`$concat` may appear inside the operands (reference an observed fact with `$var: facts.key`).

| Operator | Description |
| --- | --- |
| `$eq` | Structural equality of two operands. |
| `$ne` | Negated structural equality of two operands. |
| `$lt` | Numeric/string less-than (fail-closed if the operands aren't both number or both string). |
| `$gt` | Numeric/string greater-than. |
| `$lte` | Numeric/string less-or-equal. |
| `$gte` | Numeric/string greater-or-equal. |
| `$in` | Membership — true when the second operand (array or string) contains the first. |
| `$and` | Logical AND of an array of conditions; all must be true. |
| `$or` | Logical OR of an array of conditions; at least one must be true. |
| `$not` | Logical NOT of a single condition (the condition may also be wrapped in an array). |

The `$var` prefix rule is the most common mistake: refs must be fully qualified with a reserved namespace (one of `vars.`, `facts.`, `reg.`, `loop.`, `play.`, `inv.`, `role.`, `run.`, `rolecall.`), so you must write `$var: vars.foo` (or `$var: facts.os`). A `$var` whose value lacks a known namespace prefix is flagged as a load-time error.

## Examples

Look up a play variable inside a task arg:

```yaml
- hosts: web
  vars:
    role: web
    port: 8080
  tasks:
    - name: write config
      copy:
        dest: /etc/app/port.txt
        content:
          $var: vars.port
```

Compose a value with `$concat`:

```yaml
- vars:
    env: prod
    region: us-east
  tasks:
    - name: tag resource
      shell:
        run_mode: always
        command:
          $concat:
            - "deploy-"
            - $var: vars.env
            - "-"
            - $var: vars.region
```

Guard a task with a typed `$eq` predicate:

```yaml
- vars:
    os: Debian
  tasks:
    - name: install apt pkg
      apt:
        name: nginx
      when:
        $eq:
          - $var: vars.os
          - "Debian"
```

Branch with `$if`:

```yaml
- vars:
    os: Debian
  tasks:
    - name: pick package manager
      shell:
        run_mode: always
        command:
          $if:
            condition:
              $eq:
                - $var: vars.os
                - "Debian"
            then: "apt-get update"
            else: "yum makecache"
```

Loop over a list with `$each`:

```yaml
- vars:
    packages:
      - nginx
      - redis
      - postgres
  tasks:
    - name: install each package
      apt:
        name:
          $var: loop.item
      loop:
        $each: vars.packages
```

Invoke a registered helper with `$call`:

```yaml
- tasks:
    - name: compute path
      shell:
        run_mode: always
        command:
          $call: slugify
          args:
            - $var: vars.region
```



For how refs attach to tasks, see [Tasks](/concepts/tasks); for the playbook shape, see [Playbooks](/concepts/playbooks).
