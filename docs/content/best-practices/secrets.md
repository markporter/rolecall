---
title: Secrets
---

Secrets such as passwords and API keys must never be committed or printed in logs.

Secrets such as passwords and API keys must never be committed or printed in logs. Treat every credential as sensitive first-class data: keep it out of version-controlled YAML, never echo it into CLI output, and rotate anything that ever leaked. RoleCall ships no secret store today, so sourcing, masking, and encryption are all `[deferred]` past MVP rather than features you can rely on.

Until a backend exists, follow defensive habits around the inputs you do manage. Keep inventory and playbook files readable only by the operators who need them, restrict file permissions tightly, and avoid embedding tokens directly in `vars`. When values must vary between environments, prefer passing them through controlled means instead of hardcoding them in shared files. Watch the JSON output path too, because machine-readable renders serialize everything that reaches them.

This page lists safe-handling principles precisely because no specific secret backend is implemented yet. Do not build production reliance on secret management here until Wave 0 scaffolding becomes a real subsystem, and plan around external vaults or environment-provided values in the meantime. For how inventory carries variables that might include secrets, read [/concepts/inventory](/concepts/inventory).
