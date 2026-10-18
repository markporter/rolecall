// Ambient type subset for `express` (^5.2.1) — no @types package ships with it.
//
// This keeps `bunx tsc --noEmit` happy for src/orchestrator WITHOUT adding a new
// dependency (constraint: npm deps unchanged). It covers only the surface this
// codebase uses; runtime behaviour is provided by the installed express JS.
declare module "express" {
  interface NextFunction {
    (...args: unknown[]): unknown;
  }

  interface Request {
    method: string;
    originalUrl: string;
    url: string;
    path: string;
    params: Record<string, string>;
    query: unknown;
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
  }

  interface Response {
    status(code: number): Response;
    json(body?: unknown): void;
    send(body?: unknown): void;
    set(field: string, value: string): Response;
  }

  type Handler = (req: Request, res: Response, next?: NextFunction) => unknown;
  type ErrorRequestHandler = (
    err: unknown,
    req: Request,
    res: Response,
    next?: NextFunction,
  ) => unknown;

  interface Application {
    get(path: string, handler: Handler): this;
    post(path: string, handler: Handler): this;
    put(path: string, handler: Handler): this;
    delete(path: string, handler: Handler): this;
    use(...middleware: Array<unknown>): this;
    listen(port?: number, hostname?: string, callback?: () => void): object;
    listen(port?: number, callback?: () => void): object;
    close(callback?: () => void): void;
  }

  function express(): Application;

  namespace express {
    function json(options?: unknown): unknown;
    function text(options?: unknown): unknown;
    /** Static-file middleware factory used by src/orchestrator/static-ui.ts. */
    function static(root: string, options?: unknown): unknown;
  }

  export = express;
}
