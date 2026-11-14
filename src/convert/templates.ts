// ADR 0031 slice 1 — Ansible/Jinja template analyzer (classification only).
//
// Parses a template with the Nunjucks AST and classifies every construct as
// mapped/review/handoff. No Eta code is generated here; the output is a precise
// work order that an LLM (or a later codegen slice) can act on.

import nunjucks from "nunjucks";

import { ANSIBLE_FILTERS, ANSIBLE_TESTS } from "../templating/ansible-filters";
import { getFilter } from "../templating/filters";
import type { ConvertFinding } from "../cli/types";
import type { ConvertDisposition } from "./matrix";

/** Result of analyzing one template file. */
export interface TemplateAnalysis {
  file: string;
  disposition: ConvertDisposition;
  findings: ConvertFinding[];
}

const BUILTIN_FILTERS = new Set([
  "abs", "batch", "capitalize", "center", "default", "dictsort", "dump", "escape",
  "first", "float", "forceescape", "groupby", "indent", "int", "join", "last",
  "length", "list", "lower", "map", "nl2br", "random", "reject", "rejectattr",
  "replace", "reverse", "round", "safe", "select", "selectattr", "slice", "sort",
  "string", "striptags", "sum", "title", "tojson", "trim", "truncate", "upper",
  "urlencode", "urlize", "wordcount",
]);

const BUILTIN_TESTS = new Set([
  "boolean", "callable", "defined", "divisibleby", "eq", "equalto", "escaped",
  "even", "falsy", "ge", "greaterthan", "gt", "in", "iterable", "le", "lessthan",
  "lower", "lt", "mapping", "match", "ne", "none", "null", "number", "odd",
  "sameas", "search", "string", "truthy", "undefined", "upper",
]);

function knownFilter(name: string): boolean {
  return BUILTIN_FILTERS.has(name) || getFilter(name) !== undefined || name in ANSIBLE_FILTERS;
}

function knownTest(name: string): boolean {
  return BUILTIN_TESTS.has(name) || name in ANSIBLE_TESTS;
}

function add(
  findings: ConvertFinding[],
  file: string,
  node: { lineno?: number } | undefined,
  construct: string,
  disposition: ConvertDisposition,
  message: string,
): void {
  const path = node?.lineno === undefined ? "template" : `line:${node.lineno}`;
  const key = `${path}|${construct}|${disposition}|${message}`;
  if (findings.some((f) => `${f.path}|${f.construct}|${f.disposition}|${f.message}` === key)) return;
  findings.push({ file, path, construct, disposition, message });
}

function isLoopCall(node: unknown): boolean {
  const name = (node as { name?: Record<string, unknown> } | undefined)?.name;
  if (name?.["typename"] !== "LookupVal") return false;
  const target = name["target"] as Record<string, unknown> | undefined;
  const val = name["val"] as Record<string, unknown> | undefined;
  return (
    target?.["typename"] === "Symbol" &&
    target["value"] === "loop" &&
    (val?.["typename"] === "Symbol" || val?.["typename"] === "Literal") &&
    val["value"] === "cycle"
  );
}

function nodeName(node: unknown): string | undefined {
  const rec = node as { value?: unknown; name?: unknown } | undefined;
  if (rec === undefined) return undefined;
  if (typeof rec.value === "string") return rec.value;
  if (typeof rec.name === "string") return rec.name;
  const nested = rec.name as { value?: unknown } | undefined;
  return typeof nested?.value === "string" ? nested.value : undefined;
}

function walk(value: unknown, findings: ConvertFinding[], file: string): void {
  if (value === null || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  const typename = typeof node["typename"] === "string" ? node["typename"] : undefined;
  if (typename === undefined) {
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach((entry) => walk(entry, findings, file));
      else walk(child, findings, file);
    }
    return;
  }

  switch (typename) {
    case "Root":
    case "NodeList":
    case "Output":
    case "Group":
    case "Array":
    case "Dict":
    case "Pair":
    case "KeywordArgs":
    case "Switch":
    case "Case":
    case "Compare":
    case "CompareOperand":
    case "And":
    case "Or":
    case "Not":
    case "UnaryOp":
    case "BinOp":
    case "Add":
    case "Sub":
    case "Mul":
    case "Div":
    case "FloorDiv":
    case "Pow":
    case "Mod":
    case "Concat":
    case "In":
    case "InlineIf":
    case "If":
    case "For":
    case "Set":
    case "LookupVal":
    case "Filter":
    case "Is":
      break;
    case "TemplateData":
    case "Symbol":
    case "Literal":
    case "Comment":
    case "Raw":
      return;
    case "Capture":
      add(findings, file, node as { lineno?: number }, "set-block", "review", "capture/set-block output may depend on whitespace/scope; review before Eta codegen");
      break;
    case "FunCall": {
      if (isLoopCall(node)) break;
      const name = nodeName(node["name"]);
      if (name === "lookup" || name === "query" || name === "q") {
        add(findings, file, node as { lineno?: number }, name, "handoff", "Ansible lookups/query are controller-side I/O and have no Eta equivalent");
      } else {
        add(findings, file, node as { lineno?: number }, name ?? "call", "review", "function calls need an explicit Eta helper mapping");
      }
      break;
    }
    case "Call":
    case "Macro":
    case "Import":
    case "FromImport":
    case "Include":
    case "Extends":
    case "Block":
    case "Super":
    case "TemplateRef":
      add(findings, file, node as { lineno?: number }, typename.toLowerCase(), "handoff", `${typename} constructs are outside the mechanical Eta subset`);
      break;
    case "CallExtension":
    case "CallExtensionAsync":
    case "FilterAsync":
      add(findings, file, node as { lineno?: number }, typename.toLowerCase(), "handoff", `${typename} has no deterministic Eta mapping`);
      break;
    default:
      add(findings, file, node as { lineno?: number }, typename, "handoff", `unknown Nunjucks node type '${typename}'`);
      break;
  }

  if (typename === "Filter") {
    const name = nodeName(node["name"]) ?? "filter";
    if (!knownFilter(name)) {
      add(findings, file, node as { lineno?: number }, `filter:${name}`, "handoff", `filter '${name}' has no verified Eta equivalent`);
    } else if (["map", "select", "reject", "selectattr", "rejectattr"].includes(name)) {
      add(findings, file, node as { lineno?: number }, `filter:${name}`, "review", `filter '${name}' with attribute expressions needs an Eta parity fixture`);
    } else if (name === "default") {
      const args = (node["args"] as { children?: unknown[] } | undefined)?.children ?? [];
      if (args.some((arg) => nodeName(arg) === "omit")) {
        add(findings, file, node as { lineno?: number }, "default(omit)", "review", "omit behavior differs between the strict Jinja and lenient Eta runtimes");
      }
    }
  }
  if (typename === "Is") {
    const test = nodeName(node["right"]);
    if (test !== undefined && !knownTest(test)) {
      add(findings, file, node as { lineno?: number }, `test:${test}`, "handoff", `test '${test}' has no verified Eta equivalent`);
    }
  }

  for (const [key, child] of Object.entries(node)) {
    if (key === "typename") continue;
    if (Array.isArray(child)) child.forEach((entry) => walk(entry, findings, file));
    else walk(child, findings, file);
  }
}

/**
 * @summary Analyze a Jinja/Nunjucks template for ADR 0031 conversion. Classifies constructs as mapped/review/handoff without generating Eta.
 * @param source Template text.
 * @param file Source path used in findings.
 * @returns Per-construct findings and the overall file disposition.
 */
export function analyzeTemplate(source: string, file: string): TemplateAnalysis {
  const findings: ConvertFinding[] = [];
  if (/\bnamespace\s*\(/.test(source)) {
    add(findings, file, undefined, "namespace", "review", "namespace mutation across scopes needs a parity fixture");
  }
  try {
    const parser = (nunjucks as unknown as { parser: { parse(text: string): unknown } }).parser;
    const ast = parser.parse(source);
    walk(ast, findings, file);
  } catch (error) {
    add(
      findings,
      file,
      undefined,
      "parse-error",
      "handoff",
      `could not parse template: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const disposition: ConvertDisposition = findings.some((f) => f.disposition === "handoff")
    ? "handoff"
    : findings.some((f) => f.disposition === "review")
      ? "review"
      : "mapped";
  if (disposition === "mapped") {
    add(findings, file, undefined, "template", "mapped", "template is fully mapped");
  }
  return { file, disposition, findings };
}

/** Result of attempting to generate Eta for one template. */
export interface EtaGeneration {
  ok: boolean;
  eta?: string;
  reason?: string;
}

interface EmitContext {
  loopId: number;
  draft?: boolean;
}

function fail(message: string): never {
  throw new Error(message);
}

function handoffMarker(node: unknown, label: string): string {
  const line = (node as { lineno?: number } | undefined)?.lineno ?? 0;
  return `/* HANDOFF: ${label} @ line ${line} */`;
}

function emitExpr(node: unknown, ctx: EmitContext): string {
  const rec = node as Record<string, unknown>;
  const typename = typeof rec["typename"] === "string" ? rec["typename"] : "";
  switch (typename) {
    case "Symbol": {
      const value = String(rec["value"]);
      if (value === "True" || value === "true") return "true";
      if (value === "False" || value === "false") return "false";
      if (value === "None" || value === "none" || value === "null") return "null";
      return value;
    }
    case "Literal":
      return JSON.stringify(rec["value"]);
    case "LookupVal": {
      const target = emitExpr(rec["target"], ctx);
      const val = rec["val"] as Record<string, unknown>;
      if (val?.["typename"] === "Literal" && typeof val["value"] === "string") {
        return `${target}[${JSON.stringify(val["value"])}]`;
      }
      if (val?.["typename"] === "Literal" && typeof val["value"] === "number") {
        return `${target}[${val["value"]}]`;
      }
      if (val?.["typename"] === "Symbol") return `${target}.${String(val["value"])}`;
      return `${target}[${emitExpr(val, ctx)}]`;
    }
    case "Group":
      return `(${emitExpr((rec["children"] as unknown[])[0], ctx)})`;
    case "Array":
      return `[${((rec["children"] as unknown[]) ?? []).map((child) => emitExpr(child, ctx)).join(", ")}]`;
    case "Dict":
      return `{ ${((rec["children"] as unknown[]) ?? []).map((pair) => emitPair(pair, ctx)).join(", ")} }`;
    case "Pair":
      return emitPair(rec, ctx);
    case "Compare": {
      const left = rec["left"] as Record<string, unknown>;
      const base = emitExpr(left["expr"], ctx);
      const ops = (left["ops"] as Array<Record<string, unknown>>) ?? [];
      return ops.reduce((acc, op) => `${acc} ${String(op["type"])} ${emitExpr(op["expr"], ctx)}`, base);
    }
    case "Add":
    case "Sub":
    case "Mul":
    case "Div":
    case "Pow":
    case "Mod": {
      const op = { Add: "+", Sub: "-", Mul: "*", Div: "/", Pow: "**", Mod: "%" }[typename]!;
      return `(${emitExpr(rec["left"], ctx)} ${op} ${emitExpr(rec["right"], ctx)})`;
    }
    case "FloorDiv":
      return `Math.floor(${emitExpr(rec["left"], ctx)} / ${emitExpr(rec["right"], ctx)})`;
    case "Concat":
      return `(String(${emitExpr(rec["left"], ctx)}) + String(${emitExpr(rec["right"], ctx)}))`;
    case "In":
      return `(${emitExpr(rec["right"], ctx)}).includes(${emitExpr(rec["left"], ctx)})`;
    case "And":
      return `(${emitExpr(rec["left"], ctx)} && ${emitExpr(rec["right"], ctx)})`;
    case "Or":
      return `(${emitExpr(rec["left"], ctx)} || ${emitExpr(rec["right"], ctx)})`;
    case "Not":
      return `(!(${emitExpr(rec["target"], ctx)}))`;
    case "UnaryOp":
      return `(${String(rec["op"] ?? "-")}${emitExpr(rec["target"], ctx)})`;
    case "InlineIf":
      return `(${emitExpr(rec["cond"], ctx)} ? ${emitExpr(rec["body"], ctx)} : ${emitExpr(rec["else_"], ctx)})`;
    case "Is": {
      const test = nodeName(rec["right"]);
      if (test === undefined || !knownTest(test)) {
        if (ctx.draft) return `${handoffMarker(node, `test ${test ?? "?"}`)} undefined`;
        fail("test calls with arguments are not supported");
      }
      return `tests.${test}(${emitExpr(rec["left"], ctx)})`;
    }
    case "FunCall": {
      if (isLoopCall(node)) {
        const args = ((rec["args"] as { children?: unknown[] } | undefined)?.children ?? []).map((arg) =>
          emitExpr(arg, ctx),
        );
        return `loop.cycle(${args.join(", ")})`;
      }
      if (ctx.draft) return `${handoffMarker(node, "call")} undefined`;
      fail("function calls are not supported");
    }
    case "Filter": {
      const name = nodeName(rec["name"]);
      if (name === undefined || !knownFilter(name)) {
        if (ctx.draft) return `${handoffMarker(node, `filter ${name ?? "?"}`)} undefined`;
        fail("filter without a known name");
      }
      const args = ((rec["args"] as { children?: unknown[] } | undefined)?.children ?? []).map((arg) =>
        emitExpr(arg, ctx),
      );
      return `filters.${name}(${args.join(", ")})`;
    }
    default:
      if (ctx.draft) return `${handoffMarker(node, typename || "expression")} undefined`;
      fail(`unsupported expression node '${typename || "unknown"}'`);
  }
}

function emitPair(node: unknown, ctx: EmitContext): string {
  const rec = node as Record<string, unknown>;
  const key = rec["key"] as Record<string, unknown>;
  const value = emitExpr(rec["value"], ctx);
  if (key?.["typename"] === "Symbol") return `${String(key["value"])}: ${value}`;
  if (key?.["typename"] === "Literal") return `${JSON.stringify(key["value"])}: ${value}`;
  fail("unsupported dictionary key");
}

function emitNode(node: unknown, ctx: EmitContext): string {
  if (node === null || typeof node !== "object") return "";
  const rec = node as Record<string, unknown>;
  const typename = typeof rec["typename"] === "string" ? rec["typename"] : "";
  switch (typename) {
    case "Root":
    case "NodeList":
    case "Output":
      return ((rec["children"] as unknown[]) ?? []).map((child) => emitNode(child, ctx)).join("");
    case "TemplateData":
    case "Raw":
      return String(rec["value"] ?? "");
    case "Comment":
      return "";
    case "Macro":
    case "Import":
    case "FromImport":
    case "Include":
    case "Extends":
    case "Block":
    case "Super":
    case "TemplateRef":
    case "Call":
    case "CallExtension":
    case "CallExtensionAsync":
    case "FilterAsync":
      if (ctx.draft) return `<% ${handoffMarker(rec, typename)} %>`;
      fail(`${typename} constructs are not supported`);
    case "If": {
      const cond = emitExpr(rec["cond"], ctx);
      const body = emitNode(rec["body"], ctx);
      const otherwise = rec["else_"] === null || rec["else_"] === undefined ? "" : emitNode(rec["else_"], ctx);
      return `<% if (${cond}) { %>${body}<% }${otherwise ? ` else { %>${otherwise}<% }` : ""} %>`;
    }
    case "For": {
      const name = rec["name"] as Record<string, unknown>;
      if (name?.["typename"] !== "Symbol") {
        if (ctx.draft) return `<% ${handoffMarker(rec, "tuple loop")} %>`;
        fail("tuple loop targets are not supported");
      }
      const arr = rec["arr"] as Record<string, unknown>;
      if (arr?.["cond"] !== undefined) {
        if (ctx.draft) return `<% ${handoffMarker(rec, "filtered loop")} %>`;
        fail("filtered loops are not supported");
      }
      if (rec["else_"] !== null && rec["else_"] !== undefined) {
        if (ctx.draft) return `<% ${handoffMarker(rec, "for/else")} %>`;
        fail("for/else is not supported");
      }
      const id = ++ctx.loopId;
      const seq = `__seq_${id}`;
      const idx = `__i_${id}`;
      const variable = String(name["value"]);
      const body = emitNode(rec["body"], ctx);
      return [
        `<% const ${seq} = ${emitExpr(arr, ctx)}; %>`,
        `<% for (let ${idx} = 0; ${idx} < ${seq}.length; ${idx}++) { %>`,
        `<% const ${variable} = ${seq}[${idx}]; %>`,
        `<% const loop = { index: ${idx} + 1, index0: ${idx}, first: ${idx} === 0, last: ${idx} === ${seq}.length - 1, length: ${seq}.length, revindex: ${seq}.length - ${idx}, revindex0: ${seq}.length - ${idx} - 1, cycle: (...__args) => __args[${idx} % __args.length], previtem: ${idx} === 0 ? undefined : ${seq}[${idx} - 1], nextitem: ${idx} === ${seq}.length - 1 ? undefined : ${seq}[${idx} + 1] }; %>`,
        body,
        `<% } %>`,
      ].join("");
    }
    case "Set": {
      const targets = (rec["targets"] as Array<Record<string, unknown>>) ?? [];
      if (targets.length !== 1 || targets[0]?.["typename"] !== "Symbol") {
        if (ctx.draft) return `<% ${handoffMarker(rec, "multi-target set")} %>`;
        fail("multi-target set is not supported");
      }
      if ((rec["value"] as Record<string, unknown>)?.["typename"] === "Capture") {
        if (ctx.draft) return `<% ${handoffMarker(rec, "set-block")} %>`;
        fail("set-blocks are not supported");
      }
      return `<% let ${String(targets[0]["value"])} = ${emitExpr(rec["value"], ctx)}; %>`;
    }
    default:
      // Expression nodes appearing directly (e.g. inside Output) are emitted as output.
      return `<%= ${emitExpr(node, ctx)} %>`;
  }
}

/**
 * @summary Generate Eta for a template that the analyzer classified as fully mapped. Returns `ok:false` for any review/handoff construct or unsupported expression.
 * @param source Template text.
 * @param file Source path used in analysis/failures.
 * @returns Generated Eta or a reason it was skipped.
 */
export function generateEta(
  source: string,
  file: string,
  opts: { acceptReview?: boolean } = {},
): EtaGeneration {
  const analysis = analyzeTemplate(source, file);
  if (analysis.disposition === "handoff") {
    return { ok: false, reason: "template has handoff constructs" };
  }
  if (analysis.disposition === "review" && opts.acceptReview !== true) {
    return { ok: false, reason: "template has review constructs; pass --templates-review accept to convert" };
  }
  try {
    const parser = (nunjucks as unknown as { parser: { parse(text: string): unknown } }).parser;
    const ast = parser.parse(source);
    return { ok: true, eta: emitNode(ast, { loopId: 0 }) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * @summary Generate a complete partial Eta draft for a template with review/handoff constructs. Unsupported fragments become HANDOFF comment markers.
 * @param source Template text.
 * @param file Source path used for markers.
 * @returns Eta draft text.
 */
export function generateEtaDraft(source: string, file: string): string {
  const parser = (nunjucks as unknown as { parser: { parse(text: string): unknown } }).parser;
  try {
    const ast = parser.parse(source);
    return emitNode(ast, { loopId: 0, draft: true });
  } catch (error) {
    return `<% ${handoffMarker(undefined, "parse-error")} %>\n/* ${String(error)} */\n`;
  }
}
