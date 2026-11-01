# Local smoke example

A minimal local playbook for verifying that the default ADR 0025 sandbox is
working. It runs `echo` inside the local isolation backend and writes nothing.

```sh
rolecall playbook run examples/local-smoke/playbook.yaml \
  --inventory examples/local-smoke/inventory.yaml
```

On a host without bwrap or Docker, pass `--isolation none` as the explicit,
warned escape.
