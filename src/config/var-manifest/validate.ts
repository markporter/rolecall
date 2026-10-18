import { load as yamlLoad } from "js-yaml";
import { VarManifestError } from "./errors";
import {
  varManifestFileSchema,
  type VarManifestEntry,
  type VarManifestScalar,
  type VarManifestTypeSpec,
} from "./types";

function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function pathStr(path: ReadonlyArray<string>): string {
  if (path.length === 0) return "<root>";
  let out = "";
  for (const seg of path) {
    if (/^\d+$/.test(seg)) {
      out += `[${seg}]`;
    } else {
      out += out.length === 0 ? seg : `.${seg}`;
    }
  }
  return out;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a === "object" &&
    a !== null &&
    typeof b === "object" &&
    b !== null
  ) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function validateScalar(
  value: unknown,
  scalar: VarManifestScalar,
  path: ReadonlyArray<string>,
): void {
  if (scalar === "any") return;
  if (scalar === "string" && typeof value !== "string") {
    throw new VarManifestError(`${pathStr(path)}: expected string, got ${kindOf(value)}`, {
      location: path,
      expectedShape: "string",
      actualKind: kindOf(value),
    });
  }
  if (scalar === "boolean" && typeof value !== "boolean") {
    throw new VarManifestError(`${pathStr(path)}: expected boolean, got ${kindOf(value)}`, {
      location: path,
      expectedShape: "boolean",
      actualKind: kindOf(value),
    });
  }
  if (scalar === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new VarManifestError(`${pathStr(path)}: expected number, got ${kindOf(value)}`, {
        location: path,
        expectedShape: "number",
        actualKind: kindOf(value),
      });
    }
  }
}

/**
 * @summary Assert that `value` conforms to `spec`, throwing {@link VarManifestError} otherwise.
 * @param value The runtime value to validate.
 * @param spec The declared type spec.
 * @param path Dot-path location of `value`, for error messages.
 */
export function validateValueAgainstSpec(
  value: unknown,
  spec: VarManifestTypeSpec,
  path: ReadonlyArray<string> = [],
): void {
  if (typeof spec === "string") {
    validateScalar(value, spec, path);
    return;
  }
  if ("array" in spec) {
    if (!Array.isArray(value)) {
      throw new VarManifestError(`${pathStr(path)}: expected array, got ${kindOf(value)}`, {
        location: path,
        expectedShape: spec,
        actualKind: kindOf(value),
      });
    }
    value.forEach((element, index) => {
      validateValueAgainstSpec(element, spec.array.of, [...path, String(index)]);
    });
    return;
  }
  if ("object" in spec) {
    if (value === null || Array.isArray(value) || typeof value !== "object") {
      throw new VarManifestError(`${pathStr(path)}: expected object, got ${kindOf(value)}`, {
        location: path,
        expectedShape: spec,
        actualKind: kindOf(value),
      });
    }
    const record = value as Record<string, unknown>;
    for (const [key, prop] of Object.entries(spec.object.props)) {
      const present = key in record;
      if (prop.required === true && !present) {
        throw new VarManifestError(
          `${pathStr([...path, key])}: missing required property '${key}'`,
          { location: [...path, key], expectedShape: prop.type },
        );
      }
      if (present) {
        validateValueAgainstSpec(record[key], prop.type, [...path, key]);
      }
    }
    return;
  }
  if ("enum" in spec) {
    const ok = spec.enum.some((candidate) => valuesEqual(candidate, value));
    if (!ok) {
      throw new VarManifestError(`${pathStr(path)}: value not in allowed enum`, {
        location: path,
        expectedShape: spec.enum,
        actualKind: kindOf(value),
      });
    }
    return;
  }
  if ("union" in spec) {
    const failures: string[] = [];
    for (const branch of spec.union) {
      try {
        validateValueAgainstSpec(value, branch, path);
        return;
      } catch (err) {
        if (err instanceof VarManifestError) {
          failures.push(err.message);
        } else {
          throw err;
        }
      }
    }
    throw new VarManifestError(
      `${pathStr(path)}: value matched none of the union branches:\n  - ${failures.join("\n  - ")}`,
      { location: path, expectedShape: spec.union, actualKind: kindOf(value) },
    );
  }
}

/**
 * @summary Validate a top-level entry value, handling required/undefined and nullable/null before shape checks.
 * @param value The resolved value (may be `undefined` if absent, or `null`).
 * @param entry The manifest entry declaring the var/fact.
 * @param path Override path (defaults to the entry name).
 */
export function validateEntry(
  value: unknown,
  entry: VarManifestEntry,
  path: ReadonlyArray<string> = [entry.name],
): void {
  if (value === undefined) {
    if (entry.required === true) {
      throw new VarManifestError(`required ${entry.kind} '${entry.name}' has no value`, {
        location: path,
        expectedShape: entry.type,
      });
    }
    return;
  }
  if (value === null) {
    if (entry.nullable === true) return;
    throw new VarManifestError(
      `null is not allowed in non-nullable ${entry.kind} '${entry.name}'`,
      { location: path, expectedShape: entry.type },
    );
  }
  validateValueAgainstSpec(value, entry.type, path);
}

/**
 * @summary Parse a YAML manifest document and return its validated entries.
 * @param text YAML text whose root is a bare array of entries or `{ vars: VarManifestEntry[] }`.
 * @returns The array of declared entries.
 */
export function parseManifestYaml(text: string): VarManifestEntry[] {
  let doc: unknown;
  try {
    doc = yamlLoad(text);
  } catch (err) {
    throw new VarManifestError(`manifest is not valid YAML: ${(err as Error).message}`);
  }
  const parsed = varManifestFileSchema.safeParse(doc);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (!issue) {
      throw new VarManifestError("invalid manifest: no issues reported");
    }
    const where = issue.path.length ? issue.path.join(".") : "manifest";
    throw new VarManifestError(`invalid manifest at ${where}: ${issue.message}`);
  }
  const data = parsed.data;
  return Array.isArray(data) ? data : data.vars;
}
