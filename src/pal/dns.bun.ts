// Bun-native DNS PAL — wraps Bun.dns.lookup.
import type { DnsPAL } from "./types";

export class BunDnsPAL implements DnsPAL {
  async lookup(hostname: string): Promise<string[]> {
    // Bun.dns.lookup resolves to Array<{address}> (or a bare string on some backends).
    const res = await Bun.dns.lookup(hostname);
    if (typeof res === "string") return [res];
    return res.map((r) => (typeof r === "string" ? r : r.address));
  }
}
