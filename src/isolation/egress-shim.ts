// TCP↔Unix-socket shim for the sandbox.
//
// The sandbox keeps its network namespace detached except for loopback. This
// process runs INSIDE that namespace, listens on 127.0.0.1:<port>, and forwards
// each TCP connection to the host-side egress broker over a bind-mounted Unix
// socket. Proxy-aware clients (curl/git/apt) then use HTTP(S)_PROXY on loopback.

import { createServer, connect, type Socket } from "node:net";

export interface EgressShimOptions {
  socketPath: string;
  host?: string;
  port?: number;
}

export interface EgressShimHandle {
  address: string;
  close: () => Promise<void>;
}

/** Start the shim and return once it is listening. */
export async function startEgressShim(options: EgressShimOptions): Promise<EgressShimHandle> {
  const server = createServer((client: Socket) => {
    // Buffer client bytes until the broker connection exists; curl writes its
    // request immediately, before the async Unix-socket connect completes.
    const pending: Buffer[] = [];
    const onData = (chunk: Buffer): void => {
      pending.push(chunk);
    };
    client.on("data", onData);
    const upstream = connect({ path: options.socketPath });
    client.on("error", () => upstream.destroy());
    client.on("close", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    upstream.on("close", () => client.destroy());
    upstream.once("connect", () => {
      client.pause();
      client.off("data", onData);
      for (const chunk of pending.splice(0)) upstream.write(chunk);
      upstream.pipe(client);
      client.pipe(upstream);
      client.resume();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    address: `${options.host ?? "127.0.0.1"}:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
