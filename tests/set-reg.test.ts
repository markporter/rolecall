import { expect, test } from "bun:test";
import type { NormalizedInventory, NormalizedPlaybook } from "../src/config/schema";
import { runPlaybook } from "../src/executor";
import { registerAllModules } from "../src/modules/builtins";

// Ensure `set_reg` (and the downstream `debug`) are in the dispatch registry.
registerAllModules();

function inventory(hosts: string[]): NormalizedInventory {
  return { groups: { all: { hosts, vars: {} } } };
}

test("set_reg writes runtime values into the reg namespace, readable downstream via $var: reg.*", async () => {
  const pb: NormalizedPlaybook = {
    hosts: ["all"],
    tasks: [
      { name: "stash", module: "set_reg", args: { token: "secret" }, notify: [] },
      {
        name: "read",
        module: "debug",
        args: { msg: { $var: "reg.token" } },
        register: "cap",
        notify: [],
      },
    ],
    vars: {},
  };

  const result = await runPlaybook([pb], inventory(["h1"]));

  // The live write is persisted on the play's `reg` store.
  expect(result.registered["h1"]?.["token"]).toBe("secret");

  // A downstream task resolved `$var: reg.token` to the value set by `set_reg`.
  // `register:` stores each iteration (with the module's `data`), not the raw `data`.
  const cap = result.registered["h1"]?.["cap"] as
    | { results?: Array<{ data?: { args?: { msg?: unknown } } }>; failed?: boolean }
    | undefined;
  expect(cap?.results?.[0]?.data?.args?.msg).toBe("secret");
  expect(cap?.failed).toBe(false);
});
