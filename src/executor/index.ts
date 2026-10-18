// Executor barrel — public surface for the declarative task engine (Todo 12).
export {
  registerModule,
  getModule,
  listModules,
  type Module,
  type ModuleContext,
  type ModuleResult,
} from "./module";
export {
  type ExecOptions,
  type PlaybookResult,
  type TaskOutcome,
  type HandlerOutcome,
  type IterationOutcome,
  type AdHocTask,
  type TemplateVars,
  renderArgs,
  evalWhen,
  expandLoop,
  createNoopConnection,
} from "./context";
export {
  HandlerCollector,
  findHandlers,
  registerTriggerStub,
  listRegisteredTriggers,
  type TriggerRegistration,
} from "./handlers";
export { runPlaybook, runTask } from "./engine";
export {
  rollbackTransaction,
  computeResumeSkipSet,
  parseResumeArg,
  toAppliedDelta,
  type AnyModule,
  type AppliedDelta,
  type UndoOutcome,
  type PendingRollbackEntry,
  type RollbackResult,
  type RollbackInput,
  type ResumeSpec,
} from "./tx";
export {
  isUndoableModule,
  type UndoableModule,
} from "./module";
