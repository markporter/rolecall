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
    case "Concat":
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
  if (/\{%-|-%\}|\{\{-|-\}\}/.test(source)) {
    add(findings, file, undefined, "whitespace-trim", "review", "whitespace-control trim markers need a byte-parity fixture");
  }
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
    add(findings, file, undefined, "template", "mapped", "template is mechanically convertible (Eta codegen not implemented yet)");
  }
  return { file, disposition, findings };
}
