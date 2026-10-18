// Minimal ambient types for ssh2 (pure-JS SSH2 client).
// ssh2 ships without bundled .d.ts; we declare only the surface RoleCall's PAL uses.
// Installed with `bun add -d ssh2 --omit=optional` (see .omo/notepads/rolecall/issues.md).
declare module "ssh2" {
  export interface ClientChannel {
    on(event: "data", listener: (data: Buffer) => void): void;
    on(event: "close", listener: (code: number | null) => void): void;
    on(event: "error", listener: (err: Error) => void): void;
    close(): void;
    stderr: {
      on(event: "data", listener: (data: Buffer) => void): void;
    };
  }

  export interface ConnectConfig {
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKey?: string | Buffer;
    passphrase?: string;
    /** Keepalive interval in ms (0/undefined = disabled). */
    keepaliveInterval?: number;
    /** Max missed keepalives before the connection is dropped. */
    keepaliveCountMax?: number;
    /**
     * Host-key verification callback. Receives the raw host key buffer and a
     * verify(result) function. Returning true accepts the key.
     */
    hostVerifier?: (key: Buffer, verify: (result: boolean) => void) => void;
  }

  export class Client {
    on(event: "ready", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "close", listener: () => void): this;
    connect(config: ConnectConfig): void;
    exec(command: string, callback: (err: Error | undefined, stream: ClientChannel) => void): void;
    end(): void;
  }

  // --- Server-side surface (used only by tests for an in-process fake SSH server) ---

  export interface ServerAuthContext {
    method: string;
    username: string;
    password?: string;
    accept(): void;
    reject(): void;
  }

  export interface ServerExecInfo {
    command: string;
  }

  export interface ServerStream {
    write(data: string): void;
    exit(code: number): void;
    end(): void;
    close(): void;
    on(event: "data", listener: (data: Buffer) => void): void;
    on(event: "close", listener: () => void): void;
    stderr: { write(data: string): void };
  }

  export interface ServerSession {
    on(
      event: "exec",
      listener: (accept: () => ServerStream, reject: () => void, info: ServerExecInfo) => void,
    ): void;
  }

  export interface ServerConnection {
    on(event: "authentication", listener: (ctx: ServerAuthContext) => void): void;
    on(event: "ready", listener: () => void): void;
    on(event: "session", listener: (accept: () => ServerSession, reject: () => void) => void): void;
    on(event: "close", listener: () => void): void;
    on(event: "error", listener: (err: Error) => void): void;
  }

  export interface ServerAddress {
    port: number;
    address: string;
    family: string;
  }

  export interface ServerConfig {
    hostKeys: (string | Buffer)[];
    algorithms?: { serverHostKey?: string[] };
  }

  export class Server {
    constructor(config: ServerConfig, onConnection: (client: ServerConnection) => void);
    listen(port: number, host: string, callback: () => void): void;
    address(): ServerAddress;
    close(): void;
  }
}
