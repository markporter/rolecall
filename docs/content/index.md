---
layout: home
title: RoleCall
hero:
  name: RoleCall
  text: Dual-runtime config management & orchestration
  tagline: An Ansible alternative that runs as a single executable - as a CLI (rolecall playbook run ...) and as an orchestrator server (rolecall --serve). Installs via npm on Node.js; Bun powers the binaries and dev workflow.
  image:
    src: /logo.svg
    alt: RoleCall logo
    width: 120
    height: 120
  actions:
    - theme: brand
      text: Get Started
      link: /guide/install
    - theme: alt
      text: GitHub
      link: https://github.com/markporter/rolecall
features:
  - title: Guide
    details: Install RoleCall, quickstart, and your first playbook.
    link: /guide/install
  - title: Reference
    details: Commands, global options, and the plugin surface.
    link: /reference/command-reference
  - title: Concepts
    details: Playbooks, inventory, modules, templating, idempotency, transport, and the executor.
    link: /concepts/playbooks
  - title: Contributing
    details: Development workflow, dual-runtime testing, and CI.
    link: /contributing/
---

This user guide covers getting started, command reference, core concepts, best
practices, deployment, and how to contribute.

> Some surfaces behind these topics remain scaffolded (`[deferred]`) — scheduler / cron /
> webhooks / SPA UI, the richer Plugin SDK authoring surface, and literal <code v-pre>{{ }}</code>
> rendering — while execution,
> transport, and facts-collection apply real state. Remaining scaffolds are marked plainly
> instead of describing unimplemented behavior.
