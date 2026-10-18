import { describe, it, expect } from "bun:test";
import { VarManifestError } from "../src/config/var-manifest/errors";
import {
  validateValueAgainstSpec,
  validateEntry,
  parseManifestYaml,
} from "../src/config/var-manifest/validate";
import type { VarManifestEntry, VarManifestTypeSpec } from "../src/config/var-manifest/types";

const exampleYaml = `
vars:
  - name: nginx_port
    kind: var
    source: declared
    type: number
    default: 80
    description: TCP port for the nginx vhost
  - name: nginx_vhosts
    kind: var
    source: declared
    type:
      array:
        of:
          object:
            props:
              filename: { type: string, required: true }
              port: { type: number }
    default: []
  - name: os
    kind: fact
    source: observed
    type: string
`;

describe("parseManifestYaml", () => {
  it("parses a valid manifest", () => {
    const entries = parseManifestYaml(exampleYaml);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.name).toBe("nginx_port");
  });

  it("rejects a structurally malformed manifest", () => {
    expect(() => parseManifestYaml("vars:\n  - name: 1\n")).toThrow(VarManifestError);
  });

  it("rejects non-YAML text", () => {
    expect(() => parseManifestYaml("\t:: : [\n  - {")).toThrow(VarManifestError);
  });
});

describe("validateValueAgainstSpec", () => {
  it("accepts a matching scalar", () => {
    expect(() => validateValueAgainstSpec(80, "number")).not.toThrow();
  });

  it("rejects the wrong scalar kind", () => {
    expect(() => validateValueAgainstSpec("80", "number")).toThrow(VarManifestError);
  });

  it("accepts 'any' for any value", () => {
    expect(() => validateValueAgainstSpec({ weird: true }, "any")).not.toThrow();
  });

  it("reports the array element index in the error path", () => {
    const spec: VarManifestTypeSpec = { array: { of: "string" } };
    expect(() => validateValueAgainstSpec(["a", 2], spec)).toThrow(/\[1\]/);
  });

  it("flags a missing required object property", () => {
    const spec: VarManifestTypeSpec = {
      object: { props: { filename: { type: "string", required: true } } },
    };
    expect(() => validateValueAgainstSpec({ port: 1 }, spec)).toThrow(
      /missing required property 'filename'/,
    );
  });

  it("ignores extra object keys", () => {
    const spec: VarManifestTypeSpec = {
      object: { props: { filename: { type: "string" } } },
    };
    expect(() => validateValueAgainstSpec({ filename: "x", extra: 1 }, spec)).not.toThrow();
  });

  it("validates nested object arrays", () => {
    const spec: VarManifestTypeSpec = {
      array: {
        of: { object: { props: { filename: { type: "string", required: true } } } },
      },
    };
    expect(() => validateValueAgainstSpec([{ filename: "a" }, { filename: "b" }], spec)).not.toThrow();
    expect(() => validateValueAgainstSpec([{ filename: "a" }, { port: 1 }], spec)).toThrow(
      /\[1\]\.filename/,
    );
  });

  it("checks enum membership", () => {
    const spec: VarManifestTypeSpec = { enum: ["a", "b", 1] };
    expect(() => validateValueAgainstSpec("a", spec)).not.toThrow();
    expect(() => validateValueAgainstSpec(2, spec)).toThrow(VarManifestError);
  });

  it("accepts a value matching any union branch", () => {
    const spec: VarManifestTypeSpec = {
      union: ["string", { array: { of: "number" } }],
    };
    expect(() => validateValueAgainstSpec("x", spec)).not.toThrow();
    expect(() => validateValueAgainstSpec([1, 2], spec)).not.toThrow();
    expect(() => validateValueAgainstSpec(5, spec)).toThrow(VarManifestError);
  });
});

describe("validateEntry", () => {
  const base = (over: Partial<VarManifestEntry>): VarManifestEntry => ({
    name: "x",
    kind: "var",
    source: "declared",
    type: "string",
    ...over,
  });

  it("accepts undefined when not required", () => {
    expect(() => validateEntry(undefined, base({ required: false }))).not.toThrow();
  });

  it("rejects undefined when required", () => {
    expect(() => validateEntry(undefined, base({ required: true }))).toThrow(/required/);
  });

  it("accepts null when nullable", () => {
    expect(() => validateEntry(null, base({ nullable: true }))).not.toThrow();
  });

  it("rejects null when non-nullable", () => {
    expect(() => validateEntry(null, base({ nullable: false }))).toThrow(/null is not allowed/);
  });

  it("validates shape for present values", () => {
    expect(() => validateEntry(5, base({ type: "string" }))).toThrow(/expected string/);
    expect(() => validateEntry("ok", base({ type: "string" }))).not.toThrow();
  });
});
