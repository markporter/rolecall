// copy templating (merged from config_write, Todo 24a): offline integration
// proving byte-exact, repeatable writes over a LOCAL connection (zero SSH/network)
// against a temp dir, including on-host eta/jinja rendering. Mirrors the runner
// pattern: `createConnection({kind:"local",shell:"/bin/bash"})`.

import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { getModule, runTask } from "../src/executor";
import { createConnection } from "../src/transport";
import { copyModule } from "../src/modules/builtins/copy";
import { registerAllModules } from "../src/modules/builtins";
import type { ModuleContext } from "../src/executor/module";
import type { NormalizedInventory } from "../src/config/schema";

// Register builtins so `getModule`/`runTask` resolve `copy` in this file's isolation.
registerAllModules();

const here = () => join(tmpdir(), `rolecall-copy-${randomUUID()}`);

/** A fresh LocalConnection per invocation; copy owns its connect/disconnect. */
function connFor(): (host: string) => ReturnType<typeof createConnection> {
  return (host: string) => createConnection({ kind: "local", host, user: "ci", shell: "/bin/bash" });
}

/** Build a bare ModuleContext driving copyModule.run directly (full control of args). */
function ctx(args: Record<string, unknown>, overrides: Partial<ModuleContext> = {}): ModuleContext {
  const c = connFor()(overrides.host ?? "h1");
  return {
    host: overrides.host ?? "h1",
    connection: c,
    args,
    vars: overrides.vars ?? {},
    facts: overrides.facts ?? {},
    registered: {},
    item: overrides.item,
    index: overrides.index,
  } as ModuleContext;
}

function inventory(vars: Record<string, unknown>): NormalizedInventory {
  return { groups: { all: { hosts: ["h1"], vars } } } as unknown as NormalizedInventory;
}

async function readBytes(path: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(path).arrayBuffer());
}

/** Register once; each test uses a unique path so registrations never collide. */
test("module registers with the executor", () => {
  expect(getModule("copy")).toBeDefined();
});

// first-run writes file AND reports changed=true; second identical run NOOPs.
test("(1) first-run CHANGED then identical NOOP", async () => {
  const p = here();
  const content = "line one\nline two {{placeholder}}\ttabs preserved";
  const r1 = await copyModule.run(ctx({ dest: p, content }));
  expect(r1.changed).toBe(true);
  expect(r1.failed).toBeUndefined();
  expect(existsSync(p)).toBe(true);
  expect(Buffer.from(await readBytes(p)).toString("utf8")).toBe(content);

  const r2 = await copyModule.run(ctx({ dest: p, content }));
  expect(r2.changed).toBe(false);
  expect(r2.msg).toContain("unchanged");
  expect(Buffer.from(await readBytes(p)).toString("utf8")).toBe(content);
});

// changing the desired content re-triggers a write (idempotency holds across versions).
test("(2) modified desired re-changes after an unchanged rerun", async () => {
  const p = here();
  const base = "version-A";
  expect((await copyModule.run(ctx({ dest: p, content: base }))).changed).toBe(true);
  expect((await copyModule.run(ctx({ dest: p, content: base }))).changed).toBe(false);
  const next = await copyModule.run(ctx({ dest: p, content: "version-B" }));
  expect(next.changed).toBe(true);
  expect(Buffer.from(await readBytes(p)).toString("utf8")).toBe("version-B");
});

// --force skips compare and always writes + changed.
test("(3) --force bypasses compare and always writes+changed", async () => {
  const p = here();
  const same = "identical-bytes";
  await copyModule.run(ctx({ dest: p, content: same }));
  // Matching content would be a NOOP without force; force must still write+report changed.
  const forcedMatch = await copyModule.run(ctx({ dest: p, content: same, _force: true }));
  expect(forcedMatch.changed).toBe(true);
  expect(Buffer.from(await readBytes(p)).toString("utf8")).toBe(same);

  const newPath = here();
  const forcedNew = await copyModule.run(ctx({ dest: newPath, content: "fresh-forced", _force: true }));
  expect(forcedNew.changed).toBe(true);
  expect(Buffer.from(await readBytes(newPath)).toString("utf8")).toBe("fresh-forced");
});

// --check reports WOULD_CHANGE without writing.
test("(4) --check is dry-run: WOULD_CHANGE, nothing written", async () => {
  const p = here();
  const res = await copyModule.run(ctx({ dest: p, content: "not-yet-on-disk", _check: true }));
  expect(res.changed).toBe(false);
  expect(res.failed).toBeUndefined();
  expect(existsSync(p)).toBe(false);

  // A real apply now creates it; a subsequent check on matching data NOOPs.
  const applied = await copyModule.run(ctx({ dest: p, content: "not-yet-on-disk" }));
  expect(applied.changed).toBe(true);
  const later = await copyModule.run(ctx({ dest: p, content: "not-yet-on-disk", _check: true }));
  expect(later.changed).toBe(false);
});

// missing path fails cleanly.
test("(5) empty path fails with 'dest required'", async () => {
  const res = await copyModule.run(ctx({ dest: "" }));
  expect(res.changed).toBe(false);
  expect(res.failed).toBe(true);
  expect(String(res.msg ?? "")).toContain("'dest'");
});

// fast-mode: runner auto-renders the STRING arg via eta before dispatch.
test("(6) runner renders fast-mode (eta) string content before module sees it", async () => {
  const p = here();
  const first = await runTask(
    { name: "write", module: "copy", args: { dest: p, content: { $template: "cfg for <%= play.host %>" } }, hosts: "h1" },
    inventory({}),
    { connectionFor: connFor() },
  );
  const iter = first.hosts["h1"]![0]!.iterations[0]!;
  expect(iter.changed).toBe(true);
  // Eta uses <% %> delimiters; if unrendered the literal token would remain.
  expect(Buffer.from(await readBytes(p)).toString("utf8")).toBe("cfg for h1");

  const second = await runTask(
    { name: "rerun", module: "copy", args: { dest: p, content: { $template: "cfg for <%= play.host %>" } }, hosts: "h1" },
    inventory({}),
    { connectionFor: connFor() },
  );
  expect(second.hosts["h1"]![0]!.iterations[0]!.changed).toBe(false);
});

// jinja content object renders LiquidJS {%if%}/{%else%} syntax (module-rendered).
test("(7) content renders LiquidJS control flow via renderJinja", async () => {
  const off = here();
  const on = here();
  const tpl = "{% if enabled %}on{% else %}off{% endif %}";

  const rOff = await runTask(
    { name: "t-off", module: "copy", args: { dest: off, content: { template: tpl, engine: "jinja" } }, hosts: "h1" },
    inventory({ enabled: false }),
    { connectionFor: connFor() },
  );
  expect(rOff.hosts["h1"]![0]!.iterations[0]!.changed).toBe(true);
  expect(Buffer.from(await readBytes(off)).toString("utf8")).toBe("off");

  const rOn = await runTask(
    { name: "t-on", module: "copy", args: { dest: on, content: { template: tpl, engine: "jinja" } }, hosts: "h1" },
    inventory({ enabled: true }),
    { connectionFor: connFor() },
  );
  expect(rOn.hosts["h1"]![0]!.iterations[0]!.changed).toBe(true);
  expect(Buffer.from(await readBytes(on)).toString("utf8")).toBe("on");

  // Same template + same vars -> idempotent NOOP even though rendered through jinja.
  const again = await runTask(
    { name: "t-again", module: "copy", args: { dest: off, content: { template: tpl, engine: "jinja" } }, hosts: "h1" },
    inventory({ enabled: false }),
    { connectionFor: connFor() },
  );
  expect(again.hosts["h1"]![0]!.iterations[0]!.changed).toBe(false);
});

// arbitrary bytes survive base64 round-trip byte-for-byte.
test("(8) binary / special-bytes content writes and re-compares exactly", async () => {
  const p = here();
  const desired = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x0a, 0x09, 0xc3, 0xa9, 0x2e]).toString("utf8");
  const res = await copyModule.run(ctx({ dest: p, content: desired }));
  expect(res.changed).toBe(true);
  expect(Buffer.from(await readBytes(p))).toEqual(Buffer.from(desired, "utf8"));
  expect((await copyModule.run(ctx({ dest: p, content: desired }))).changed).toBe(false);
});
