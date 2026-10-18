// Shared terminal HTTP middleware for orchestrator route modules (Todo 21).
//
// Extracted from src/orchestrator/routes.ts so BOTH the resource router and the
// webhook router compile the SAME 404/405/error behaviour without duplication.
// Pure helpers operate on a local path->methods registry passed by the caller.

/** Normalize a raw URL/path: strip querystring, drop trailing slash (except root). */
export function normalizePath(url: string): string {
  let p = url.split("?")[0] ?? "";
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/";
}

/** Known path -> 405 (allowed combos already handled above), else 404. Caller-owned registry. */
export function makeNotFoundHandler(ROUTES: Map<string, Set<string>>): (req: { url: string; method: string }, res: { status(code: number): any; json(body?: unknown): void }) => void {
  const compiled = [...ROUTES.entries()].map(([key, methods]) => ({ key, re: compilePattern(key), methods }));
  return (req, res): void => {
    const norm = normalizePath(req.url);
    // Allowed method+path combos were already handled above, so reaching here
    // against a KNOWN path always means an ALLOWED-vs-disallowed mismatch -> 405.
    for (const { key, re } of compiled) {
      if (re.test(norm)) {
        res.status(405).json({ error: `method ${req.method} not allowed on ${key}` });
        return;
      }
    }
    res.status(404).json({ error: "not found" });
  };
}

export function compilePattern(key: string): RegExp {
  const parts = key.split("/").filter(Boolean);
  const src = "/" + parts.map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))).join("/");
  return new RegExp(`^${src}$`);
}

/** Clean JSON errors — never leak stack traces or secrets. Last-resort express error handler. */
export function makeErrorHandler(): (err: unknown, _req: { headersSent?: boolean }, res: { headersSent?: boolean; status(code: number): any; json(body?: unknown): void }) => void {
  return (err, _req, res): void => {
    if (res.headersSent) return;
    const parseFailed = String((err as { type?: string })?.type)?.includes("entity.parse.failed");
    const known = (err as { status?: number })?.status;
    const code = parseFailed ? 400 : typeof known === "number" ? Math.min(Math.max(known, 400), 599) : 500;
    const message = code >= 500 ? "internal server error" : err instanceof Error ? err.message : String(err);
    res.status(code).json({ error: message });
  };
}
