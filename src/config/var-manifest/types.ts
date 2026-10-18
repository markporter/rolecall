import { z } from "zod";

/**
 * @summary Scalar type names supported by the variable-manifest type system.
 */
export type VarManifestScalar = "string" | "number" | "boolean" | "any";

/**
 * @summary Type spec asserting a homogeneous array of `of` elements.
 */
export interface VarManifestArraySpec {
  array: { of: VarManifestTypeSpec };
}

/**
 * @summary Type spec asserting an object with the declared `props`.
 */
export interface VarManifestObjectSpec {
  object: { props: Record<string, VarManifestPropSpec> };
}

/**
 * @summary Type spec asserting the value is one of the listed enum members.
 */
export interface VarManifestEnumSpec {
  enum: ReadonlyArray<unknown>;
}

/**
 * @summary Type spec asserting the value matches at least one branch of the union.
 */
export interface VarManifestUnionSpec {
  union: ReadonlyArray<VarManifestTypeSpec>;
}

/**
 * @summary Recursive type spec describing the shape of a declared variable or fact.
 */
export type VarManifestTypeSpec =
  | VarManifestScalar
  | VarManifestArraySpec
  | VarManifestObjectSpec
  | VarManifestEnumSpec
  | VarManifestUnionSpec;

/**
 * @summary A single declared property inside an object spec.
 */
export interface VarManifestPropSpec {
  type: VarManifestTypeSpec;
  required?: boolean;
  description?: string;
}

/**
 * @summary A single declared variable or fact in a manifest.
 */
export interface VarManifestEntry {
  name: string;
  kind: "var" | "fact";
  source: "declared" | "observed";
  type: VarManifestTypeSpec;
  nullable?: boolean;
  required?: boolean;
  default?: unknown;
  description?: string;
  example?: unknown;
  /** Source file that declared this entry; populated by the loader, not part of the on-disk schema. Enables btool-style "which file declared it" surfacing. */
  declaredIn?: string;
  /** Optional 1-based line in the declaring file; populated by the loader when available. */
  line?: number;
}

const scalarSchema = z.enum(["string", "number", "boolean", "any"]);

// Forward-declared; resolved lazily to allow the recursive type spec.
const propSpecSchema: z.ZodType<VarManifestPropSpec> = z.lazy(() =>
  z.object({
    type: typeSpecSchema,
    required: z.boolean().optional(),
    description: z.string().optional(),
  }),
) as unknown as z.ZodType<VarManifestPropSpec>;

/**
 * @summary Zod schema for a recursive {@link VarManifestTypeSpec}.
 */
export const typeSpecSchema: z.ZodType<VarManifestTypeSpec> = z.lazy(() =>
  z.union([
    scalarSchema,
    z.object({ array: z.object({ of: typeSpecSchema }) }),
    z.object({ object: z.object({ props: z.record(z.string(), propSpecSchema) }) }),
    z.object({ enum: z.array(z.unknown()) }),
    z.object({ union: z.array(typeSpecSchema) }),
  ]),
) as unknown as z.ZodType<VarManifestTypeSpec>;

/**
 * @summary Zod schema for a single {@link VarManifestEntry}.
 */
export const varManifestEntrySchema: z.ZodType<VarManifestEntry> = z.lazy(() =>
  z.object({
    name: z.string().min(1),
    kind: z.enum(["var", "fact"]),
    source: z.enum(["declared", "observed"]),
    type: typeSpecSchema,
    nullable: z.boolean().optional(),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
    description: z.string().optional(),
    example: z.unknown().optional(),
    declaredIn: z.string().optional(),
    line: z.number().int().optional(),
  }),
) as unknown as z.ZodType<VarManifestEntry>;

/**
 * @summary Zod schema for an on-disk manifest document. Accepts either a bare array of
 * entries (`- name: ...`) or the wrapped form `{ vars: [...] }`.
 */
export const varManifestFileSchema = z.union([
  z.object({ vars: z.array(varManifestEntrySchema) }),
  z.array(varManifestEntrySchema),
]);

/** @summary Inferred shape of a parsed manifest file. */
export type VarManifestFile = z.infer<typeof varManifestFileSchema>;
