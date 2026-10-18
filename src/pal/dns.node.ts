// Node-runtime DNS PAL — wraps node:dns/promises lookup({ all: true }).
import { lookup } from "node:dns/promises";
import type { DnsPAL } from "./types";

/** @summary Node-runtime DNS PAL that resolves a hostname to every A/AAAA address. @param hostname Hostname to resolve. @returns All resolved IP address strings. */
export class NodeDnsPAL implements DnsPAL {
  async lookup(hostname: string): Promise<string[]> {
    const res = await lookup(hostname, { all: true });
    return res.map((r) => r.address);
  }
}
