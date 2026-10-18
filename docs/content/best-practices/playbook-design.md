---
title: Playbook Design
---

Playbook design groups tasks, plays, and structure for clarity and reuse. Every task should carry a short human `name` and exactly one `module`; reserve `args` for structured key/value data and lean on the documented extras like `when`, `loop`, `notify`, and `register` only when they earn their place. Because the schema is strict, unknown keys fail fast at load time, so validate early before scaling anything up.

Order tasks by dependency, not convenience: put package installation ahead of service startup so a later task has something to configure. Use `strategy: free` sparingly and prefer the default `linear` gating until you have a reason to let hosts race ahead of one another. Keep play-level fields such as `serial` and `strategy` out of individual tasks, and attach triggers like `cron` specs at the play level where they belong. The fixture `tests/fixtures/playbook.valid.yaml` demonstrates a compact, valid arrangement worth mirroring.

One honest caveat shapes how much design freedom exists right now: templating stays literal, meaning `"{{ http_port }}"` never substitutes until a full Jinja renderer lands. Execution is otherwise live — `notify` handlers, `run_once`, and `delegate_to` act during a real run over SSH or local transports, driven through `rolecall_connection`. Write clean, validated YAML today. See [/reference/playbook-commands](/reference/playbook-commands) for the command side.
