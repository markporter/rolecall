// Node-runtime HTTP server PAL — adapts node:http's IncomingMessage/ServerResponse
// to the web Request/Response contract so the same fetch handler runs on both
// runtimes (Bun.serve under Bun, node:http here).
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { HttpPAL, HttpServerOptions, HttpServerHandle } from "./types";

function toWebRequest(req: IncomingMessage): Request {
  const url = new URL(req.url ?? "/", "http://localhost");

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  const bodyless = req.method === "GET" || req.method === "HEAD";
  // Node's Request requires duplex: "half" whenever the body is a stream.
  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
    duplex: "half",
  };
  if (!bodyless) init.body = Readable.toWeb(req) as unknown as RequestInit["body"];
  return new Request(url.toString(), init);
}

async function handleRequest(
  options: HttpServerOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const response = await options.fetch(toWebRequest(req));
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.statusCode = 500;
    res.end(message);
  }
}

function stopServer(server: Server, immediate?: boolean): Promise<void> {
  return new Promise<void>((resolve) => {
    if (immediate) server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

/** @summary Node-runtime HTTP server PAL built on node:http, converting each request to a web Request and streaming the handler's Response back. @param options Port, optional hostname, and the fetch handler. @returns A handle exposing the bound URL and a stop() that closes the server (optionally destroying live connections). */
export class NodeHttpPAL implements HttpPAL {
  async serve(options: HttpServerOptions): Promise<HttpServerHandle> {
    const server = createServer((req, res) => {
      void handleRequest(options, req, res);
    });

    await new Promise<void>((resolve, reject) => {
      let listening = false;
      server.once("listening", () => {
        listening = true;
        resolve();
      });
      server.on("error", (err) => {
        if (!listening) reject(err);
      });
      server.listen(options.port, options.hostname);
    });

    const address = server.address();
    const host = options.hostname ?? "127.0.0.1";
    const port = typeof address === "object" && address !== null ? address.port : options.port;
    return {
      url: `http://${host}:${port}/`,
      stop: (immediate?: boolean) => stopServer(server, immediate),
    };
  }
}
