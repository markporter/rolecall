// Isolation types shared by the backend seam, probe/doctor, and LocalConnection.

/** Which isolation mechanism to use. `auto` picks namespace → docker → none. */
export type IsolationBackendName = "auto" | "namespace" | "docker" | "none";

/** Network policy for sandboxed local execution. */
export type IsolationNetworkMode = "off" | "on" | "module";

/** One explicitly approved host path mount. */
export interface IsolationMount {
  /** Canonical absolute source path. */
  source: string;
  /** Absolute path inside the sandbox. */
  target: string;
  /** Read-only unless explicitly rw. */
  mode: "ro" | "rw";
}

export interface IsolationOptions {
  /** Requested backend (default auto). */
  backend?: IsolationBackendName;
  /** Network policy (default off for untrusted shell exec). */
  network?: IsolationNetworkMode;
  /** Project root bind-mounted read-write into the sandbox. */
  projectRoot?: string;
  /** Docker image override. Use a digest-pinned image in production. */
  image?: string;
  /** Extra approved mounts. */
  mounts?: IsolationMount[];
  /** Destination whitelist rules (module-facing checks and, later, the shell broker). */
  egress?: import("./egress").EgressRule[];
  /** Probe/exec timeout in ms. */
  timeoutMs?: number;
}

export interface IsolationProbe {
  platform: string;
  requested: IsolationBackendName;
  /** Backend that auto/explicit selection resolved to. */
  selected: IsolationBackendName;
  bwrap: boolean;
  unshare: boolean;
  /** bwrap can create an unprivileged user namespace. */
  userns: boolean;
  dockerCli: boolean;
  dockerDaemon: boolean;
  dockerRootless?: boolean;
  image: string;
  warnings: string[];
  reasons: string[];
}

export interface IsolationCommand {
  file: string;
  args: string[];
  /** Environment passed explicitly to the child; never the full parent env. */
  env?: Record<string, string>;
}

/** Raised when the requested isolation backend is unavailable; the run must fail closed. */
export class IsolationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IsolationUnavailableError";
  }
}
