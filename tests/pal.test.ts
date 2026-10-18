// PAL smoke tests — exercise each Bun surface THROUGH the getPAL() abstraction
// (never call Bun.* directly). Bun-only MVP: runs under `bun test` only.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getPAL } from "../src/pal";

const pal = getPAL();

test("sqlite open/insert/select through abstraction", () => {
  const db = pal.sqlite.open(":memory:");
  try {
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    db.run("INSERT INTO t (name) VALUES (?)", "rolecall");
    const rows = db
      .query<{ id: number; name: string }>("SELECT id, name FROM t WHERE name = ?")
      .all("rolecall");
    expect(rows.length).toBe(1);
    expect(rows[0]?.name).toBe("rolecall");
  } finally {
    db.close();
  }
});

test("crypto sha256 deterministic and matches known digest", async () => {
  const a = await pal.crypto.sha256Hex("hello");
  const b = await pal.crypto.sha256Hex("hello");
  expect(a).toBe(b);
  expect(a).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
});

test("dns lookup resolves a host", async () => {
  const addrs = await pal.dns.lookup("localhost");
  expect(addrs.length).toBeGreaterThan(0);
  expect(addrs.some((a) => a === "127.0.0.1" || a === "::1")).toBe(true);
});

test("spawn runs echo", async () => {
  const r = await pal.spawn.spawn(["echo", "hello"]);
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("hello");
});

test("http server factory serves and stops", async () => {
  const handle = await pal.http.serve({
    port: 39517,
    fetch: () => new Response("pong"),
  });
  try {
    const res = await fetch(handle.url);
    expect(await res.text()).toBe("pong");
  } finally {
    await handle.stop();
  }
});

test("file IO read/write/exists through abstraction", async () => {
  const path = join(tmpdir(), `rolecall-pal-${Date.now()}.txt`);
  await pal.file.writeText(path, "rolecall");
  expect(await pal.file.exists(path)).toBe(true);
  expect(await pal.file.readText(path)).toBe("rolecall");
});

test("observability shim does not throw", () => {
  expect(() => pal.observability.log("info", "x", { a: 1 })).not.toThrow();
  expect(() => pal.observability.metric("m", 1)).not.toThrow();
});

test("ssh surface is wired", () => {
  expect(typeof pal.ssh.connect).toBe("function");
});
