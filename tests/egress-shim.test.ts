import { afterEach, expect, test } from "bun:test";
import { createServer, connect } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startEgressShim } from "../src/isolation/egress-shim";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});

test("shim forwards TCP to a Unix socket and back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rolecall-shim-"));
  const socketPath = join(dir, "egress.sock");
  const echo = createServer((sock) => sock.on("data", (b) => sock.write(`echo:${b.toString()}`)));
  await new Promise<void>((resolve) => echo.listen(socketPath, resolve));
  cleanup.push(() => new Promise<void>((resolve) => echo.close(() => resolve())));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

  const shim = await startEgressShim({ socketPath });
  cleanup.push(() => shim.close());
  const [host, port] = shim.address.split(":");

  const result = await new Promise<string>((resolve, reject) => {
    const c = connect({ host: host!, port: Number(port) });
    let out = "";
    c.on("connect", () => c.write("hello"));
    c.on("data", (b) => {
      out += b.toString();
      c.destroy();
      resolve(out);
    });
    c.on("error", reject);
  });
  expect(result).toBe("echo:hello");
});
