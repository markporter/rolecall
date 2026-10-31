// Built-in module: `lvol` — Ansible `lvol` alternate (LVM logical volume).

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { ModuleSummary } from "../search";
import { shQuote } from "./fs";

/** @summary High-level action a {@link LvolPlan} represents. */
export type LvolAction = "create" | "extend" | "reduce" | "remove" | "none";

/**
 * @summary Command planned for an `lvol` invocation.
 * @remarks `command` is raw (not sudo-wrapped); the module wraps it at exec time.
 */
export interface LvolPlan {
  /** Command to run on the target; empty when {@link noop} is true. */
  command: string;
  /** True when the requested state already holds and nothing must run. */
  noop: boolean;
  /** The action the command performs (or `none` for a no-op). */
  action: LvolAction;
  /** Actionable error; when set the plan must not be executed. */
  error?: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * @summary Parse an LVM size such as `10G`, `512M`, or a raw byte count into bytes.
 * @param size Size expression accepted by LVM.
 * @returns Byte count, or `undefined` for percentage sizes (`100%FREE`) and expressions that cannot be compared numerically.
 */
export function parseSizeBytes(size: string): number | undefined {
  const value = size.trim();
  if (!value || value.includes("%")) return undefined;
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([bBkKmMgGtTpPeE])?$/.exec(value);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  const unit = (match[2] ?? "").toUpperCase();
  const factors: Record<string, number> = {
    "": 1,
    B: 1,
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
    P: 1024 ** 5,
    E: 1024 ** 6,
  };
  const factor = factors[unit];
  return factor === undefined ? undefined : amount * factor;
}

/** @summary Parse the byte count printed by `lvs --noheadings -o lv_size --units b --nosuffix`. */
function parseLvsBytes(stdout: string): number {
  const token = stdout
    .trim()
    .split(/\s+/)
    .find((part) => part.length > 0);
  if (!token) return Number.NaN;
  const parsed = Number.parseFloat(token);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * @summary Build the command an `lvol` task would run without touching the target.
 * @param args Raw module arguments (`vg`, `lv`, `size`, `state`, `thin`, `thinpool`, `resizefs`, `shrink`, `force`, `opts`).
 * @param currentBytes Current LV size in bytes when it exists; `undefined` when it does not. Pass `NaN` when it exists but its size could not be probed.
 * @returns Planned command plus no-op/error state. Percentage sizes skip the size comparison and defer to `lvextend`.
 */
export function buildLvolPlan(args: Record<string, unknown>, currentBytes?: number): LvolPlan {
  const vg = str(args["vg"]);
  const lv = str(args["lv"]);
  if (!vg || !lv) return { noop: false, action: "none", command: "", error: "lvol: 'vg' and 'lv' required" };
  const path = `${vg}/${lv}`;
  const state = str(args["state"]) || "present";
  const exists = currentBytes !== undefined;
  const force = args["force"] === undefined ? true : Boolean(args["force"]);

  if (state === "absent") {
    if (!exists) return { noop: true, action: "none", command: "" };
    return {
      noop: false,
      action: "remove",
      command: `lvremove ${force ? "-f " : ""}${shQuote(path)}`,
    };
  }

  const size = str(args["size"]);
  const thin = Boolean(args["thin"]);
  const resizefs = Boolean(args["resizefs"]);
  const shrink = Boolean(args["shrink"]);

  if (!exists) {
    if (!size) return { noop: false, action: "none", command: "", error: "lvol: 'size' required to create" };
    if (thin) {
      const thinpool = str(args["thinpool"]);
      if (!thinpool) {
        return {
          noop: false,
          action: "none",
          command: "",
          error: "lvol: 'thinpool' required when 'thin: true'",
        };
      }
      return {
        noop: false,
        action: "create",
        command: `lvcreate -V ${size} -T ${shQuote(`${vg}/${thinpool}`)} -n ${shQuote(lv)}`,
      };
    }
    const opts = str(args["opts"]);
    return {
      noop: false,
      action: "create",
      command: `lvcreate -L ${size} -n ${shQuote(lv)} ${shQuote(vg)}${opts ? ` ${opts}` : ""}`,
    };
  }

  if (!size) return { noop: true, action: "none", command: "" };

  const resizefsFlag = resizefs ? " -r" : "";
  const requested = parseSizeBytes(size);

  if (requested !== undefined && Number.isFinite(currentBytes)) {
    if (requested === currentBytes) return { noop: true, action: "none", command: "" };
    if (requested < currentBytes) {
      if (!shrink) {
        return {
          noop: false,
          action: "none",
          command: "",
          error:
            `lvol: refusing to shrink ${path} from ${currentBytes} to ${size} bytes; ` +
            "set 'shrink: true' to allow this reduction",
        };
      }
      return {
        noop: false,
        action: "reduce",
        command: `lvreduce -L ${size}${resizefsFlag}${force ? " -f" : ""} ${shQuote(path)}`,
      };
    }
  }

  return {
    noop: false,
    action: "extend",
    command: `lvextend -L ${size}${resizefsFlag} ${shQuote(path)}`,
  };
}

/** @summary Create, resize, or remove an LVM logical volume with thin provisioning and guarded shrink (Ansible `lvol` alternate). @param ctx ModuleContext carrying `vg`, `lv`, `size`, `state`, `thin`, `thinpool`, `resizefs`, `shrink`, `force`, `opts`. @returns ModuleResult; `skipped` when unchanged or already absent. */
export const lvolModule: Module = {
  name: "lvol",
  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const a = ctx.args;
    const vg = str(a["vg"]);
    const lv = str(a["lv"]);
    if (!vg || !lv) return { changed: false, failed: true, msg: "lvol: 'vg' and 'lv' required" };
    const state = str(a["state"]) || "present";
    const path = `${vg}/${lv}`;
    const exists = (await ctx.connection.exec(`lvs ${shQuote(path)} >/dev/null 2>&1`)).exitCode === 0;

    let currentBytes: number | undefined;
    if (exists) {
      const probe = await ctx.connection.exec(
        `lvs --noheadings -o lv_size --units b --nosuffix ${shQuote(path)}`,
      );
      currentBytes = probe.exitCode === 0 ? parseLvsBytes(probe.stdout) : Number.NaN;
    }

    const plan = buildLvolPlan(a, currentBytes);
    if (plan.error) return { changed: false, failed: true, msg: plan.error };
    if (plan.noop) {
      const msg = state === "absent" ? `lvol: ${path} absent` : `lvol: ${path} unchanged`;
      return { changed: false, skipped: true, msg };
    }

    const run = ctx.become ? `sudo sh -c ${shQuote(plan.command)}` : plan.command;
    const res = await ctx.connection.exec(run);
    if (res.exitCode !== 0) return { changed: false, failed: true, msg: `lvol: failed: ${res.stderr}` };

    const size = str(a["size"]);
    switch (plan.action) {
      case "create":
        return {
          changed: true,
          msg: Boolean(a["thin"])
            ? `lvol: created ${path} (${size}, thin pool ${str(a["thinpool"])})`
            : `lvol: created ${path} (${size})`,
          data: { vg, lv, size, thin: Boolean(a["thin"]), thinpool: str(a["thinpool"]) || undefined },
        };
      case "extend":
        return {
          changed: true,
          msg: `lvol: extended ${path} to ${size}`,
          data: { vg, lv, size, previous_size: currentBytes },
        };
      case "reduce":
        return {
          changed: true,
          msg: `lvol: reduced ${path} to ${size}`,
          data: { vg, lv, size, previous_size: currentBytes },
        };
      case "remove":
        return { changed: true, msg: `lvol: removed ${path}`, data: { vg, lv } };
      default:
        return { changed: false, skipped: true, msg: `lvol: ${path} unchanged` };
    }
  },
};

/** Search metadata for the `lvol` module. */
export const meta: ModuleSummary = {
  name: "lvol",
  description:
    "Create, resize, or remove an LVM logical volume (Ansible `lvol` alternate). Uses `lvcreate`/`lvextend`/`lvreduce`/`lvremove`, including thin provisioning and guarded shrink.",
  source: "builtin",
  args: {
    vg: { type: "string", required: true, description: "Volume group." },
    lv: { type: "string", required: true, description: "Logical volume name." },
    size: { type: "string", required: false, description: "Size, e.g. 10G or 100%FREE. Required to create." },
    state: { type: "present | absent", required: false, description: "present (default) or absent." },
    thin: { type: "boolean", required: false, description: "Create a thin logical volume; requires `thinpool` and `size`." },
    thinpool: { type: "string", required: false, description: "Thin pool name, used with `thin: true`." },
    resizefs: { type: "boolean", required: false, description: "Pass `-r`/`--resizefs` to `lvextend`/`lvreduce` so the filesystem is resized too." },
    shrink: { type: "boolean", required: false, description: "Allow reducing an existing LV. Without it, a smaller requested size fails with an actionable error instead of shrinking silently." },
    force: { type: "boolean", required: false, description: "Pass `-f` to `lvremove`/`lvreduce` (default true)." },
    opts: { type: "string", required: false, description: "Extra options appended verbatim to a non-thin `lvcreate`." },
  },
  examples: [
    `- lvol:
    vg: vg0
    lv: data
    size: 10G`,
    `- lvol:
    vg: vg0
    lv: scratch
    size: 20G
    thin: true
    thinpool: pool0`,
    `- lvol:
    vg: vg0
    lv: data
    size: 20G
    resizefs: true`,
    `- lvol:
    vg: vg0
    lv: data
    size: 5G
    shrink: true`,
  ],
  notes:
    "≠ Ansible `lvol`: thin volumes use `lvcreate -V/-T` (requires `thinpool`); `resizefs` adds `-r` to extend/reduce; shrinking requires `shrink: true` and otherwise fails rather than silently reducing. Only numeric sizes are compared for idempotency; percentage sizes defer to `lvextend`.",
};

(lvolModule as Module & { meta: ModuleSummary }).meta = meta;
export default lvolModule;
