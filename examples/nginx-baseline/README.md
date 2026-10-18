# nginx-baseline (RoleCall example)

A minimal RoleCall project showing:

- a project manifest (`rolecall.yaml`) that names the project
- a project plugin (`plugins/modules/myorg/example-resource.ts`) using `resource({describe,converge})`
- a local role (`roles/web-tier/`) that is itself a mini RoleCall project
- inventory + `group_vars/` + `host_vars/`

> RoleCall's executor applies tasks live over SSH/local transports, so `rolecall playbook run` converges state.

Try:

```sh
rolecall playbook run playbooks/site.yaml --inventory inventory/inventory.yaml
```
