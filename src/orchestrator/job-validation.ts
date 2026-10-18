// Payload shape validation for webhook/REST run triggers (Todo 21).
//
// Pure, synchronous validation performed STRICTLY BEFORE any execution, so a bad
// payload yields a structured 4xx WITHOUT ever touching the Engine. Reused by
// src/orchestrator/webhooks.ts and unit-tested here in isolation. Mirrors the
// ActionType membership gate already present on POST /run + Engine.enqueue.

import { z } from "zod";
import type { ActionType, JobBody, PlanTask } from "./types";

/** The three accepted job kinds (kept in sync with ActionType). */
export const VALID_JOB_TYPES: readonly ActionType[] = ["playbook", "adhoc", "nonIdempotent"];

export const RunJobSchema = z
  .object({
    type: z.enum(["playbook", "adhoc", "nonIdempotent"]),
    playbookPath: z.string().optional(),
    playbook: z.unknown().optional(),
    tasks: z.array(z.unknown()).optional(),
    module: z.string().optional(),
    targets: z.array(z.string()).optional(),
    hosts: z.array(z.string()).optional(),
    config: z.string().optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    inventoryPath: z.string().optional(),
    limit: z.string().optional(),
    force: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "adhoc" && !v.module) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["module"], message: "adhoc requires a non-empty 'module'" });
    }
    if (v.type === "playbook" && !v.playbookPath && !v.playbook && !(v.tasks && v.tasks.length > 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["playbookPath"], message: "playbook requires one of playbookPath|tasks|playbook" });
    }
    if (v.type === "nonIdempotent" && !v.config && !(v.args && (v.args.command || v.args.message)) && !(v.tasks && v.tasks.length > 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["config"], message: "nonIdempotent requires config, args.command/message, or tasks" });
    }
  });

export interface FieldError {
  path: string;
  message: string;
}

export type RunJobValidation =
  | { ok: true; value: JobBody }
  | { ok: false; fieldErrors: FieldError[] };

export function validateRunJob(input: unknown): RunJobValidation {
  const r = RunJobSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data as unknown as JobBody };
  return {
    ok: false,
    fieldErrors: r.error.issues.map((i) => ({
      path: i.path.length ? i.path.join(".") : "_",
      message: i.message,
    })),
  };
}

/** True only for literal membership among the accepted action types. */
export function isActionType(v: unknown): v is ActionType {
  return typeof v === "string" && (VALID_JOB_TYPES as readonly string[]).includes(v);
}

/** Successful validation carries the coerced body + resolved kind. */
export type ValidationSuccess = { ok: true; value: JobBody; type: ActionType };
/** Failed validation explains exactly what was wrong (message never leaks secrets). */
export type ValidationError = { ok: false; error: string };
export type ValidationResult = ValidationSuccess | ValidationError;

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const isObjectRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function coerceTargets(raw: Record<string, unknown>): void {
  if (raw.targets !== undefined && !isStringArray(raw.targets)) delete raw.targets;
  if (raw.hosts !== undefined && !isStringArray(raw.hosts)) delete raw.hosts;
}

/** A playbook needs a source of work; adhoc needs a module; nonIdempotent needs an apply target. */
function hasPlaybookSource(raw: Record<string, unknown>): boolean {
  const inlinePb = raw.playbook !== undefined && isObjectRecord(raw.playbook);
  return isNonEmptyString(raw.playbookPath) || (Array.isArray(raw.tasks) && raw.tasks.length > 0) || inlinePb;
}
function hasSideEffectTarget(raw: Record<string, unknown>): boolean {
  const args = isObjectRecord(raw.args) ? raw.args : {};
  return isNonEmptyString(raw.config) || isNonEmptyString(args.command) || isNonEmptyString(args.message) || (Array.isArray(raw.tasks) && raw.tasks.length > 0);
}

/** Validate + coerce an arbitrary parsed body into a JobBody, or explain why not.
 *  `forcedType` pre-fills `type` for typed shortcut routes (e.g. POST /webhooks/adhoc). */
export function validateJobBody(input: unknown, forcedType?: ActionType): ValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "request body must be a JSON object" };
  }
  const raw = input as Record<string, unknown>;
  coerceTargets(raw);

  let type = isActionType(raw.type) ? raw.type : forcedType ?? null;
  if (!type) {
    const provided = typeof raw.type === "string" && raw.type.length > 0;
    return { ok: false, error: provided ? `invalid 'type' '${String(raw.type)}': expected playbook|adhoc|nonIdempotent` : "missing 'type': expected playbook|adhoc|nonIdempotent" };
  }

  switch (type) {
    case "adhoc":
      if (!isNonEmptyString(raw.module)) return { ok: false, error: "adhoc requires a non-empty 'module'" };
      break;
    case "playbook":
      if (!hasPlaybookSource(raw)) return { ok: false, error: "playbook requires one of playbookPath|tasks|playbook" };
      break;
    case "nonIdempotent":
      if (!hasSideEffectTarget(raw)) return { ok: false, error: "nonIdempotent requires config, args.command/message, or tasks" };
      break;
  }

  const value: JobBody = { type };
  if (isStringArray(raw.targets)) value.targets = raw.targets;
  if (isStringArray(raw.hosts)) value.hosts = raw.hosts;
  if (isNonEmptyString(raw.module)) value.module = raw.module;
  if (Array.isArray(raw.tasks)) value.tasks = raw.tasks as PlanTask[];
  if (isObjectRecord(raw.playbook)) value.playbook = raw.playbook as unknown as JobBody["playbook"];
  if (isNonEmptyString(raw.config)) value.config = raw.config;
  if (typeof raw.limit === "string") value.limit = raw.limit;
  if (typeof raw.force === "boolean") value.force = raw.force;
  if (isNonEmptyString(raw.playbookPath)) value.playbookPath = raw.playbookPath;
  if (isNonEmptyString(raw.inventoryPath)) value.inventoryPath = raw.inventoryPath;
  if (isObjectRecord(raw.args)) value.args = raw.args;
  return { ok: true, value, type };
}
