import { expect, test } from "bun:test";
import { pathToFileURL } from "node:url";
import { FsProjectSource } from "../src/vfs/fs-project-source";

test("FsProjectSource exposes a file:// VFS URI", () => {
  const source = new FsProjectSource("/tmp/a b");
  expect(source.uri).toBe(pathToFileURL("/tmp/a b").href);
  expect(source.uri.startsWith("file:///")).toBe(true);
  expect(source.uri).toContain("a%20b");
});
