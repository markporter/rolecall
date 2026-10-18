// Module registry surface for the plugin SDK (Todo 15).
//
// Single import point (`src/modules`) for plugin authors. Re-exports the executor
// registry (registerModule/getModule/listModules) — the single source of truth
// lives in src/executor/module and is NOT duplicated here — plus the dynamic
// loader. Keeps the Module contract types in one place.

export {
  registerModule,
  getModule,
  listModules,
  type Module,
  type ModuleContext,
  type ModuleResult,
} from "../executor/module";

export { loadModuleFromFile } from "./loader";
