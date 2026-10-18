// Node-runtime crypto PAL — wraps node:crypto's createHash (used for the
// idempotency cache key), matching the Bun WebCrypto implementation's digest.
import { createHash } from "node:crypto";
import type { CryptoPAL } from "./types";

/** @summary Node-runtime crypto PAL that computes a SHA-256 hex digest via node:crypto's createHash. @param input UTF-8 string or raw bytes to hash. @returns The lowercase hex digest of the SHA-256 hash. */
export class NodeCryptoPAL implements CryptoPAL {
  async sha256Hex(input: string | Uint8Array): Promise<string> {
    return createHash("sha256").update(input).digest("hex");
  }
}
