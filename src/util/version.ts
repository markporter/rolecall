import pkg from "../../package.json" with { type: "json" };

/** RoleCall release version, sourced from the package manifest. Used by the `rolecall` namespace (ADR 0013 §10). */
export const ROLECALL_VERSION: string = (pkg as { version: string }).version;
