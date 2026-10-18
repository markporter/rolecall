---
title: Deployment (Native Binaries)
---

Native binaries are standalone executables built from source with Bun's bundler.

Native binaries are standalone executables built from source with Bun's bundler. They embed the Bun runtime, so they run anywhere regardless of what interpreter sits on PATH, but they are Bun artifacts, not Node-compatible executables, so do not claim Node parity. Production builds go through `node scripts/build-bin.mjs`, aliased in package.json as `npm run build-bin`. The entry point compiled is `scripts/cli-native-entry.mjs`, a tiny wrapper that routes `--version`/`-v` before delegating everything else to the unchanged `src/cli/index.ts`.

Outputs land in `dist/bin/<name>-<platform>` named after the project (`package.json` sets `name` to `rolecall`), for example `dist/bin/rolecall-linux-x64-musl`. Build the default set with `npm run build-bin`, pin explicit ones with repeatable flags like `--target linux-x64-musl --target windows-x64`, cover every known platform with `--all`, or redirect output with `--out-dir dist/bin`. Each target maps to a Bun cross-compile override via `BUN_TARGET_OVERRIDE`, and you can point the builder at a custom bun executable through `BIN_BUN` or `BIN_BIN_PATH`.

The host binary is always smoke-tested automatically: the runner executes `<binary> --version` and fails the build if the version line does not start with `rolecall`. Non-host targets still compile so distribution paths exist, but this Linux x64 box can neither produce nor execute genuine non-host artifacts offline; true cross-compilation needs the matching OS or GitHub Actions, which drives one real per-OS build across a matrix. On Windows add `--windows-hide-console` so the exe does not pop a stray console window. See [/deployment/systemd](/deployment/systemd) for running the resulting binary under a supervisor.
