// Module loader — dynamic, build-step-free plugin loading (Todo 15).
//
// `loadModuleFromFile(path)` loads a user-authored module from disk and registers
// it via the existing executor registry (`registerModule`), so it is immediately
// dispatchable by `runTask`/`runPlaybook` under its `name`.
//
// Supported sources:
//   .ts / .mts  -> imported directly. Bun's loader transpiles TypeScript on the
//                  fly, so NO build step is needed and relative imports inside the
//                  plugin resolve against its own directory.
//   .js / .mjs  -> imported directly (no transpile; runs anywhere, including Node).
//
// CAVEAT (TS-only-under-Bun): the .ts/.mts path relies on Bun's TypeScript loader,
// so it works under `bun` but NOT under plain Node. For a Node-portable plugin,
// author it as .js/.mjs — the .js fallback needs no transpile and runs anywhere.
//
// Accepted default-export shapes (see `toModule`):
//   1. a Module object:            `export default { name, run }`
//   2. a factory object:           `export default { name, factory }` (factory()->Module)
//   3. a class with `run`:         `export default class { name; run() {} }`
//      (also a bare factory fn returning a Module is accepted)

import { extname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { registerModule, type Module } from "../executor/module";

const TS_EXT = new Set([".ts", ".mts"]);
const JS_EXT = new Set([".js", ".mjs"]);

/** Narrow an unknown value to the Module contract (name:string + run:function). */
function isModuleLike(v: unknown): v is Module {
  if (typeof v !== "object" || v === null) return false;
  const rec = v as Record<string, unknown>;
  return typeof rec["name"] === "string" && typeof rec["run"] === "function";
}

/**
 * Normalize a loaded module namespace/default export into a registered Module.
 * Throws a readable error when the export is none of the accepted shapes.
 */
async function toModule(value: unknown, filePath: string): Promise<Module> {
  const exp =
    value !== null &&
    typeof value === "object" &&
    "default" in (value as Record<string, unknown>)
      ? (value as Record<string, unknown>)["default"]
      : value;

  // 1. Already a Module object.
  if (isModuleLike(exp)) return exp;

  // 2. { name, factory } form — factory produces the Module.
  if (
    exp !== null &&
    typeof exp === "object" &&
    typeof (exp as Record<string, unknown>)["factory"] === "function"
  ) {
    const made = await (
      (exp as Record<string, unknown>)["factory"] as () =>
        | Module
        | Promise<Module>
    )();
    if (!isModuleLike(made)) {
      throw new Error(`${filePath}: factory() did not return a Module`);
    }
    return made;
  }

  // 3. class with `run` (instantiate) OR bare factory function (call).
  if (typeof exp === "function") {
    const proto = (exp as { prototype?: { run?: unknown } }).prototype;
    const candidate =
      proto !== undefined && typeof proto.run === "function"
        ? new (exp as new () => Module)()
        : await (exp as () => Module | Promise<Module>)();
    if (!isModuleLike(candidate)) {
      throw new Error(`${filePath}: produced value is not a Module`);
    }
    return candidate;
  }

  throw new Error(
    `${filePath}: default export is not a Module, {name,factory}, or a class with run()`,
  );
}

/** Import a .ts/.mts source directly — Bun transpiles TypeScript on the fly. */
async function importTs(abs: string): Promise<unknown> {
  return import(pathToFileURL(abs).href);
}

/**
 * Import a module source file and normalize its default export into a {@link Module}
 * WITHOUT registering it. Resolves relative paths against `process.cwd()`. Throws a
 * readable error if the file cannot be loaded or its export is not a valid Module shape.
 * @param filePath Path to the module (.ts/.mts/.js/.mjs); resolved against cwd.
 * @returns The normalized Module instance (not yet registered).
 */
export async function importModuleObject(filePath: string): Promise<Module> {
  const abs = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
  const ext = extname(abs).toLowerCase();
  let mod: unknown;
  if (JS_EXT.has(ext)) {
    mod = await import(pathToFileURL(abs).href);
  } else if (TS_EXT.has(ext)) {
    mod = await importTs(abs);
  } else {
    throw new Error(`Unsupported module file extension: ${ext} (${abs})`);
  }
  return toModule(mod, abs);
}

/**
 * Load a user-authored module file and register it under its `name` (via the
 * existing executor registry). Thin wrapper over {@link importModuleObject} +
 * `registerModule`, preserving the `plugin register` behavior.
 * @param filePath Path to the module (.ts/.mts/.js/.mjs); resolved against cwd.
 * @returns The registered Module instance (also reachable later via getModule(name)).
 */

/** @summary Load a user-authored module file (.ts/.mts/.js/.mjs) from disk, normalize its default export into a Module via `toModule`, register it under its name, and return it. @param filePath Path to the module, resolved against cwd. @returns The registered Module instance (also reachable later via getModule(name)). Throws a readable error on load failure or invalid export shape. */
export async function loadModuleFromFile(filePath: string): Promise<Module> {
  const module = await importModuleObject(filePath);
  registerModule(module);
  return module;
}
