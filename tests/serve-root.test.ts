import { expect, test } from "bun:test";
import { serveRootProblem } from "../src/orchestrator/serve";

test("serve refuses root unless explicitly allowed", () => {
  expect(serveRootProblem(0, undefined)).toContain("refusing");
  expect(serveRootProblem(0, "1")).toBeUndefined();
  expect(serveRootProblem(1000, undefined)).toBeUndefined();
});
