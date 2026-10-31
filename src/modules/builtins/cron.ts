// Built-in module: `cron` — Ansible `cron` alternate (manage crontab entries).
//
// Idempotent via `resource()`: `describe` reads the target crontab — a user
// crontab through `crontab -l -u <user>`, or a `/etc/cron.d/<file>` drop-in when
// `cron_file` is set — locates the managed entry by its `#Ansible: <name>`
// marker, and reports `inDesired` only when the marked entry already matches the
// desired schedule/job/`disabled` state. `converge` rewrites ONLY the managed
// marker+entry pair and leaves every unrelated line untouched, so it never
// clobbers crontab lines it does not own. `state: absent` removes just the named
// entry. A `--check`/`check: true` invocation reports `wouldChange` without
// writing. The marker matches Ansible's syntax, so RoleCall and Ansible manage
// the same blocks.

import { randomUUID } from "node:crypto";
import type { Module, ModuleContext } from "../../executor/module";
import type { CheckableModule } from "../../idempotency/types";
import { resource } from "../resource";
import { readRemoteFile, shQuote, wrapCommand, writeRemoteFileExact } from "./fs";
import type { ModuleSummary } from "../search";

const MODULE_NAME = "cron";

/** The `@` presets Ansible's `special_time` accepts (plus `annually`, aliased to `@yearly`). */
const SPECIAL_TIMES = new Set([
  "reboot",
  "yearly",
  "annually",
  "monthly",
  "weekly",
  "daily",
  "hourly",
]);

/** @summary Arguments for the `cron` module. @property name Unique entry name, written as the `#Ansible: <name>` marker (required). @property job Command to run (required when state=present); in `env` mode it is the variable value. @property minute/hour/day/month/weekday Cron schedule fields (default `*`). @property special_time `@reboot`-style preset, overriding the five schedule fields. @property user Crontab owner (default root); also the user column in a `cron_file` drop-in. @property state `present` (default) or `absent`. @property disabled Comment the entry out (prefix `#`) instead of removing it. @property cron_file Manage `/etc/cron.d/<cron_file>` instead of the user crontab. @property backup Back up the previous non-empty crontab to a timestamped file before a changing write. @property env Write `name=job` environment-variable entries (user crontab only). @property insertafter/insertbefore Place a newly added marker+entry pair relative to a regexp match (or `EOF`/`BOF`/`START`). @property mode chmod mode applied to the managed `cron_file` (requires `cron_file`). */
export interface CronArgs {
  /** Unique entry name; written as the `#Ansible: <name>` marker line above the entry. Required. */
  name: string;
  /** Command to run. Required when `state: present`; in `env` mode, the environment variable's value. */
  job?: string;
  /** Cron minute field (default `*`). */
  minute?: string | number;
  /** Cron hour field (default `*`). */
  hour?: string | number;
  /** Cron day-of-month field (default `*`). */
  day?: string | number;
  /** Cron month field (default `*`). */
  month?: string | number;
  /** Cron day-of-week field (default `*`). */
  weekday?: string | number;
  /** `@reboot`/`@daily`/… preset; overrides minute/hour/day/month/weekday when set. */
  special_time?: string;
  /** Crontab owner (default `root`). With `cron_file`, this is the drop-in's user column. */
  user?: string;
  /** `present` (default) ensures the entry; `absent` removes it. */
  state?: "present" | "absent";
  /** When true, keep the entry but comment it out so cron ignores it. */
  disabled?: boolean;
  /** Manage `/etc/cron.d/<cron_file>` rather than a user crontab (absolute paths are used verbatim). */
  cron_file?: string;
  /** Back up the previous crontab (when non-empty) to a timestamped file before a changing write; returned as `data.backup_file`. */
  backup?: boolean;
  /** Environment-variable mode: the managed line is `name=job` (no schedule/user column). User crontabs only. */
  env?: boolean;
  /** Place a newly added marker+entry pair after the last line matching this regexp (`EOF` appends). Ignored when the entry already exists. */
  insertafter?: string;
  /** Place a newly added marker+entry pair before the last line matching this regexp (`BOF`/`START` prepends). Ignored when the entry already exists. */
  insertbefore?: string;
  /** chmod mode applied to the managed `cron_file` after writing (requires `cron_file`). */
  mode?: string;
  /** Internal: set by the `--check` global passthrough. */
  _check?: unknown;
  /** Internal: set by the `--check` global passthrough. */
  check?: unknown;
}

/** Resolved crontab target: either a system drop-in file or a user crontab. */
interface CronTarget {
  /** Absolute path when managing a `/etc/cron.d` drop-in. */
  path?: string;
  /** True when the entry must carry a user column (system crontab syntax). */
  system: boolean;
  /** Crontab owner for the user-crontab path. */
  user?: string;
}

/** Search metadata for the `cron` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: MODULE_NAME,
  description:
    "Manage a crontab entry (Ansible `cron` alternate). Entries are marked with `#Ansible: <name>` so present/absent/disabled reconciliation is idempotent and never touches unrelated lines.",
  idempotent: true,
  source: "builtin",
  args: {
    name: { type: "string", required: true, description: "Unique entry name (the `#Ansible: <name>` marker)." },
    job: { type: "string", required: false, description: "Command to run (required when state=present)." },
    minute: { type: "string", required: false, description: "Cron minute field (default *)." },
    hour: { type: "string", required: false, description: "Cron hour field (default *)." },
    day: { type: "string", required: false, description: "Cron day-of-month field (default *)." },
    month: { type: "string", required: false, description: "Cron month field (default *)." },
    weekday: { type: "string", required: false, description: "Cron day-of-week field (default *)." },
    special_time: { type: "string", required: false, description: "Preset schedule (@reboot/@yearly/@annually/@monthly/@weekly/@daily/@hourly)." },
    user: { type: "string", required: false, description: "Crontab owner (default root)." },
    state: { type: "present | absent", required: false, description: "Desired state (default present)." },
    disabled: { type: "boolean", required: false, description: "Comment the entry out instead of removing it." },
    cron_file: { type: "string", required: false, description: "Manage /etc/cron.d/<cron_file> instead of a user crontab." },
    backup: { type: "boolean", required: false, description: "Back up the previous non-empty crontab to a timestamped file before a changing write (returned as data.backup_file)." },
    env: { type: "boolean", required: false, description: "Environment-variable mode: write name=job instead of a scheduled command (user crontabs only)." },
    insertafter: { type: "string", required: false, description: "Place a newly added entry after the last line matching this regexp (EOF appends). Ignored when the entry already exists." },
    insertbefore: { type: "string", required: false, description: "Place a newly added entry before the last line matching this regexp (BOF/START prepends). Mutually exclusive with insertafter. Ignored when the entry already exists." },
    mode: { type: "string", required: false, description: "chmod mode applied to the managed cron_file after writing (requires cron_file)." },
  },
  examples: [
    `- cron:
    name: backup-db
    job: /usr/local/bin/backup.sh
    minute: "0"
    hour: "2"
    user: root`,
    `- cron:
    name: nightly-report
    job:
      $concat:
        - /usr/local/bin/report --out /var/log/
        - $var: vars.report_name
    special_time: daily
    cron_file: rolecall-reports
    user: root`,
  ],
  notes:
    "≠ Ansible `cron`: `env` is supported only in user crontabs (not with `cron_file`) and `mode` requires `cron_file`; `backup` writes `<cron_file>.<epoch>.bak` or `/tmp/rolecall-crontab-<user>-<epoch>.bak`. `cron_file` accepts an absolute path or a bare name rooted at /etc/cron.d. Uses `$var` refs, not Jinja `{{ }}`.",
};

/** Build the five-field (or `@preset`) schedule string for the given args. */
function scheduleOf(a: CronArgs): string {
  if (typeof a.special_time === "string" && a.special_time.length > 0) {
    const preset = a.special_time === "annually" ? "yearly" : a.special_time;
    return `@${preset}`;
  }
  const fields = [a.minute ?? "*", a.hour ?? "*", a.day ?? "*", a.month ?? "*", a.weekday ?? "*"];
  return fields.map((f) => String(f)).join(" ");
}

/** Resolve whether the module manages a `/etc/cron.d` drop-in or a user crontab. */
function targetOf(a: CronArgs): CronTarget {
  if (typeof a.cron_file === "string" && a.cron_file.length > 0) {
    const path = a.cron_file.includes("/") ? a.cron_file : `/etc/cron.d/${a.cron_file}`;
    return { path, system: true };
  }
  return { system: false, user: typeof a.user === "string" && a.user ? a.user : "root" };
}

/** The `#Ansible: <name>` marker line (identical to Ansible's so blocks interoperate). */
function markerOf(name: string): string {
  return `#Ansible: ${name}`;
}

/** Render the crontab entry line: `name=job` in env mode, otherwise a schedule (a system entry carries the user column; disabled is `#`-prefixed). */
function entryOf(a: CronArgs, target: CronTarget): string {
  const job = typeof a.job === "string" ? a.job : "";
  if (a.env) return `${a.name}=${job}`;
  const schedule = scheduleOf(a);
  const body = target.system ? `${schedule} ${target.user ?? a.user ?? "root"} ${job}` : `${schedule} ${job}`;
  return a.disabled ? `#${body}` : body;
}

/** Split crontab text into logical lines, dropping trailing blank lines. */
function toLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Read the target crontab text (empty string when absent or unreadable). */
async function readCrontab(ctx: ModuleContext, target: CronTarget): Promise<string> {
  if (target.system && target.path) {
    return (await readRemoteFile(ctx.connection, target.path, Boolean(ctx.become))) ?? "";
  }
  const cmd = `crontab -l -u ${shQuote(target.user ?? "root")} 2>/dev/null`;
  const res = await ctx.connection.exec(
    wrapCommand(cmd, { become: Boolean(ctx.become), becomeUser: ctx.become_user, environment: ctx.environment }),
  );
  return res.exitCode === 0 ? res.stdout : "";
}

/** Locate the managed marker plus the entry line immediately following it, if any. */
function findManaged(lines: string[], marker: string): { index: number; entryIndex: number; entry?: string } {
  const index = lines.findIndex((l) => l.trim() === marker);
  if (index < 0) return { index: -1, entryIndex: -1 };
  const nextIdx = index + 1;
  if (nextIdx < lines.length && lines[nextIdx]!.trim() !== "" && !lines[nextIdx]!.startsWith("#Ansible:")) {
    return { index, entryIndex: nextIdx, entry: lines[nextIdx]!.trim() };
  }
  return { index, entryIndex: -1 };
}

/** Return a copy of `lines` with the managed marker+entry pair removed. */
function withoutManaged(lines: string[], found: { index: number; entryIndex: number }): string[] {
  if (found.index < 0) return [...lines];
  return lines.filter((_, i) => i !== found.index && i !== found.entryIndex);
}

/** Index of the LAST line matching `re`, or -1 when none match. */
function lastMatchIndex(lines: string[], re: RegExp): number {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (re.test(lines[i]!)) return i;
  }
  return -1;
}

/** Compute where a newly added marker+entry pair is spliced in (append when no anchor matches). */
function insertionIndex(lines: string[], a: CronArgs): number {
  if (typeof a.insertbefore === "string" && a.insertbefore.length > 0) {
    if (a.insertbefore === "BOF" || a.insertbefore === "START") return 0;
    const idx = lastMatchIndex(lines, new RegExp(a.insertbefore));
    return idx >= 0 ? idx : lines.length;
  }
  if (typeof a.insertafter === "string" && a.insertafter.length > 0 && a.insertafter !== "EOF") {
    const idx = lastMatchIndex(lines, new RegExp(a.insertafter));
    return idx >= 0 ? idx + 1 : lines.length;
  }
  return lines.length;
}

/** Compile a placement regexp, returning an actionable error for a malformed pattern (keywords always pass). */
function regexError(pattern: string | undefined, label: string): string | null {
  if (typeof pattern !== "string" || pattern.length === 0) return null;
  if (pattern === "EOF" || pattern === "BOF" || pattern === "START") return null;
  try {
    new RegExp(pattern);
    return null;
  } catch (e) {
    return `cron: invalid ${label} regex '${pattern}': ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Validate the argument combination up front; returns an actionable message, or null when the args are usable. */
function validateArgs(a: CronArgs): string | null {
  const name = typeof a.name === "string" ? a.name : "";
  if (!name) return "cron: 'name' is required";
  const state = a.state ?? "present";
  const hasCronFile = typeof a.cron_file === "string" && a.cron_file.length > 0;
  if (a.env) {
    if (hasCronFile) {
      return "cron: 'env' is not supported with 'cron_file' (env entries only work in user crontabs)";
    }
    if (a.disabled) return "cron: 'env' cannot be combined with 'disabled'";
    if (state !== "present") return "cron: 'env' requires state=present";
    if (!(typeof a.job === "string" && a.job.length > 0)) {
      return "cron: 'job' (the variable value) is required when env=true";
    }
  } else {
    if (state === "present" && !(typeof a.job === "string" && a.job.length > 0)) {
      return "cron: 'job' is required when state=present";
    }
    if (typeof a.special_time === "string" && a.special_time.length > 0 && !SPECIAL_TIMES.has(a.special_time)) {
      return `cron: unsupported special_time '${a.special_time}' (use reboot/yearly/annually/monthly/weekly/daily/hourly)`;
    }
  }
  if (a.insertafter && a.insertbefore) return "cron: use only one of insertafter / insertbefore";
  const beforeErr = regexError(a.insertbefore, "insertbefore");
  if (beforeErr) return beforeErr;
  const afterErr = regexError(a.insertafter, "insertafter");
  if (afterErr) return afterErr;
  if (typeof a.mode === "string" && a.mode.length > 0 && !hasCronFile) {
    return "cron: 'mode' requires 'cron_file' (mode is applied with chmod to the managed /etc/cron.d file)";
  }
  return null;
}

/** Timestamped backup path for the target (`<cron_file>.<epoch>.bak`, or a `/tmp` file for a user crontab). */
function backupPathOf(target: CronTarget): string {
  if (target.system && target.path) return `${target.path}.${Date.now()}.bak`;
  return `/tmp/rolecall-crontab-${target.user ?? "root"}-${Date.now()}.bak`;
}

/** @summary Idempotent `cron` module: `describe` reads the crontab and compares the marked entry; `converge` rewrites only that entry. @param args CronArgs (name, job, schedule fields, user, state, disabled, cron_file, backup, env, insertafter, insertbefore, mode). @returns Module & CheckableModule. */
export const cronModule: Module & CheckableModule = resource({
  name: MODULE_NAME,
  async describe(args, ctx) {
    const a = args as unknown as CronArgs;
    const name = typeof a.name === "string" ? a.name : "";
    if (!name) return { current: null, inDesired: false };
    const target = targetOf(a);
    const lines = toLines(await readCrontab(ctx, target));
    const found = findManaged(lines, markerOf(name));
    const state = a.state ?? "present";
    const current = { present: found.index >= 0, entry: found.entry ?? null };
    if (validateArgs(a) !== null) return { current, inDesired: false };
    if (state === "absent") return { current, inDesired: found.index < 0 };
    const desired = entryOf(a, target);
    return { current, inDesired: found.index >= 0 && found.entry === desired };
  },
  async converge(args, ctx) {
    const a = args as unknown as CronArgs;
    const invalid = validateArgs(a);
    if (invalid) return { changed: false, failed: true, msg: invalid };
    const name = a.name;
    const state = a.state ?? "present";
    const target = targetOf(a);
    const lines = toLines(await readCrontab(ctx, target));
    const marker = markerOf(name);
    const found = findManaged(lines, marker);
    const entry = entryOf(a, target);

    let next: string[];
    if (state === "absent") {
      next = withoutManaged(lines, found);
    } else if (found.index >= 0) {
      next = [...lines];
      if (found.entryIndex >= 0) next[found.entryIndex] = entry;
      else next.splice(found.index + 1, 0, entry);
    } else {
      const at = insertionIndex(lines, a);
      next = [...lines.slice(0, at), marker, entry, ...lines.slice(at)];
    }

    const nextContent = next.length > 0 ? next.join("\n") + "\n" : "";
    const oldContent = lines.length > 0 ? lines.join("\n") + "\n" : "";
    if (nextContent === oldContent) {
      return { changed: false, skipped: true, msg: `cron: ${name} unchanged` };
    }
    if (Boolean(a._check ?? a.check)) {
      return {
        changed: false,
        skipped: true,
        msg: `cron: ${name} would be ${state === "absent" ? "removed" : "written"}`,
        data: { wouldChange: true, name, state },
      };
    }
    const data: Record<string, unknown> = { name, state, entry: state === "present" ? entry : null };
    const bec = Boolean(ctx.become);

    if (a.backup && oldContent.length > 0) {
      const backupFile = backupPathOf(target);
      try {
        await writeRemoteFileExact(ctx.connection, backupFile, oldContent, target.system ? bec : false);
      } catch (e) {
        return { changed: false, failed: true, msg: `cron: backup failed: ${e instanceof Error ? e.message : String(e)}`, data };
      }
      data.backup_file = backupFile;
    }

    if (target.system && target.path) {
      try {
        await writeRemoteFileExact(ctx.connection, target.path, nextContent, bec);
      } catch (e) {
        return { changed: false, failed: true, msg: `cron: ${e instanceof Error ? e.message : String(e)}`, data };
      }
      if (typeof a.mode === "string" && a.mode.length > 0) {
        const mode = await ctx.connection.exec(
          wrapCommand(`chmod ${a.mode} ${shQuote(target.path)}`, {
            become: bec,
            becomeUser: ctx.become_user,
            environment: ctx.environment,
          }),
        );
        if (mode.exitCode !== 0) {
          return { changed: false, failed: true, msg: `cron: chmod failed: ${mode.stderr || `exit ${mode.exitCode}`}`, data };
        }
      }
      return { changed: true, msg: `cron: ${name} ${state}`, data };
    }

    const delim = `ROLECALL_CRON_${randomUUID().replace(/-/g, "")}`;
    const raw = `crontab -u ${shQuote(target.user ?? "root")} - <<'${delim}'\n${nextContent}${delim}`;
    const res = await ctx.connection.exec(
      wrapCommand(raw, { become: bec, becomeUser: ctx.become_user, environment: ctx.environment }),
    );
    if (res.exitCode !== 0) {
      return { changed: false, failed: true, msg: `cron: write failed: ${res.stderr || `exit ${res.exitCode}`}`, data };
    }
    return { changed: true, msg: `cron: ${name} ${state}`, data };
  },
});

(cronModule as Module & CheckableModule & { meta: ModuleSummary }).meta = meta;
export default cronModule;
