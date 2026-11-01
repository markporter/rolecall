// Test isolation default: product default is `auto`, but unit/integration tests
// must not depend on bwrap/Docker being installed. Individual sandbox tests
// pass an explicit backend.
process.env["ROLECALL_ISOLATION"] ??= "none";
