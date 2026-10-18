// Bun-native crypto PAL — WebCrypto SHA-256 (used for idempotency cache key).
import type { CryptoPAL } from "./types";

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

// WebCrypto digest input type (BufferSource) is not a global in our ES2022 lib config.
type DigestInput = Parameters<typeof crypto.subtle.digest>[1];

export class BunCryptoPAL implements CryptoPAL {
  async sha256Hex(input: string | Uint8Array): Promise<string> {
    const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
    const digest = await crypto.subtle.digest("SHA-256", data as DigestInput);
    return toHex(digest);
  }
}
