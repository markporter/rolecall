/**
 * @summary Error thrown when a variable/fact value or a manifest document fails shape validation.
 */
export class VarManifestError extends Error {
  /** @summary Dot-path location of the failing value, e.g. `["nginx_vhosts", "2", "filename"]`. */
  readonly location?: ReadonlyArray<string>;
  /** @summary The expected shape (TypeSpec or scalar name) for diagnostics. */
  readonly expectedShape?: unknown;
  /** @summary The runtime `typeof`/constructor name of the actual value. */
  readonly actualKind?: string;

  /**
   * @summary Construct a validation error with optional diagnostics.
   * @param message Human-readable failure description.
   * @param options Diagnostic context: location path, expected shape, actual kind.
   */
  constructor(
    message: string,
    options?: {
      location?: ReadonlyArray<string>;
      expectedShape?: unknown;
      actualKind?: string;
    },
  ) {
    super(message);
    this.name = "VarManifestError";
    this.location = options?.location;
    this.expectedShape = options?.expectedShape;
    this.actualKind = options?.actualKind;
    Object.setPrototypeOf(this, VarManifestError.prototype);
  }
}
