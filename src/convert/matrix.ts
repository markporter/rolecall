// Typed Ansible -> RoleCall compatibility matrix (ADR 0024).
//
// This is the single source for task-level dispositions and module renames used
// by the analyzer/rewriter and the conversion-gaps bundle. Keep messages actionable: they
// are copied into CONVERSION_GAPS.md verbatim.

/** How a construct is handled by the mechanical converter. */
export type ConvertDisposition = "mapped" | "review" | "gap";

/** One task-level compatibility rule. */
export interface CompatibilityRule {
  /** Ansible task key or construct id. */
  id: string;
  disposition: ConvertDisposition;
  message: string;
}

/** Task keys with no faithful mechanical equivalent; emitted as gap items. */
export const TASK_RULES: Readonly<Record<string, CompatibilityRule>> = {
  async: {
    id: "async",
    disposition: "gap",
    message: "no native RoleCall equivalent; split into a background command plus an explicit wait",
  },
  poll: {
    id: "poll",
    disposition: "gap",
    message: "no native RoleCall equivalent; split into a background command plus an explicit wait",
  },
  vars: {
    id: "vars",
    disposition: "gap",
    message: "task-level vars are not a RoleCall field; inline the values or move them to play vars",
  },
  loop_control: {
    id: "loop_control",
    disposition: "gap",
    message: "loop_control (label/pause/index_var) has no RoleCall equivalent",
  },
  delegate_facts: {
    id: "delegate_facts",
    disposition: "gap",
    message: "delegate_facts has no RoleCall equivalent",
  },
  check_mode: {
    id: "check_mode",
    disposition: "gap",
    message: "per-task check_mode has no RoleCall equivalent; use the global --check flag",
  },
  become_method: {
    id: "become_method",
    disposition: "gap",
    message: "only sudo escalation is supported; remove become_method or review the privilege path",
  },
};

/** Ansible module names remapped to RoleCall builtins. */
export const MODULE_REMAP: Readonly<Record<string, string>> = {
  template: "copy",
  apt: "package",
  yum: "package",
  dnf: "package",
  systemd: "service",
};

/** Look up a task-level rule by Ansible key. */
export function taskRule(id: string): CompatibilityRule | undefined {
  return TASK_RULES[id];
}
