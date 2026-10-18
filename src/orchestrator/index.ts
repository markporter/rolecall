// Orchestrator barrel — unified dual-mode entrypoint public surface (Task 18).
//
// Exported so bin/rolecall.js / src/cli/index.ts can boot the HTTP server via
// `rolecall --serve`, and so tests can construct a server directly against live sims.

export { createServer, startServe } from "./serve";
export type { ServerHandle } from "./serve";
export { Engine } from "./engine";
export { mountRoutes } from "./routes";
export type { RouteContext } from "./routes";
export { mountWebhooks } from "./webhooks";
export type { WebhookRouteContext } from "./webhooks";
export { validateJobBody, isActionType, VALID_JOB_TYPES } from "./job-validation";
export type { ValidationResult, ValidationSuccess, ValidationError } from "./job-validation";
export { installSignalHandlers } from "./shutdown";
export type { ShutdownOptions } from "./shutdown";
export { CronScheduler } from "./scheduler";
export type { CronSchedulerOptions, Enqueuer } from "./scheduler";
export * from "./cron";
export * from "./types";
