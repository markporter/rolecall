// Embedded release verification keys (ADR 0029). Release builds replace this
// file with the public key from ROLECALL_RELEASE_PUBLIC_KEY; the default is
// empty so a source checkout must set the env/file override.
export const EMBEDDED_RELEASE_PUBLIC_KEYS: string[] = [];
