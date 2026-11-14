// Built-in module: `debconf` — Ansible `debconf` alternate (preseed a debconf
// question). Reads the current answer with `debconf-show` and writes with
// `debconf-set-selections`; no prompts, no interactive UI.

import type { Module, ModuleContext } from "../../executor/module";
import type { CheckableModule } from "../../idempotency/types";
import { resource } from "../resource";
import type { ModuleSummary } from "../search";
import { shQuote, wrapCommand } from "./fs";

interface DebconfArgs {
  /** Debian package that owns the question. Required. */
  name: string;
  /** Question path, e.g. `openssh-server/disable-password-authentication`. Required. */
  question: string;
  /** Debconf value type (default `string`). */
  vtype?: string;
  /** Desired answer (required for state: present). */
  value?: string;
  /** Desired state: present (default) or absent (clears the answer). */
  state?: "present" | "absent";
}

function selectionLine(a: DebconfArgs): string {
  const vtype = typeof a.vtype === "string" && a.vtype.length > 0 ? a.vtype : "string";
  return `${String(a.name)} ${String(a.question)} ${vtype} ${String(a.value ?? "")}`.trimEnd();
}

async function show(ctx: ModuleContext, name: string): Promise<string | null> {
  const cmd = wrapCommand(`debconf-show ${shQuote(name)}`, {
    become: Boolean(ctx.become),
    becomeUser: ctx.become_user,
    environment: ctx.environment,
  });
  const res = await ctx.connection.exec(cmd);
  return res.exitCode === 0 ? res.stdout : null;
}

function readAnswer(stdout: string, question: string): string | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    const idx = line.indexOf(`${question}:`);
    if (idx >= 0) return line.slice(idx + question.length + 1).trim();
  }
  return undefined;
}

/** @summary Preseed or clear a debconf answer (Ansible `debconf` alternate). @param args DebconfArgs (name, question, vtype, value, state). @returns Module & CheckableModule. */
export const debconfModule: Module & CheckableModule = resource({
  name: "debconf",
  async describe(args, ctx) {
    const a = args as unknown as DebconfArgs;
    if (!a.name || !a.question) return { current: null, inDesired: false };
    const state = a.state ?? "present";
    const output = await show(ctx, a.name);
    if (output === null) return { current: null, inDesired: state === "absent" };
    const current = readAnswer(output, a.question);
    if (state === "absent") return { current, inDesired: current === undefined || current === "" };
    return { current, inDesired: current === String(a.value ?? "") };
  },
  async converge(args, ctx) {
    const a = args as unknown as DebconfArgs;
    if (!a.name || !a.question) {
      return { changed: false, failed: true, msg: "debconf: 'name' and 'question' are required" };
    }
    if ((a.state ?? "present") === "present" && a.value === undefined) {
      return { changed: false, failed: true, msg: "debconf: 'value' is required for state: present" };
    }
    const line = selectionLine(a);
    const cmd = wrapCommand(`printf '%s\\n' ${shQuote(line)} | debconf-set-selections`, {
      become: Boolean(ctx.become),
      becomeUser: ctx.become_user,
      environment: ctx.environment,
    });
    const res = await ctx.connection.exec(cmd);
    if (res.exitCode !== 0) {
      return {
        changed: false,
        failed: true,
        msg: `debconf: failed to apply selection: ${res.stderr.trim() || `exit ${res.exitCode}`}`,
      };
    }
    return {
      changed: true,
      msg: `debconf: ${(a.state ?? "present") === "absent" ? "cleared" : "preseeded"} ${a.question}`,
    };
  },
});

/** Search metadata for the `debconf` module. */
export const meta: ModuleSummary = {
  name: "debconf",
  description:
    "Preseed or clear a debconf answer with debconf-set-selections (Ansible `debconf` alternate).",
  idempotent: true,
  source: "builtin",
  args: {
    name: { type: "string", required: true, description: "Debian package that owns the question." },
    question: { type: "string", required: true, description: "Question path." },
    vtype: { type: "string", required: false, description: "Debconf value type (default string)." },
    value: { type: "string", required: false, description: "Desired answer (required for state: present)." },
    state: { type: "present | absent", required: false, description: "present (default) or absent (clears the answer)." },
  },
  examples: [
    `- debconf:
    name: openssh-server
    question: openssh-server/disable-password-authentication
    vtype: boolean
    value: "true"`,
  ],
  notes:
    "≠ Ansible `debconf`: reads current state with `debconf-show` (requires `debconf-utils`) and writes with `debconf-set-selections`. `state: absent` clears the answer by writing an empty value; it does not remove the question definition.",
};

(debconfModule as Module & CheckableModule & { meta: ModuleSummary }).meta = meta;
export default debconfModule;
