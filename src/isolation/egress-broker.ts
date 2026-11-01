// Minimal egress broker for ADR 0025: the shell sandbox's only route to
// allow-listed destinations. It speaks HTTP CONNECT, absolute-form HTTP, and
// SOCKS5, checks every destination through EgressPolicy, resolves once, and
// connects to the validated IP (no second lookup).
//
// The sandbox-side wiring (mounting a Unix socket + proxy env/shim) is a
// separate step; this module is the tested broker core.

import { createServer, connect, type Server, type Socket } from "node:net";

import { EgressPolicy } from "./egress";

export interface EgressAuditEvent {
  allowed: boolean;
  host: string;
  port: number;
  addresses?: string[];
  reason: string;
  protocol: "http-connect" | "http" | "socks5";
}

export interface EgressBrokerOptions {
  policy: EgressPolicy;
  /** Listen host (default 127.0.0.1) when no Unix socket is used. */
  host?: string;
  /** Listen port (0 = ephemeral). */
  port?: number;
  /** Unix socket path; when set, host/port are ignored. */
  socketPath?: string;
  /** Non-secret allow/deny audit sink. */
  audit?: (event: EgressAuditEvent) => void;
}

export interface EgressBrokerHandle {
  /** Unix socket path or `host:port` clients should connect to. */
  address: string;
  close: () => Promise<void>;
}

function parseHostPort(value: string): { host: string; port: number } | undefined {
  const bracket = value.match(/^\[([^\]]+)\]:(\d+)$/);
  if (bracket) return { host: bracket[1]!, port: Number(bracket[2]) };
  const idx = value.lastIndexOf(":");
  if (idx <= 0) return undefined;
  const port = Number(value.slice(idx + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return { host: value.slice(0, idx), port };
}

function denyHttp(socket: Socket, status = "403 Forbidden"): void {
  socket.end(`HTTP/1.1 ${status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
}

function pipe(socket: Socket, upstream: Socket, initialWrite: string | Buffer): void {
  if (typeof initialWrite === "string") socket.write(initialWrite);
  else if (initialWrite.length > 0) upstream.write(initialWrite);
  socket.pipe(upstream);
  upstream.pipe(socket);
  socket.on("error", () => upstream.destroy());
  upstream.on("error", () => socket.destroy());
}

async function handleHttp(
  socket: Socket,
  raw: Buffer,
  options: EgressBrokerOptions,
  audit: (e: EgressAuditEvent) => void,
): Promise<void> {
  const headerEnd = raw.indexOf("\r\n\r\n");
  if (headerEnd < 0) {
    if (raw.length > 16_384) denyHttp(socket, "431 Request Header Fields Too Large");
    return; // wait for more bytes
  }
  const head = raw.subarray(0, headerEnd).toString("utf8");
  const rest = raw.subarray(headerEnd + 4);
  const lines = head.split("\r\n");
  const first = lines[0] ?? "";

  const connectMatch = first.match(/^CONNECT\s+(\S+)\s+HTTP\/1\.[01]$/i);
  if (connectMatch) {
    const target = parseHostPort(connectMatch[1]!);
    if (!target) return denyHttp(socket, "400 Bad Request");
    const decision = await options.policy.checkTarget(target.host, target.port, "shell");
    audit({ ...decision, protocol: "http-connect" });
    if (!decision.allowed) return denyHttp(socket, "403 Forbidden");
    const upstream = connect({ host: decision.addresses?.[0] ?? target.host, port: target.port });
    upstream.once("connect", () => pipe(socket, upstream, "HTTP/1.1 200 Connection Established\r\n\r\n"));
    upstream.once("error", () => denyHttp(socket, "502 Bad Gateway"));
    return;
  }

  const absolute = first.match(/^([A-Z]+)\s+(https?:\/\/\S+)\s+HTTP\/1\.[01]$/i);
  if (!absolute) return denyHttp(socket, "400 Bad Request");
  let url: URL;
  try {
    url = new URL(absolute[2]!);
  } catch {
    return denyHttp(socket, "400 Bad Request");
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  const decision = await options.policy.checkTarget(url.hostname, port, "shell");
  audit({ ...decision, protocol: "http" });
  if (!decision.allowed) return denyHttp(socket, "403 Forbidden");
  const upstream = connect({ host: decision.addresses?.[0] ?? url.hostname, port });
  const remaining = lines.slice(1).join("\r\n");
  const rewritten = `${absolute[1]} ${url.pathname}${url.search} HTTP/1.1\r\n${remaining}\r\n\r\n`;
  upstream.once("connect", () => {
    upstream.write(rewritten);
    pipe(socket, upstream, rest);
  });
  upstream.once("error", () => denyHttp(socket, "502 Bad Gateway"));
}

async function handleSocks5(
  socket: Socket,
  raw: Buffer,
  options: EgressBrokerOptions,
  audit: (e: EgressAuditEvent) => void,
): Promise<void> {
  if (raw.length < 2) return;
  const nmethods = raw[1]!;
  if (raw.length < 2 + nmethods) return;
  socket.write(Buffer.from([0x05, 0x00]));

  // Request may arrive later; buffer until the full ATYP/address/port is present.
  let buf = Buffer.alloc(0);
  const onData = (chunk: Buffer): void => {
    buf = Buffer.concat([buf, chunk]);
    const parsed = parseSocks5Request(buf);
    if (!parsed) return;
    socket.off("data", onData);
    void (async () => {
      const decision = await options.policy.checkTarget(parsed.host, parsed.port, "shell");
      audit({ ...decision, protocol: "socks5" });
      if (!decision.allowed) {
        socket.end(Buffer.from([0x05, 0x02, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        return;
      }
      const upstream = connect({ host: decision.addresses?.[0] ?? parsed.host, port: parsed.port });
      upstream.once("connect", () => {
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      upstream.once("error", () => socket.end(Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0])));
    })();
  };
  socket.on("data", onData);
  if (raw.length > 2 + nmethods) onData(raw.subarray(2 + nmethods));
}

function parseSocks5Request(buf: Buffer): { host: string; port: number } | undefined {
  if (buf.length < 4 || buf[0] !== 0x05 || buf[1] !== 0x01) return undefined;
  const atyp = buf[3];
  let offset = 4;
  let host: string;
  if (atyp === 0x01) {
    if (buf.length < offset + 4 + 2) return undefined;
    host = `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
    offset += 4;
  } else if (atyp === 0x03) {
    if (buf.length < offset + 1) return undefined;
    const len = buf[offset]!;
    if (buf.length < offset + 1 + len + 2) return undefined;
    host = buf.subarray(offset + 1, offset + 1 + len).toString("utf8");
    offset += 1 + len;
  } else if (atyp === 0x04) {
    if (buf.length < offset + 16 + 2) return undefined;
    const parts: string[] = [];
    for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(offset + i).toString(16));
    host = parts.join(":");
    offset += 16;
  } else {
    return undefined;
  }
  const port = buf.readUInt16BE(offset);
  return { host, port };
}

/** Start the egress broker on a Unix socket or a loopback TCP port. */
export async function startEgressBroker(options: EgressBrokerOptions): Promise<EgressBrokerHandle> {
  const audit = options.audit ?? (() => undefined);
  const server: Server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer[0] === 0x05) {
        socket.off("data", onData);
        void handleSocks5(socket, buffer, options, audit);
        return;
      }
      if (buffer.includes("\r\n\r\n")) {
        socket.off("data", onData);
        void handleHttp(socket, buffer, options, audit);
      } else if (buffer.length > 16_384) {
        socket.off("data", onData);
        denyHttp(socket, "431 Request Header Fields Too Large");
      }
    };
    socket.on("data", onData);
    socket.on("error", () => socket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    if (options.socketPath) server.listen(options.socketPath, () => resolve());
    else server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => resolve());
  });

  const address = options.socketPath
    ? options.socketPath
    : `${options.host ?? "127.0.0.1"}:${(server.address() as { port: number }).port}`;

  return {
    address,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
