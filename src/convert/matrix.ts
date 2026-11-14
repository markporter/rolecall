// Typed Ansible -> RoleCall compatibility matrix (ADR 0024).
//
// This is the single source for task-level dispositions and module renames used
// by the analyzer/rewriter and the handoff bundle. Keep messages actionable: they
// are copied into HANDOFF.md verbatim.

/** How a construct is handled by the mechanical converter. */
export type ConvertDisposition = "mapped" | "review" | "handoff";

/** One task-level compatibility rule. */
export interface CompatibilityRule {
  /** Ansible task key or construct id. */
  id: string;
  disposition: ConvertDisposition;
  message: string;
}

/** Task keys with no faithful mechanical equivalent; emitted as handoff items. */
export const TASK_RULES: Readonly<Record<string, CompatibilityRule>> = {
  ignore_errors: {
    id: "ignore_errors",
    disposition: "handoff",
    message: "no native RoleCall equivalent; rewrite with tx/checkpoint, shell_register, or an idempotent module",
  },
  changed_when: {
    id: "changed_when",
    disposition: "handoff",
    message: "no native RoleCall equivalent; rewrite with tx/checkpoint, shell_register, or an idempotent module",
  },
  failed_when: {
    id: "failed_when",
    disposition: "handoff",
    message: "no native RoleCall equivalent; rewrite with tx/checkpoint, shell_register, or an idempotent module",
  },
  async: {
    id: "async",
    disposition: "handoff",
    message: "no native RoleCall equivalent; split into a background command plus an explicit wait",
  },
  poll: {
    id: "poll",
    disposition: "handoff",
    message: "no native RoleCall equivalent; split into a background command plus an explicit wait",
  },
  until: {
    id: "until",
    disposition: "handoff",
    message: "no native RoleCall equivalent; use a shell loop with explicit retries or an idempotent module",
  },
  retries: {
    id: "retries",
    disposition: "handoff",
    message: "no native RoleCall equivalent; use a shell loop with explicit retries or an idempotent module",
  },
  delay: {
    id: "delay",
    disposition: "handoff",
    message: "no native RoleCall equivalent; use a shell loop with explicit retries or an idempotent module",
  },
  vars: {
    id: "vars",
    disposition: "handoff",
    message: "task-level vars are not a RoleCall field; inline the values or move them to play vars",
  },
  loop_control: {
    id: "loop_control",
    disposition: "handoff",
    message: "loop_control (label/pause/index_var) has no RoleCall equivalent",
  },
  delegate_facts: {
    id: "delegate_facts",
    disposition: "handoff",
    message: "delegate_facts has no RoleCall equivalent",
  },
  check_mode: {
    id: "check_mode",
    disposition: "handoff",
    message: "per-task check_mode has no RoleCall equivalent; use the global --check flag",
  },
  become_method: {
    id: "become_method",
    disposition: "handoff",
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
