// Bun-native HTTP server PAL — wraps Bun.serve.
import type { HttpPAL, HttpServerOptions, HttpServerHandle } from "./types";

/** @summary Bun-runtime HTTP server PAL that wraps Bun.serve behind the async HttpPAL contract. @param options Port, optional hostname, and the fetch handler. @returns A handle exposing the bound URL and a stop() that delegates to Bun.serve. */
export class BunHttpPAL implements HttpPAL {
  async serve(options: HttpServerOptions): Promise<HttpServerHandle> {
    const server = Bun.serve({
      port: options.port,
      hostname: options.hostname,
      fetch: options.fetch,
    });
    return {
      url: server.url.toString(),
      stop: (immediate?: boolean) => server.stop(immediate),
    };
  }
}
