---
title: Templates (EJS & Jinja)
---

RoleCall has three ways to inject dynamic content, in order of preference:

1. **Structured refs** (`$var`, `$concat`, `$call`, `$if`, `$each`) — the safe, escapeless, type-checked default. Use these for argument values whenever possible. Covered in [Playbook operators](/concepts/playbook-operators).
2. **EJS templates** — the default renderer for anything needing real string interpolation, whether inside a single value (the `$template` operator) or a whole file (`copy` with `engine: ejs`, which is the default). EJS uses `<%= %>` for output and `<% %>` for logic.
3. **Jinja templates** — *opt-in only*, via `copy` with `engine: jinja`. Use Jinja when a template comes from an existing Ansible project (so you can drop it in with minimal changes) or when you want its sandboxed execution for untrusted template code.

RoleCall deliberately does **not** auto-render <code v-pre>{{ }}</code> as a global template engine. A literal <code v-pre>{{ ... }}</code> written in an argument is passed through verbatim. Templating is *opt-in*: you either use a structured ref, wrap a value in `$template`, or render a file with `copy`'s `engine`.

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

`copy` renders a `content` template spec on the target host. The default engine is **EJS**; pass `content.engine: jinja` to switch:

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
      template_file: vhost.j2
      engine: ejs
```

## Jinja templates

Jinja uses <code v-pre>{{ expr }}</code> for output and `{% ... %}` for logic — the syntax Ansible users know. In RoleCall, Jinja is **only** available through `copy` via a `content` template spec with `engine: jinja`; there is no global <code v-pre>{{ }}</code> auto-render, so a bare <code v-pre>{{ ... }}</code> elsewhere stays literal.

```yaml
- copy:
    dest: /etc/app/app.conf
    content:
      template_file: app.conf.j2
      engine: jinja
```

```jinja
# app.conf.j2
listen {{ port }}
{% for site in sites %}
server {{ site }}
{% endfor %}
```

## Which to use

- Simple value substitution in an argument → a structured ref (`$var`, `$concat`).
- One-off interpolated string in an argument → `$template` (EJS).
- Rendering a whole config/file → `copy` with `content: { template_file }` and `engine: ejs` (EJS, the default). Reach for `engine: jinja` only when reusing an existing Ansible template or you need its sandbox.

**EJS vs Jinja.** EJS is the default for a reason: it is much faster than Jinja and supports full JavaScript logic in templates. Jinja is the safer choice when templates come from untrusted sources — its sandbox limits what the template can do — and it can often run existing Ansible templates with minimal changes. In short: use EJS for speed and flexibility; reach for Jinja when you need compatibility with Ansible templates or sandboxing of untrusted template code.
