// Test isolation default.
//
// Product behavior is default-on `auto`. Linux CI installs bubblewrap, so the
// suite exercises the real namespace backend there. macOS/Windows runners do
// not guarantee bwrap or a Docker daemon, so they keep the explicit `none`
// fallback; the dedicated Docker CI job sets ROLECALL_ISOLATION=docker and
// ROLECALL_REQUIRE_DOCKER=1.
if (process.env["ROLECALL_ISOLATION"] === undefined) {
  process.env["ROLECALL_ISOLATION"] = process.platform === "linux" ? "auto" : "none";
}
