---
title: Ways to run RoleCall
---

RoleCall reaches your hosts through four channels. Pick whichever fits the machine: the npm package for a Node-only host, a Bun global install if Bun is already your default runtime, a standalone binary when you want a single executable with nothing else installed, or a source checkout while contributing.

> RoleCall is alpha software, pre-0.1.0 and for testing only. Breaking changes land without notice: playbooks, inventory shapes, CLI flags, and module parameters may all change before 0.1.0. Do not run it against production hosts, and pin exact versions if you experiment.

## npm (Node.js, no Bun needed)

The npm package runs on Node.js 22.19.0 or newer, and no Bun installation is required:

```sh
npm i -g rolecall
rolecall --help
```

For a one-off without installing anything globally:

```sh
npx rolecall --help
```

What npm ships is a Node bundle (`lib/cli.js`), so the full feature surface works on a plain Node machine. See [Install](/guide/install) for the engines floor and packaging details.

## Bun global install

If Bun is already on the host, install the package globally through it instead:

```sh
bun install -g rolecall
bunx rolecall --help
```

## Standalone binaries

Each GitHub Release attaches prebuilt executables that embed their runtime, so the host needs nothing else installed, not Node and not Bun. The four artifacts are:

- `rolecall-linux-x64-musl`
- `rolecall-linux-arm64-musl`
- `rolecall-darwin-arm64-musl`
- `rolecall-windows-x64`

Download the matching asset from the [Releases page](https://github.com/markporter/rolecall/releases), make it executable, and run it directly:

```sh
chmod +x rolecall-linux-x64-musl
./rolecall-linux-x64-musl --help
./rolecall-linux-x64-musl --version
```

`--version` prints the release version and exits 0, which is the quickest way to confirm the binary works on your host. Windows needs no runtime either; run `rolecall-windows-x64.exe` the same way. For running a binary as a long-lived service, see [systemd](/deployment/systemd) and [Windows Service](/deployment/windows-service). How these binaries are built is covered in [Native Binaries](/deployment/native-binaries).

## From source (contributors)

Contributors run straight from a checkout. This path expects Bun 1.4.2 or newer:

```sh
git clone https://github.com/markporter/rolecall.git
cd rolecall
bun install
bun run src/cli/index.ts --help
# or, via the bin shim
bun bin/rolecall.js --help
```

The development workflow, including tests and the type-check gate, is described in [Development](/contributing/development).
