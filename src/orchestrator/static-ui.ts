// Pluggable static-UI serving for the RoleCall orchestrator (Todo 23).
//
// Three modes selected purely by ServerOptions.uiDist, mounted BEFORE mountRoutes so
// they shadow GET "/":
//   * unset      -> nothing installed; GET "/" keeps the router's health JSON ("zero build").
//   * set+exists -> express.static(dir) serves index.html plus any nested asset.
//   * set+missing-> deterministic plain-text guidance over HTTP 200 (never throws).
// A vanilla embedded SPA backs an existing dist folder that lacks index.html, so GET "/"
// always renders something sensible.
//
// Cross-runtime invariant: every FILE-CONTENT read is owned by installed express.static (which
// drives node:fs internally); this module itself touches disk ONLY through a bare existsSync()
// metadata probe for its existence/index gate plus path resolution — never a content read, and
// never any Bun-specific API. Behaviour is therefore identical under Bun and Node (ROLECALL_RUNTIME
// = node parity holds): path resolution and existsSync behave the same on both runtimes.

import path from "node:path";
import { existsSync } from "node:fs";
import express from "express";

type Responder = { status(code: number): Responder; type(t: string): Responder; send(body?: unknown): void };
type Handler = (req: { params: Record<string, string>; url: string }, res: Responder) => void;

interface StaticApp {
  get(path: string, handler: Handler): unknown;
  use(...handlers: unknown[]): unknown;
}

const GUIDANCE_HINT = "Point config ui.dist at a folder containing index.html.";

/** Deterministic guidance returned when ui.dist points at a directory that does not exist. */
export function guidanceMessage(root: string): string {
  return `RoleCall UI: ui.dist "${root}" not found. ${GUIDANCE_HINT}`;
}

/** Embedded framework-free SPA referencing implemented REST endpoints (no live fetches). */
export const DEFAULT_INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>RoleCall Orchestrator</title>
<style>
  body{font-family:system-ui,sans-serif;margin:2rem;color:#1b1f23;background:#fafafa}
  h1{margin-bottom:.25rem}.sub{color:#57606a;margin-top:0}
  code{background:#eaecef;padding:.1rem .35rem;border-radius:4px}
  ul{line-height:1.9}
</style>
</head>
<body>
<h1>RoleCall Orchestrator</h1>
<p class="sub">Config management &amp; orchestration. Serve this folder as <code>ui.dist</code>.</p>
<h2>REST endpoints</h2>
<ul>
  <li><code>POST /run</code> &mdash; dispatch a run; body {"type":"playbook|adhoc|nonIdempotent", ...}</li>
  <li><code>GET /runs/:id/status</code> &mdash; poll run outcome</li>
  <li><code>GET/POST /projects</code>, <code>PUT/DELETE /projects/:id</code></li>
  <li><code>GET/POST /schedules</code>, <code>DELETE /schedules/:id</code></li>
  <li><code>POST /webhook</code>, <code>POST /api/run</code> &mdash; external triggers</li>
  <li><code>GET /health</code>, <code>GET /ping</code>, <code>GET /status</code></li>
</ul>
</body>
</html>`;

function embeddedHandler(_: { params: Record<string, string>; url: string }, res: Responder): void {
  res.status(200).type("text/html").send(DEFAULT_INDEX_HTML);
}

/** True once uiDist resolves to a real directory; never throws (bad input degrades to false). */
function dirExists(dist: string): boolean {
  try {
    return existsSync(dist);
  } catch {
    return false;
  }
}

/** Install pluggable static UI before mountRoutes so it shadows GET "/". Never throws. */
export function installStaticUi(app: object, uiDist?: string): void {
  if (!uiDist) return; // zero-build mode: leave GET "/" to the router's health JSON.

  const api = app as unknown as StaticApp;
  const root = path.resolve(uiDist);

  if (!dirExists(root)) {
    const hint = guidanceMessage(root);
    api.get("/", (_req: { params: Record<string, string>; url: string }, res: Responder): void => {
      res.status(200).type("text/plain").send(hint);
    });
    return;
  }

  const hasIndex = existsSync(`${root}/index.html`);
  if (hasIndex) {
    api.use(express.static(root));
    return;
  }

  // Existing dist folder with no index.html: fall back to the embedded default SPA.
  api.get("/", embeddedHandler);
}
