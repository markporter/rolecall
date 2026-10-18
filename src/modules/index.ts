// Modules SDK barrel (Todo 15 + Todo 27).
//
// Public surface for plugin authors and the executor. Re-exports the registry
// (which includes the dynamic loader), the idempotency-by-default `resource`
// helper, module discovery (`searchModules`), and the built-in modules.

export * from "./registry";
export * from "./search";
export * from "./resource";
export * from "./scanner";
export * from "./resolver";
export {
  registerAllModules,
  httpModule,
  configEditModule,
  blockinfileModule,
  lineinfileModule,
  sqlModule,
  shellModule,
  serviceModule,
  pkgModule,
  fileModule,
  statModule,
  copyModule,
  userModule,
  groupModule,
  getUrlModule,
  gitModule,
  replaceModule,
  commandModule,
  scriptModule,
  rawModule,
  failModule,
  setFactModule,
  addHostModule,
  waitForModule,
} from "./builtins";
