// Bun-native SSH PAL — thin wrapper around ssh2 (pure-JS, works on Bun when
// installed with --omit=optional; see .omo/notepads/rolecall/issues.md).
import { Client } from "ssh2";
import type { SshPAL, SshConnection, SshConnectionOptions, SshExecResult } from "./types";

class BunSshConnection implements SshConnection {
  #client: Client;

  constructor(client: Client) {
    this.#client = client;
  }

  exec(command: string): Promise<SshExecResult> {
    return new Promise<SshExecResult>((resolve, reject) => {
      this.#client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        let stdout = "";
        let stderr = "";
        stream.on("data", (d: Buffer) => {
          stdout += d.toString();
        });
        stream.stderr.on("data", (d: Buffer) => {
          stderr += d.toString();
        });
        stream.on("close", (code: number | null) => {
          resolve({ exitCode: code, stdout, stderr });
        });
      });
    });
  }

  close(): void {
    this.#client.end();
  }
}

export class BunSshPAL implements SshPAL {
  async connect(options: SshConnectionOptions): Promise<SshConnection> {
    const client = new Client();
    await new Promise<void>((resolve, reject) => {
      client.on("ready", () => resolve());
      client.on("error", (e) => reject(e));
      client.connect({
        host: options.host,
        port: options.port ?? 22,
        username: options.username,
        password: options.password,
        privateKey: options.privateKey,
        passphrase: options.passphrase,
      });
    });
    return new BunSshConnection(client);
  }
}
