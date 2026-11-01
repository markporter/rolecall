---
title: Secrets
---

Secrets such as passwords and API keys must never be committed or printed in logs.
Treat every credential as sensitive first-class data: keep it out of
version-controlled YAML, never echo it into CLI output, and rotate anything that
ever leaked.

Source secrets from your platform's secret manager or environment and inject them at
run time — for example through `--extra-vars`, a generated inventory kept outside
version control, or environment variables consumed by your provider of choice. This
keeps the control plane free of stored credentials while still letting tasks receive
them.

Follow defensive habits around the inputs you manage:

- Keep inventory and playbook files readable only by the operators who need them,
  and restrict file permissions tightly.
- Avoid embedding tokens directly in shared `vars`; prefer per-environment injection.
- Watch the JSON and trace output paths — machine-readable renders serialize every
  value that reaches them, so never pass a secret as a task argument you also log.
- Rotate credentials on a schedule and immediately after any exposure.

For how inventory carries variables that might include secrets, read
[/concepts/inventory](/concepts/inventory).
