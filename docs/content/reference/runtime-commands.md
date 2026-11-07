---
title: Runtime Commands
---

# Runtime Commands

`rolecall runtime` manages the **optional** standalone Bun toolchain (ADR 0023
§5). The native RoleCall binary already embeds Bun, so the external toolchain is
not needed for normal use; it is for source-mode work, `bun install`, or a general
Bun CLI.

```sh
rolecall runtime install [--bun-version <ver>] [--from-dir DIR] [--add-bun-to-path] [--dry-run|--yes]
rolecall runtime status
rolecall runtime remove [--bun-version <ver>] [--dry-run|--yes]
```

- `install` resolves the version from `--bun-version`, a local artifact's
  `version.txt`, or the latest Bun GitHub release, then installs it under
  `<programDir>/runtime/bun/<version>/`.
- `status` reports `embedded` (with the Bun version compiled into the binary) or
  the installed external toolchain, plus every version found under the runtime
  root.
- `remove` deletes one version (or all versions) and updates the install
  manifest. `--dry-run` is the default; pass `--yes` to apply.
- `--add-bun-to-path` creates a `binDir/bun` symlink; without it the toolchain
  stays off PATH.
- System-scope changes require root/Administrator and still never run the
  toolchain as root.

## Local artifacts

`--from-dir DIR` expects either `DIR` itself or `DIR/bun/` to contain:

```text
bun            # bun.exe on Windows
version.txt
SHA256SUMS     # optional
```

This is the offline/air-gapped path and the same layout the bootstrap can stage.
`rolecall install --with-bun --from-dir DIR` uses `DIR/bun/` when present.

## Network installs

Without a local artifact, `runtime install` downloads the platform archive from
the `oven-sh/bun` GitHub release, verifies the SHA-256 from `SHASUMS256.txt`, and
extracts it with `unzip` or `tar` (Windows uses the bundled `tar.exe`). Set
`GITHUB_TOKEN`/`GH_TOKEN` only if you need a higher GitHub API rate limit.

## Install-time integration

`rolecall install --with-bun [--bun-version <ver>]` installs the toolchain and
records its version in `install.json` (`runtime: <version>` and `runtimePath`);
without it the manifest records `runtime: embedded`. The toolchain is never
installed by default and is updated separately from the RoleCall binary.
