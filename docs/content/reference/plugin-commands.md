---
title: Plugin Commands
---

Plugin commands enumerate and register user modules that extend RoleCall's capabilities. Project plugins under `plugins/<type>/<namespace>/` are discovered automatically at `playbook run` and need no registration; `plugin register` persists a module that lives outside a project (or shares it machine-wide via `--global`).

Reach the surface with `rolecall plugin [action] [args...]`; when omitted, `action` defaults to `list`.

`rolecall plugin list` merges the registered module/fact plugins (from `<root>/.rolecall/plugins.json` and `~/.rolecall/plugins.json`) with the built-in inventory plugins:

```text
Registered plugins (3):
  - static (inventory, inventory)
  - dynamic (inventory, inventory)
  - demomod (module, plugin) -> /abs/demomod.ts
Note: module/fact plugins are registered via `plugin register`; inventory plugins are built-in
```

`rolecall plugin register <name> --path <file> [--global]` loads `<file>`, validates that it exports a RoleCall `Module`, and persists it to the plugin manifest. Project-local registration writes `<root>/.rolecall/plugins.json`; pass `--global` to write `~/.rolecall/plugins.json` instead. At CLI startup `main()` auto-loads every registered entry (`loadRegisteredPlugins()`), so the module is immediately dispatchable by `playbook run` and any facts it declares are wired into `var_strict`. See [/reference/writing-a-plugin](/reference/writing-a-plugin) for how to author a module.
