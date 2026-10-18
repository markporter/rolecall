# ADR 0005: Docs-site deployment — GitHub Pages

- **Status:** Accepted (recreated 2026-10-18; the original ADR file was lost in the
  jim→RoleCall rename — this restores the decision record)
- **Deciders:** Mark Porter
- **Date:** 2025-12-08 (original) · 2026-10-18 (restored)

## Context

RoleCall needs a public home for the VitePress user guide and TypeDoc API
reference. Candidates considered: GitHub Pages, Cloudflare Pages, Vercel, Netlify.
The repo already lives on GitHub; CI (test matrix + native binaries) runs on
GitHub Actions.

## Decision

**GitHub Pages, deployed via GitHub Actions** (`.github/workflows/docs.yml`).

- Free for the public repo; auto-provisioned/renewed Let's Encrypt HTTPS.
- Zero extra accounts or services — everything stays in the repo that already
  drives CI.
- The `docs` workflow builds the guide on every push to `main` and deploys the
  Pages artifact. The build passes `--base=/rolecall/` so the site works under the
  `markporter.github.io/rolecall` subpath.

## Domain strategy (staged)

Docs launch at `https://markporter.github.io/rolecall`. A custom domain attaches
later with **zero link breakage**: once a custom domain is set, GitHub 301-redirects
the github.io URL to it, so published links never die. The one migration chore is
flipping the VitePress `--base` from `/rolecall/` to `/` in `docs.yml` when the
domain lands. Domain shortlist and wire-up steps live in `.local/domain-shortlist.md`
(registrar: Hover). Candidate shortlist (verified available, not yet purchased):
`rolecall.ing`, `rolecall.run`, `rolecall.fyi`, `rolecall.zip`.

## Alternatives considered

- **Cloudflare Pages** — faster global CDN and free PR-preview deployments, but a
  second account and a separate build/deploy integration. Deferred; a future
  migration trigger would be a need for per-PR preview URLs.
- **Vercel / Netlify** — polished DX and previews, but tie the public docs to a
  third-party account and billing surface for a project that has none of those
  needs yet.

## Consequences

- The TypeDoc API site (`docs/api`) is not yet part of the Pages deploy — the
  initial deploy serves the VitePress guide + reference + concepts. Integrating
  the API site is a follow-up.
- Enabling Pages requires a one-time repo setting: Settings → Pages → Source =
  "GitHub Actions".
