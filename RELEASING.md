# Releasing RoleCall

RoleCall uses a **tag-driven** release flow. Publishing is triggered by pushing a
`v*` tag; the `release` workflow re-runs full CI, builds one native binary per OS,
creates the GitHub Release with the binaries attached, and publishes to npm.

> Alpha reminder: RoleCall is pre-1.0. Releases are for testing; breaking changes
> land between versions. Pin exact versions.

## Cutting a release

1. **Bump the version** in `package.json` (must match the tag, minus the `v`):

   ```sh
   # edit "version": "x.y.z" in package.json, then:
   bun run build      # type-check + regenerate embedded docs
   bun test           # must be green
   git add package.json src/docs/embedded-content.ts docs/content/reference/module-reference.md
   git commit -m "release: bump version to x.y.z"
   ```

2. **Tag and push the tag** (not the branch — the tag is the trigger):

   ```sh
   git tag -a vx.y.z -m "vx.y.z"
   git push origin main          # push the commit first
   git push origin vx.y.z        # push the tag → triggers the release workflow
   ```

3. **Watch the run**: Actions → `release`. It runs the CI gate, builds the
   binaries, creates the GitHub Release (auto-generated notes + attached
   binaries), and publishes to npm.

## What gets published

- **GitHub Release** — auto-generated notes from the commit history, plus one
  compiled binary per platform: `rolecall-linux-x64-musl`,
  `rolecall-linux-arm64-musl`, `rolecall-darwin-arm64-musl`,
  `rolecall-windows-x64`. These are Bun-compiled, zero-dependency executables.
- **npm** — the `rolecall` package. The published bin is `lib/cli.js`, a Node
  bundle built by `prepack` (`bun run build:js`). Installable with
  `npm i -g rolecall` on Node >= 22.19 (no Bun needed).

## One-time npm setup (before the first npm publish)

The npm job **skips cleanly** when the `NPM_TOKEN` secret is absent, so a
binaries-only release works with zero configuration. To enable npm publishing:

1. Create an npm account and enable 2FA (npm requires it for publishing):

   ```sh
   npm profile enable-2fa auth-and-writes
   ```

2. Create a **granular access token** on npmjs.com (Automation type, bypasses the
   2FA prompt in CI) with publish rights for `rolecall`, OR set up **npm Trusted
   Publishing** (OIDC — preferred, no stored secret): on npmjs.com → the package
   → Settings → Trusted Publisher → GitHub Actions, with repository
   `markporter/rolecall` and workflow `release.yml`.

3. If using a token, add it as a repo secret: Settings → Secrets and variables →
   Actions → New secret, name `NPM_TOKEN`. (Trusted Publishing needs no secret —
   the workflow already requests `id-token: write` for provenance.)

4. Recommended after first publish: `npm owner add <backup-user> rolecall` (account
   loss = name loss).

## Docs site

The VitePress guide deploys to GitHub Pages on every push to `main` via the
`docs` workflow (see ADR 0005). It currently serves at
`https://markporter.github.io/rolecall`; a custom domain can be attached later
with no link breakage (GitHub 301-redirects the github.io URL). See
`.local/domain-shortlist.md` for the domain shortlist and wire-up steps.

## Versioning

Pre-1.0 there is no strict semver guarantee — `0.x` signals instability and any
minor/patch may break. The version exists mainly to correlate npm, the git tag,
and the GitHub Release.
