# LXD lab

The `lxdhost` group runs `lxc` locally on the controller. RoleCall's default
ADR 0025 sandbox only mounts the project directory, so LXD's Unix socket and
state directories are not visible unless you grant them explicitly.

For a snap-installed LXD:

```sh
rolecall playbook run examples/lxd-lab/playbooks/site.yaml \
  --inventory examples/lxd-lab/inventory.yaml \
  --mount /var/snap/lxd:/var/snap/lxd
```

For a distro-packaged LXD, grant `/var/lib/lxd` (or the daemon's socket
directory) instead. Mounts are explicit operator grants, not defaults.

If you cannot use bwrap or Docker at all, `--isolation none` is the explicit,
warned last resort; do not use it on an untrusted project.
