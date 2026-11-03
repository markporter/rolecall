# 0029 — Update distribution, signed manifests, and channels

- Status: **Proposed**
- Date: 2026-11-03
- Related: ADR 0023 (install layout, install manifest, versioned upgrades, update/rollback), ADR 0018 (npm/Bun/binary channels), ADR 0002 (single-file binary), ADR 0027 (no HTTP update surface), ADR 0028 (security control index)

## Context

ADR 0023 defines a versioned install layout (`versions/<ver>/` + `current`) and an
operator-run `rolecall update`, but leaves the distribution source open. The current
implementation only supports `--from-dir` and `--rollback`; there is no network
discovery, signed metadata, channel model, install-kind handling, database-migration
guard, or health-check rollback yet.

A separate release website or channel service would add infrastructure and another
trust surface. The project already publishes binaries and release notes on GitHub
Releases, and `package.json` already records the repository. GitHub can be the
transport for updates without becoming the trust root.

The project is currently **alpha**. Channels such as stable, beta, rc, and branch
channels are not useful until the beta milestone. We still need a signed update
protocol now so alpha users can update deliberately and so the scheme does not need
a redesign later.

## Decision

### 1. GitHub Releases are the transport; no separate website

- Release artifacts, `release.json`, its detached signature, and `SHA256SUMS` are
  uploaded as GitHub Release assets.
- The default update source is the repository recorded in `package.json`
  (`markporter/rolecall`). `ROLECALL_UPDATE_URL` / `--update-url` point at a mirror,
  GitHub Enterprise, or an internal artifact store.
- GitHub Pages is optional and only a convenience for a stable channel-index URL. It
  is not required for pre-beta updates.
- No HTTP/API route triggers updates (ADR 0027). Update is an operator CLI action.

### 2. Signed `release.json` is the trust anchor

Every release publishes a manifest:

```json
{
  "schemaVersion": 1,
  "version": "0.0.4",
  "tag": "v0.0.4",
  "releasedAt": "2026-11-03T00:00:00Z",
  "keyId": "rolecall-release-2026",
  "artifacts": {
    "linux-x64": {
      "url": "https://github.com/markporter/rolecall/releases/download/v0.0.4/rolecall-linux-x64",
      "sha256": "…",
      "size": 12345678
    }
  }
}
```

- `release.json.sig` is an **Ed25519 detached signature** over the exact manifest
  bytes, verified with `node:crypto` on Bun and Node.
- One or more public keys are embedded in the binary, keyed by `keyId`. Key rotation
  is introduced by a release signed with the previous key.
- Verify the signature **before parsing or acting on the manifest**, then verify the
  selected artifact’s SHA-256 and size.
- TLS is not a substitute for the signature. A mutable “latest” pointer is never
  trusted without the signed manifest.
- There is no `--insecure` bypass. `--from-dir` / `--offline` use the same signature
  and checksum verification.

The release workflow generates the manifest from the built artifacts, signs it, and
uploads `release.json`, `release.json.sig`, and `SHA256SUMS` beside the binaries.

### 3. Pre-beta: one update stream, no channels

Until the beta milestone:

- There is **no `--channel` selection and no signed channel index**.
- `update --check` lists non-draft GitHub Releases and selects the highest semver
  among the single pre-beta stream; GitHub’s `prerelease` boolean is not a channel.
- `release.json` omits the `channel` field.
- The install manifest does not record a channel.
- Published alpha releases are the stream. Users may still pin `--version` /
  `--from-dir` / `--offline`.
- The update protocol (signature, checksum, staging, atomic switch, rollback,
  migration guard, health check) is implemented now.

This keeps alpha operation simple while proving the trust and rollback path that
beta channels will reuse.

### 4. Beta: explicit channels with a signed channel index

Channels are introduced after the project is ready for beta. They are an explicit
RoleCall concept, not a GitHub UI flag.

Publish a signed channel index on GitHub Pages (or as a rolling release asset):

```json
{
  "schemaVersion": 1,
  "keyId": "rolecall-release-2026",
  "channels": {
    "stable": {
      "version": "0.1.0",
      "tag": "v0.1.0",
      "manifest": "https://…/releases/download/v0.1.0/release.json"
    },
    "beta": {
      "version": "0.1.0-beta.2",
      "tag": "v0.1.0-beta.2",
      "manifest": "https://…/releases/download/v0.1.0-beta.2/release.json"
    },
    "branch-feature-foo": {
      "version": "0.1.0-feature-foo.3",
      "tag": "branch-feature-foo-v0.1.0.3",
      "manifest": "https://…/releases/download/branch-feature-foo-v0.1.0.3/release.json"
    }
  }
}
```

- The index is signed with the same key and verified before use.
- Channel IDs are slugs (`stable`, `alpha`, `beta`, `rc`, `branch-<slug>`).
- `release.json` gains a required `channel` field.
- Tags and `channel` are separate: the tag is an address, the manifest says which
  channel the release belongs to.
- Stable releases have no semver prerelease suffix. Alpha/beta/rc use semver
  prerelease identifiers. Branch channels use `branch-<slug>` and a sanitized tag
  prefix.
- The install manifest records `channel`; `update` defaults to the installed
  channel. `--channel` switches streams; `--version` pins a release; downgrades
  require `--version` plus `--allow-downgrade`.
- CI adds/updates/removes channel-index entries. Branch channels are ephemeral and
  may be deleted after their branch retires.
- At beta, `rolecall install --channel <id>` and `rolecall update --channel <id>`
  become available; before beta they are rejected as not implemented.
- If no channel index is configured, the beta client falls back to the pre-beta
  single-stream enumeration.

### 5. Update flow and safety

`update --check`:

1. Read the installed version and install kind from `install.json`.
2. Fetch the signed channel index (beta) or enumerate releases (pre-beta).
3. Verify signatures/checksums for metadata only; do not download artifacts.
4. Select the artifact for OS/arch and compare semver.
5. Print current/latest/channel/artifact; exit non-zero when an update exists.

`update`:

1. Re-verify metadata and select the artifact.
2. Download to a temp file on the same filesystem as the program directory.
3. Verify signature, SHA-256, size, and platform/arch.
4. Run `<newbin> --version` as a smoke check.
5. Check the state DB schema; back up the DB and refuse unsupported migrations.
6. Stop/drain the service (unless `--no-restart`).
7. Install into `versions/<version>/` and atomically flip `current`.
8. Update `install.json` (`currentVersion`, `previousVersion`) and retain the
   previous N versions.
9. Restart and health-check (`/health` or `--version`); on failure, flip back to the
   previous version and report.

`--rollback` switches `current` back to the recorded previous retained version.
Network/channel discovery failures are fatal before any mutation. Running CLI
processes keep the old inode; only new invocations and restarted services see the
new version.

### 6. Install-kind awareness

`install.json` records `kind`:

- `binary`: full self-update as above.
- `npm` / `bun -g`: never mutate `node_modules`; print or run (with explicit
  `--yes`) the package-manager command, e.g. `npm i -g @rolecall/cli@<version>`.
- `os-package`: delegate to apt/dnf/brew/MSI; never replace package-owned files
  behind the package manager.

### 7. Discovering updates pre-beta

Because alpha releases are GitHub prereleases, `/releases/latest` is not suitable.
The client lists releases (`GET /repos/<owner>/<repo>/releases?per_page=…`), ignores
drafts, and selects the highest semver in the single stream. A
`GITHUB_TOKEN`/`GH_TOKEN` is optional for public repositories and required for
private ones. `--update-url` can point at a mirror; the signed manifest remains the
trust anchor.

## Non-goals

- Background/auto update or an HTTP update endpoint.
- A release website or separate channel service.
- Trusting GitHub’s `prerelease` boolean as a channel.
- Unsigned artifacts or an `--insecure` mode.
- Channels before beta.

## Consequences

- Pre-beta update code must carry the manifest/signature/checksum/staging/
  rollback/migration/health path, but only one stream.
- Beta adds a signed channel index and `channel` in `release.json` without changing
  artifact or rollback formats.
- Release CI gains manifest generation and signing steps; the release signing key
  becomes a release-critical secret.
- Private repositories and mirrors need update auth/mirror configuration.
- GitHub API rate limits and pagination are part of pre-beta discovery.

## Work items

1. Generate `release.json`, sign it (Ed25519), and upload it with `SHA256SUMS` in the
   release workflow; add signature-verification fixtures.
2. Add `src/install/release.ts`: schema, GitHub pre-beta discovery, fetch,
   signature/checksum verification, platform selection, mirror support.
3. Extend `update --check` to the pre-beta stream; keep `--from-dir`/`--offline`.
4. Implement download/stage/swap/restart/health/rollback plus state-DB backup and
   migration guard.
5. Add install-kind handling (`binary`, `npm`, `bun -g`, `os-package`).
6. At beta: add the signed channel index, `channel` in manifests, `--channel`,
   branch-channel CI, and install-manifest channel pinning.
7. Wire `install.sh`/`install.ps1` to the same signed metadata.

## Alternatives considered

- **Separate release website** — rejected: more infrastructure and another trust
  surface; GitHub Releases already carries the artifacts.
- **GitHub `prerelease` as the channel model** — rejected: it is a boolean, not a
  channel; alpha/beta/rc/branch channels need explicit metadata.
- **Unsigned latest release** — rejected: mutable pointers and mirrors require a
  signature anchor.
- **Enumerating releases for beta channels** — viable but API-heavy; the signed
  channel index is the planned beta path, with enumeration as a fallback.
- **Auto-update** — rejected: updates remain explicit operator actions.
