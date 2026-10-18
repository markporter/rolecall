// A project-private module written with the idempotency helper.
// Modules are TS functions; there is no declarative module spec.
import { resource } from "rolecall/modules";

export default resource({
  describe: (args: { path: string; state: string }) => ({
    path: args.path,
    state: args.state,
  }),
  converge: (args: { path: string; state: string }) => ({
    changed: true,
    path: args.path,
    state: args.state,
  }),
});
