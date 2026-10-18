---
title: Contributing
---

Contributing covers how to develop RoleCall locally, run its tests, and fit changes into CI.

Development workflow, the dual-runtime test requirement, and the CI jobs all come straight from `.github/workflows/ci.yml` and the README. Local work runs Bun directly against the TypeScript sources under `src/`, type-checks gate every change, and tests must stay green across both declared runtimes. Everything below states engine parity honestly: the Node PAL is implemented, the npm channel ships a Node bundle, and the durable store (with `--serve`/`--trace`/`--profile`/`run replay`) runs on both runtimes over the PAL SqliteDb seam (ADR 0019).

## Topics

- [Development](/contributing/development)
- [Testing](/contributing/testing)
- [CI](/contributing/ci)
