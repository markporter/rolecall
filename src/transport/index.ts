// transport barrel — Connection trait + SSH/Local/Network/HttpApi implementers.
export * from "./connection";
export * from "./ssh";
export * from "./local";
export * from "./network";
export * from "./diff";
export * from "./http";

import type { Connection, ConnectionOptions } from "./connection";
import { SshConnection } from "./ssh";
import { LocalConnection } from "./local";
import { HttpApiConnection } from "./http";
import { NetworkSshConnection } from "./network";

/**
 * Construct a Connection from its discriminated options. The `kind` field
 * selects the implementer; unknown kinds are a compile-time exhaustiveness error.
 */
export function createConnection(options: ConnectionOptions): Connection {
  switch (options.kind) {
    case "ssh":
      return new SshConnection(options);
    case "local":
      return new LocalConnection(options);
    case "network":
      return new NetworkSshConnection(options);
    case "http":
      return new HttpApiConnection(options);
    default: {
      const _exhaustive: never = options;
      throw new Error(`createConnection: unknown connection kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
