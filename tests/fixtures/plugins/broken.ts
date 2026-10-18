// Sample malformed plugin — its run() throws, used to verify the executor
// surfaces a readable error and fails the task cleanly (tests/modules.test.ts).
import type { Module } from "../../../src/executor/module";

const broken: Module = {
  name: "broken",
  async run() {
    throw new Error("intentional failure in broken module");
  },
};

export default broken;
