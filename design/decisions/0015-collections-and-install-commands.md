# 0015 — Collections & Install Commands (RoleCall-native dependency distribution)

- Status: **Proposed**
- Date: 2026-10-12
- Supersedes: refines the npm `imports:` distribution of [ADR 0007](superseded/0007-project-layout-and-npm-distribution.md) with a RoleCall-native collections mechanism (no npm / no node_modules graph)
- Related: [ADR 0007](superseded/0007-project-layout-and-npm-distribution.md) (project layout, recursive imports), [ADR 0009](0009-ansible-compatibility-and-mechanical-conversion.md) (Ansible compatibility), [ADR 0014](0014-project-and-plugin-architecture.md) (folder-project + resolution), [ADR 0005](0005-io-abstractions-vfs-db-scratch.md) (VFS backends)

## Context

The user needs a Galaxy-equivalent for RoleCall: a way to share and reuse modules, roles, and plugins across projects. ADR 0007 proposed npm as the distribution channel (`rolecall.yaml imports:` → `node_modules` → FQCN). But that drags in the npm/node_modules resolution problem — which ADR 0014 deliberately avoids at runtime by making plugins single-file, JIT-bundled, or node_modules-emitted *at build time*. Since "everything is a project" (ADR 0014), a dependency can simply **be another RoleCall project**. Borrowing Ansible's `collections` concept gives a RoleCall-native distribution mechanism that needs no npm, no module-graph resolution at runtime, and aids ADR 0009 migration (it mirrors `requirements.yml` + `ansible_collections/`).

Two distinct operations must not be conflated:
- **`rolecall install`** creates the **central RoleCall runtime** (bootstraps bun itself). It is *not* project hydration.
- **`rolecall collections install`** **hydrates a local project** — it fetches the project's declared dependency projects into `collections/`.

This ADR records the collections mechanism and the precise semantics of both commands.

## Decision

### 1. `collections.yml` — the manifest (committed)

A project root may contain `collections.yml` listing the collections it depends on. It is the source of truth and is committed:

```yaml
collections:
  - name: myorg.networking
    version: 1.2.0
    source: git+https://github.com/myorg/rolecall-networking
  - name: otheorg.web
    source: ./vendor/web            # local path
```

Each entry: `name` (`namespace.name`), `version`/`ref` (pinned), and `source` (see §4). This replaces the npm-oriented `imports:` of ADR 0007.

### 2. `collections/` — the resolved directory

Fetched collections land at `collections/<namespace>/<name>/`, and **each is a full folder-project** per ADR 0014 (its own `plugins/`, `roles/`, `playbooks/`, and optionally its own `collections.yml`). For dev, `collections/` is the resolved/gitignored working copy; for a baked deploy it is populated at build and shipped.

### 3. A collection is a folder-project

Because a collection has the same shape as any project, once downloaded its `plugins/` and `roles/` are discovered by the **same scanner** ADR 0014 defines — no format translation. A collection can declare its own `collections.yml`; RoleCall walks the dependency DAG recursively, de-duplicates by `(namespace, name, version)`, and detects cycles (the recursive-import resolution ADR 0007 already planned, now pointed at RoleCall projects).

### 4. Fetch sources

Support, in priority order:
1. **Git URL** (`git+https://…`, `git+ssh://…`) — no registry server required, batteries-included.
2. **Local path** (`./vendor/web`, `../sibling`) — for vendored or in-repo collections.
3. **RoleCall registry ref** (optional, later) — a registry backed by an S3/DB VFS (ADR 0005). Deferred; git/local cover the common case without standing up a service.

### 5. Precedence

When a plugin name resolves, **project-local `plugins/` overrides a collection's same-named plugin** (Ansible: local > collection); **builtins are reserved for bare names** (ADR 0014 §5). So a bare `firewall` is builtin-or-error; `myorg.firewall` is unambiguous; a project may shadow `myorg.firewall` with its own local `plugins/modules/myorg/firewall.ts`.

### 6. Pinning + lockfile

`collections.yml` pins `version`/`ref`. `rolecall collections install` emits a `collections.lock` recording the resolved content hashes for reproducible, offline-safe builds.

### 7. The two install commands (central runtime vs project hydration)

- **`rolecall install` → central RoleCall runtime only.** It downloads/unpacks a pinned, checksum-verified bun runtime into `~/.rolecall/runtime/` (or uses the embedded/provided bun) and sets up RoleCall's own runtime environment. It does **not** hydrate projects. An `--offline` / vendored mode uses the bun already embedded in the standalone binary (`bun build --compile` embeds bun) or a vendored copy — so air-gapped hosts need no download. This is the "batteries included" bootstrap.
- **`rolecall collections install` → local project hydration.** It reads `collections.yml`, fetches each collection into `collections/`, recurses with cycle detection, and may **pre-bundle** collected plugins (emit their `_bundled.js`) so a baked deploy ships self-contained artifacts and needs no runtime JIT or transient install.

### 8. Build-time vs runtime

Hydration (`rolecall collections install`) runs at build (CI / Dockerfile / pre-bake), so **runtime is network-free** — it only reads the already-populated `collections/` and resolves via ADR 0014. A runtime JIT collection download is an opt-in dev convenience only, never required for serverless/container/read-only.

### 9. Pre-bundled collections

Because `rolecall collections install` can bundle collected plugins, a hydrated `collections/` typically ships `_bundled.js` artifacts; resolution then takes the §4.1 (bundle-present) fast path with no JIT and no transient install.

### 10. Discovery is separate from distribution (web-by-convention, no RoleCall infrastructure)

A collection is a public git repo; Google/GitHub search already indexes its README + metadata, so `search "rolecall collection <problem>"` surfaces it — the same mechanism by which git-first Terraform/Ansible modules are discovered in practice. **No RoleCall server is needed for discovery.** To make this reliable, RoleCall defines authoring conventions that maximize web/GitHub findability:

- The collection's **root manifest** carries `name`, `description`, `keywords`, `categories` (a small controlled vocabulary: `networking`, `database`, `web`, `security`, `cloud:aws`, …), `author`, `license`, `minRolecallVersion`.
- The **README** states "RoleCall collection" + the problem solved + keywords, so web search indexes the right phrases.
- **Git repo topics**: `rolecall`, `rolecall-collection`, `<category>` — so GitHub topic search (and a later `rolecall collections search`) works.
- **`rolecall collections lint`** enforces complete metadata (description + keywords + categories present), nudging authors to be findable.

A curated `collections-index.yaml` (+ optional `rolecall collections search` over git-host topic search) is an **additive convenience** later; a full searchable registry (hosted artifacts + provenance) is a further optional upgrade. The resolver indirection (`ROLECALL_PROXY`, default `direct`) means a registry is a later endpoint with no client rework. **Private** (non-web-indexed) collections use an internal index or git-host search. Net: `rolecall collections install` fetches from the resolved `source` (git/local); discovery rides on the web by convention.

### 11. Publisher & user discoverability guide

Discovery rides on the web (§10): a collection is a public git repo, indexed by Google/GitHub from its README + manifest metadata + git topics — no RoleCall server required. This section turns that into concrete checklists for **publishers** (how to be found) and **users** (what to search for). The commands referenced here — `rolecall collections lint`, `rolecall collections search` — are **planned** (not yet in the Work items list); today the discovery path is the web + git-host search. This guide is **collection-specific** and expands §10; it does **not** redefine the manifest fields (those are §10) or the `collections.yml` project-dependency list (§1). Module/role distribution via npm (retired ADR 0007) has been replaced by RoleCall-native collections; this guide is collection-specific and does not redefine the distribution mechanism (§1–§9).

#### 11.1 For publishers — make your collection findable

1. **Fill the collection root manifest completely.** These fields drive every search surface (mirrors Ansible `galaxy.yml`, npm `package.json`, and Terraform's auto-ingest). Required for a findable collection:
   - `name` — `<namespace>.<name>`; lowercase, namespace-scoped (like Ansible namespaces / npm scopes).
   - `description` — one sentence; becomes the repo description and the primary web-search match. Both npm ("recommend including a custom `description`") and Ansible flag this as the #1 findability field.
   - `keywords` — array of strings; indexed by web + future `rolecall collections search` (npm: keywords "help people discover your package").
   - `categories` — pick from the controlled vocabulary (`networking`, `database`, `web`, `security`, `cloud:aws`, …); analogous to Terraform module categories / Ansible tags; keeps browse-by-category consistent.
   - `author` — attribution.
   - `license` — SPDX id; filterable and an enterprise-adoption signal (npm requires SPDX; Terraform recommends a LICENSE file).
   - `repository` — git URL; lets contributors (and a future index) find the source.
   - `minRolecallVersion` — compatibility signal.
2. **Ship a `README.md` at the collection root** covering: what it does, why it's useful, how to get started, where to get help, who maintains it (GitHub's own README guidance). The README **body is indexed by web search** (npm's website search matches name + description + README + keywords), so it is a first-class discovery input, not just docs. Ansible requires a `readme` in its manifest; Terraform requires a README per module; RoleCall requires a root `README.md`.
3. **Add git repo topics** (GitHub rules: lowercase + numbers + hyphens only, ≤ 50 chars each, ≤ 20 topics total):
   - `rolecall` — marks the repo as RoleCall-related.
   - `rolecall-collection` — the primary discovery hook; `topic:rolecall-collection` surfaces every RoleCall collection on GitHub.
   - `<category>` — one topic per `categories` entry (e.g. `networking`, `security`) so category browse works via `topic:<category>`.
   Classify by purpose / subject / community / language (GitHub's own topic guidance). These three topic classes are what make collections discoverable without a registry.
4. **Run `rolecall collections lint` (planned)** — it enforces §11.1.1–11.1.3 (present manifest fields + README + topics). Treat lint failures as "this collection won't be found," not just style.
5. **Version with SemVer tags** on the repo (e.g. `v1.2.0`) — mirrors Terraform/Google/GitHub release discovery and feeds `collections.yml` pinning (§1, §6).

#### 11.2 For users — what to search for

A collection is a git repo; find it like any open-source project, plus RoleCall-specific hooks:

- **Web search:** `rolecall collection <problem>` (e.g. "rolecall collection nginx tls") — Google/GitHub index the README + description + topics.
- **GitHub topic search (no RoleCall tooling needed):**
  - Web: `topic:rolecall-collection` lists all published RoleCall collections; `topic:<category>` (e.g. `topic:networking`) narrows by category.
  - CLI: `gh search repos --topic=rolecall-collection` (also `--topic=<category>`, `--language=`, `--stars=>N`, `--sort=stars`, `--json=...` for structured output). GitHub qualifiers `in:description`, `in:readme`, `topic:`, `language:` all apply.
- **In `collections.yml`:** once found, add it by `name` + `source` (git URL) + `version`/ref, then run `rolecall collections install` (§1, §7).
- **(Planned) `rolecall collections search <term>`:** a future CLI that queries a curated index (or a git-host topic search) over `name`, `description`, `keywords`, `categories`, `author`, `repository`. This fills a gap Ansible leaves open — `ansible-galaxy` has **no `collection search` subcommand** (only `role search`); Ansible collection discovery is web-UI/API-only. RoleCall's `rolecall collections search` would be net-new, not borrowed, and should index README body text to match npm's dominant search surface rather than only manifest fields.
- **Private collections:** not web-indexed; discover them via your internal git host's search or an internal `collections-index.yaml` (§10).

#### 11.3 Why convention-based discovery is enough

Git-first discoverability is proven by adjacent ecosystems: Ansible collections install from a `git+https` `requirements.yml` with no registry server; Terraform modules resolve from `git::` sources (the public registry is just an index/metadata layer over git); npm documents discovery via `description` + `keywords` + `README` + `repository`. RoleCall reuses the same levers (manifest metadata + README + git topics + web search) without operating a server. A central registry (hosted artifacts + provenance) remains a later optional upgrade (§10, resolved open questions).

## Consequences

**Positive**
- No npm, no `node_modules` graph, no runtime module resolution — composes directly with ADR 0014.
- Dependencies are just RoleCall projects; distribution reuses the folder-project shape rather than inventing a package format.
- Network-free runtime; fits serverless (bake `collections/` into the function package or read from S3-VFS), containers (bake into image), and read-only media (bake onto disc; VFS=local read-only).
- Ansible-faithful (`requirements.yml` + `ansible_collections/`), aiding ADR 0009.
- `rolecall install` and `rolecall collections install` are cleanly separated (runtime vs project), avoiding the earlier conflation of "install" with "build/packager."

**Negative / risk**
- A fetch layer must be built (git/local first; registry deferred).
- Git/local-first means **no central server is required**; discoverability is provided by web search + authoring conventions (README / manifest metadata / git topics), with an optional curated index + `rolecall collections search` later (see §10 and resolved open questions). Distribution and discovery are deliberately separate concerns.
- Transitive collection fetch widens the trust/attack surface; pin + lockfile + pre-bundle-from-trusted mitigate.

**Work items (implementation, not in this ADR)**
1. `collections.yml` schema + parser.
2. Fetch layer: git URL + local path.
3. Recursive fetch with DAG de-dup + cycle detection.
4. `rolecall collections install` (fetch + recurse + optional pre-bundle + lockfile).
5. `rolecall install` central-runtime bootstrap (pinned, checksummed bun; `--offline`/embedded).
6. Wire `collections/` precedence into the ADR 0014 resolver.

**Resolved open questions**
- Distribution / storage backend: **defer the S3/DB blob store.** Git-URL + local-path + `collections.lock` is the complete, proven model (Go `GOPROXY=direct`, npm git deps, Ansible `type:git`, Terraform `git::`) — no central server required. The resolver is built as a `ROLECALL_PROXY`-style indirection (default `direct`) so a registry is a later additive endpoint with no rework.
- Discovery: **by convention, via the web — no RoleCall infrastructure required** (see §10). Authoring conventions (manifest metadata + README + git topics + `rolecall collections lint`) make collections findable through Google/GitHub search; a curated `collections-index.yaml` + optional `rolecall collections search` is an additive convenience; a full searchable registry is a later optional upgrade.
- `collections/` default: **gitignored working copy** (dev); baked into the image/package at deploy (see §2, §8).

## References
- ADR 0007 (project layout, recursive imports), ADR 0009 (Ansible compatibility), ADR 0014 (folder-project + resolution), ADR 0005 (VFS/DbConn/ScratchVfs).
- Ansible `requirements.yml` / `ansible-galaxy collection install` (context grounding for the model).
- RoleCall source: `src/cli/commands/plugin.ts`, `src/store/plugin-store.ts`, `src/modules/loader.ts`, `src/config/loader.ts`.
- Ecosystem discoverability practice (grounding for §10–§11): Ansible Galaxy `galaxy.yml` metadata + tags and the `ansible-galaxy` CLI (note: no `collection search` verb — only `role search`); Terraform Registry module metadata / `category` + `git::` vs registry; npm `package.json` `description`/`keywords`/`repository` + website search over name/description/README/keywords; GitHub repository topics + `topic:` search qualifier / `gh search repos`. See `docs.github.com` (classifying-your-repository-with-topics, searching-for-repositories), `docs.npmjs.com` (package-json, searching-for-and-choosing-packages-to-download), `developer.hashicorp.com/terraform/registry`, `docs.ansible.com` (collections_galaxy_meta, galaxy/user_guide).
