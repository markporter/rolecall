// Sample user-authored .js plugin (Node-portable fallback) — tests/modules.test.ts.
// Plain JS: no transpile needed, runs under Bun or Node.
const echo = {
  name: "echojs",
  async run(ctx) {
    const msg = String(ctx.args.msg ?? "");
    return { changed: false, stdout: msg, msg: `echoed ${msg}` };
  },
};

export default echo;
