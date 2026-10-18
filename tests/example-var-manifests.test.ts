import { describe, expect, test } from "bun:test";
import { FsProjectSource } from "../src/vfs/fs-project-source";
import { lintTemplateRefs, loadPlaybookFile } from "../src/config/loader";

// Each example playbook ships a var-manifest (role-level for role_example, playbook-root
// for nginx-baseline/lxd-lab). These tests confirm var_strict actually resolves with those
// manifests: every $var reference is declared, loop-item refs (loop.item.*) are exempt, and no
// jinja/non-namespaced problems slip through.
const examples: Array<{ root: string; play: string }> = [
  { root: "examples/role_example", play: "playbook.yaml" },
  { root: "examples/nginx-baseline", play: "playbooks/site.yaml" },
  { root: "examples/lxd-lab", play: "playbooks/site.yaml" },
  { root: "examples/lxd-lab", play: "playbooks/configure.yaml" },
  { root: "examples/lxd-lab", play: "playbooks/containers.yaml" },
  { root: "examples/lxd-lab", play: "playbooks/bootstrap.yaml" },
  { root: "examples/lxd-lab", play: "playbooks/teardown.yaml" },
];

describe("example playbooks satisfy var_strict with their manifests", () => {
  for (const ex of examples) {
    test(`${ex.root}/${ex.play}`, async () => {
      const plays = await loadPlaybookFile(ex.play, new FsProjectSource(ex.root));
      expect(plays.length, `${ex.root}/${ex.play} resolved no plays`).toBeGreaterThan(0);
      for (const pb of plays) {
        const problems = lintTemplateRefs(pb);
        expect(
          problems,
          `${ex.root}/${ex.play} template-ref problems: ${JSON.stringify(problems)}`,
        ).toEqual([]);
      }
    });
  }
});
