---
title: loadPlaybookFile
kind: function
longname: module:config.loadPlaybookFile
description: Read a playbook YAML file, expand imports / include_tasks at load time, and return its normalized array of plays. Expansion is the single chokepoint for import_playbook / include_tasks , so downstream consumers (skeleton, task counts, executor) always see the fully-resolved task list. Reads through the VFS seam so a non-disk ProjectSource can serve playbooks unchanged. The document root must be a top-level list of plays; a bare object is rejected by {@link module:config.loadPlaybook|loadPlaybook}.
---

# loadPlaybookFile

<Signature
  code="loadPlaybookFile(
	path: string,
	source: ProjectSource,
): Promise<NormalizedPlaybook[]>"
/>

<SourceLink href="/source/src/config/loader-ts/#L857" label="loader.ts:857" />

**Modifiers:** `async`

Read a playbook YAML file, expand `imports`/`include_tasks` at load time, and return its normalized array of plays. Expansion is the single chokepoint for `import_playbook` / `include_tasks`, so downstream consumers (skeleton, task counts, executor) always see the fully-resolved task list. Reads through the VFS seam so a non-disk ProjectSource can serve playbooks unchanged. The document root must be a top-level list of plays; a bare object is rejected by [loadPlaybook](/module/config/loadplaybook).

**Parameters**

- `path` (string) — Path to the playbook YAML file (relative paths resolve against the source root).
- `source` (ProjectSource, default: "...") — Optional project VFS; defaults to reading from the current working directory.

**Returns**

- `Promise<`[`NormalizedPlaybook`](/module/config/normalizedplaybook)`[]>` — The normalized, fully-expanded array of plays.
