---
title: Templates (EJS & Jinja)
---

RoleCall has three ways to inject dynamic content, in order of preference:

1. **Structured refs** (`$var`, `$concat`, `$call`, `$if`, `$each`) — the safe, escapeless, type-checked default. Use these for argument values whenever possible. Covered in [Playbook operators](/concepts/playbook-operators).
2. **EJS templates** — the default renderer for anything needing real string interpolation, whether inside a single value (the `$template` operator) or a whole file (`copy` with `engine: ejs`, which is the default). EJS uses `<%= %>` for output and `<% %>` for logic.
3. **Jinja templates** — *opt-in only*, via the `$jinja` operator or a `.j2` file referenced by `copy` with `engine: jinja`. Use Jinja when a template comes from an existing Ansible project (so you can drop it in with minimal changes). A `.j2` file renders in the ADR 0025 sandbox worker when isolation is enabled; `$jinja` is bounded Nunjucks rendered in-process with strict undefined-name handling.

RoleCall deliberately does **not** auto-render <code v-pre>{{ }}</code> as a global template engine. An ordinary argument containing <code v-pre>{{ ... }}</code> is rejected by the playbook lint, not interpreted. Templating is *opt-in*: use a structured ref, wrap a value in `$template` (EJS), or wrap Jinja in `$jinja`. Jinja delimiters are allowed **only** inside `$jinja`; a `.j2` file referenced by `copy.content.template_file` is also allowed because the Jinja lives in the file, not the playbook.

## EJS templates

EJS uses two delimiters:

- `<%= expr %>` — output the value of `expr`.
- `<% expr %>` — run logic (loops, conditionals) with no output.

`expr` is evaluated against RoleCall's reserved namespaces (including `vars` and `loop`); the current loop item is `loop.item` / `loop.index`.

### Via the `$template` operator

`$template` renders a *literal* string through the EJS engine — the explicit opt-in escape hatch for EJS string interpolation:

```yaml
- hosts: web
  vars:
    host: web1
  tasks:
    - name: opt-in template
      shell:
        run_mode: always
        command:
          $template: "echo <%= play.host %>"   # renders to "echo web1"
```

### Via the `copy` module (default engine)

`copy` renders a `content` template spec on the target host. The default engine is **EJS**:

```yaml
- copy:
    dest: /etc/app/app.conf
    content:
      template: "listen <%= vars.port %>"
      engine: ejs          # default; omit to use EJS
```

```yaml
- copy:
    dest: /etc/nginx/conf.d/site.conf
    content:
      template_file: vhost.ejs
      engine: ejs
```

## Jinja templates

See [Isolation & Sandboxing](/concepts/isolation) for what the renderer can and cannot access.

Jinja uses <code v-pre>{{ expr }}</code> for output and `{% ... %}` for logic — the syntax Ansible users know. In RoleCall, Jinja is **only** available inside the `$jinja` operator or in a `.j2` file referenced by `copy.content.template_file` with `engine: jinja`. There is no global <code v-pre>{{ }}</code> auto-render, and an ordinary argument containing <code v-pre>{{ ... }}</code> is rejected by the playbook lint.

Use `$jinja` for an inline expression or a small template. Rendering is strict: an undefined name throws instead of becoming an empty string.

The engine is **Nunjucks** plus an Ansible compatibility layer: common Ansible filters (`default`, `bool`, `combine`, `dict2items`, `items2dict`, `flatten`, `unique`, set operations, `regex_replace`/`regex_search`/`regex_findall`, `b64encode`/`b64decode`, `basename`/`dirname`, `to_json`/`from_json`, `to_yaml`/`from_yaml`, `ternary`, `type_debug`, `version_compare`, `quote`, `checksum`/`hash`) and tests (`is defined`, `is none`, `is match`, `is search`, `is version_compare`, …) are available. Macros, imports/extends, `loop.index`, and `{% set %}` blocks work. Ansible `lookup()`/`query()` are intentionally unsupported and fail with guidance; the converter hands those off.

```yaml
- name: inline Jinja expression
  debug:
    msg:
      $jinja: "{{ vars.port }}"

- name: inline Jinja template
  shell:
    run_mode: always
    command:
      $jinja: |
        {% for site in vars.sites %}server {{ site }}
        {% endfor %}
```

For a whole file, keep the Jinja in a `.j2` asset and point `copy` at it:

```yaml
- copy:
    dest: /etc/app/app.conf
    content:
      template_file: app.conf.j2
      engine: jinja
```

```jinja
# app.conf.j2
listen {{ vars.port }}
{% for site in vars.sites %}
server {{ site }}
{% endfor %}
```

## Which to use

- Simple value substitution in an argument → a structured ref (`$var`, `$concat`).
- One-off interpolated string in an argument → `$template` (EJS).
- Rendering a whole config/file → `copy` with `content: { template_file }` and `engine: ejs` (EJS, the default). For an existing Ansible `.j2` template, keep the file and set `engine: jinja`; for an inline Jinja expression, use `$jinja`.

**EJS vs Jinja.** EJS is the default for a reason: it is much faster than Jinja and supports full JavaScript logic in templates. When isolation is enabled, EJS/Eta templates now render in the same sandbox worker as Jinja; Eta is executable JavaScript, so do not run untrusted Eta/EJS templates with `--isolation none`.

Eta/EJS, `$template`, and `$call` helpers are **restricted code**: executable code that
must be operator-approved per project (`templates.allow_restricted_code` /
`allow_restricted_helpers` in `isolation.yaml`). `copy` Eta/EJS renders in the sandbox
worker when isolation is enabled; `$template` and `$call` still run in-process and require
`--allow-unsafe-template-code` until their worker path lands. Jinja is a bounded template
language and is not gated; `$jinja` renders it in-process, while a `.j2` file via `copy` uses the sandbox worker when isolation is enabled. See [Isolation & Sandboxing](/concepts/isolation#restricted-code-and-approval)
for the definition and current status. Jinja is the safer choice when templates come from untrusted sources — with isolation enabled it renders in a sandbox with no filesystem, network, or inherited environment — and it can often run existing Ansible templates with minimal changes. In short: use EJS for speed and flexibility; reach for Jinja when you need compatibility with Ansible templates or sandboxing of untrusted template code.
