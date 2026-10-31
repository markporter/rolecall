import { describe, expect, test } from "bun:test";
import type { ModuleContext } from "../src/executor/module";
import { createConnection } from "../src/transport";
import { jsonQueryModule, meta } from "../src/modules/builtins/json_query";

const connection = createConnection({ kind: "local", host: "h1", user: "tester" });

function ctx(args: Record<string, unknown>): ModuleContext {
  return { host: "h1", connection, args, vars: {}, facts: {}, reg: {} };
}

async function run(data: unknown, query: string) {
  return jsonQueryModule.run(ctx({ data, query }));
}

const users = {
  users: [
    { name: "alice", age: 28 },
    { name: "bob", age: 35 },
    { name: "carol", age: 41 },
  ],
  items: [{ name: "first" }, { name: "second" }],
};

describe("json_query JMESPath", () => {
  test("field access", async () => {
    const res = await run({ foo: { bar: "baz" } }, "foo.bar");
    expect(res.failed).toBeUndefined();
    expect(res.data?.json_query).toBe("baz");
  });

  test("array index", async () => {
    const res = await run(users, "items[1].name");
    expect(res.data?.json_query).toBe("second");
  });

  test("filter projection", async () => {
    const res = await run(users, "users[?age > `30`].name");
    expect(res.data?.json_query).toEqual(["bob", "carol"]);
  });

  test("pipe expression", async () => {
    const res = await run(users, "users[?age > `30`] | [0].name");
    expect(res.data?.json_query).toBe("bob");
  });

  test("length function", async () => {
    const res = await run(users, "length(items)");
    expect(res.data?.json_query).toBe(2);
  });

  test("wildcard projection", async () => {
    const res = await run(users, "users[*].name");
    expect(res.data?.json_query).toEqual(["alice", "bob", "carol"]);
  });

  test("JSON-pointer fallback stays backward compatible", async () => {
    const res = await run(users, "/items/0/name");
    expect(res.failed).toBeUndefined();
    expect(res.data?.json_query).toBe("first");
  });

  test("invalid JMESPath fails with a message instead of throwing", async () => {
    const res = await run(users, "users[");
    expect(res.failed).toBe(true);
    expect(res.msg?.startsWith("json_query: ")).toBe(true);
  });

  test("metadata documents JMESPath and the pointer fallback", () => {
    expect(meta.description).toContain("JMESPath");
    expect(meta.args.query.description).toContain("JMESPath");
    expect(meta.args.query.description).toContain("/items/0/name");
    expect(meta.notes).not.toContain("does not embed JMESPath");
    expect(meta.examples.every((example) => !example.includes("{ "))).toBe(true);
  });
});
