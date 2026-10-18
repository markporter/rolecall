// Offline simulated-target FARM — hosts all three reusable sims (SSH, HTTP,
// network device) plus an aggregate health/control endpoint in ONE long-running
// Bun process. Used by scripts/sims/up.sh|down.sh|health.sh.
//
// NOTE (offline deviation): the original plan invoked a containerized sshd via
// docker/lxc. THIS ENVIRONMENT HAS NO docker/podman/lxc, so every target runs
// IN-PROCESS via the pure-JS ssh2 Server + Bun.serve factories below — zero new
// dependencies, fully offline. The lifecycle scripts detect a container runtime
// and refuse-to-run the docker path rather than depend on it.
import { createNetworkDeviceSim, createHttpSim, createSshSim } from "./sims";
import type {
  HttpSimHandle,
  NetworkDeviceSimHandle,
  SshSimHandle,
} from "./sims";

const HOST = "127.0.0.1";
const PORTS = {
  ssh: 39521,
  http: 39522,
  net: 39523,
  control: 39530,
};

// Scripted exec responses keyed on command text (see learnings.md: info.command
// is a Buffer at runtime -> .toString()). Unknown commands fall back to "".
const SSH_HANDLERS = {
  "uname -srm": "Linux 5.15.0-123-generic x86_64\n",
  "whoami": "root\n",
  "echo hello": "hello\n",
};

interface FarmInfo {
  simFarm: true;
  /** Literal runtime note for tooling/grants. */
  runtime: string;
  detectedRuntime: string;
  startedAt: string;
  ports: typeof PORTS;
  services: Array<{ name: string; kind: string; healthyUrl: string }>;
  targets: {
    ssh: Pick<SshSimHandle, "host" | "port" | "user" | "privateKeyPath" | "knownHostsPath">;
    http: { url: string };
    network: { url: string };
  };
}

let handles: { ssh: SshSimHandle; http: HttpSimHandle; net: NetworkDeviceSimHandle } | null = null;

async function start(): Promise<FarmInfo> {
  const ssh = await createSshSim({
    port: PORTS.ssh,
    execHandlers: SSH_HANDLERS,
  });
  const http = await createHttpSim({
    port: PORTS.http,
    routes: {
      "GET /ping": () => ({ ok: true }),
      "POST /echo": async (_r, ctx) => JSON.parse(await ctx.text()),
      "PATCH /whoami": (_r, ctx) => ({ authorization: ctx.authorization }),
    },
  });
  const net = await createNetworkDeviceSim({
    port: PORTS.net,
    initialRunning: "hostname sw1\ninterface Gi0/1\ndescription old\n",
  });
  handles = { ssh, http, net };

  const info: FarmInfo = {
    simFarm: true,
    runtime: "bun-inprocess",
    detectedRuntime: "none", // docker/podman/lxc absent in this harness
    startedAt: new Date().toISOString(),
    ports: { ...PORTS },
    services: [
      { name: "ssh", kind: "ssh", healthyUrl: `http://${HOST}:${PORTS.control}/health` },
      { name: "http", kind: "http", healthyUrl: http.healthUrl },
      { name: "network", kind: "network", healthyUrl: net.healthUrl },
    ],
    targets: {
      ssh: {
        host: ssh.host,
        port: ssh.port,
        user: ssh.user,
        privateKeyPath: ssh.privateKeyPath,
        knownHostsPath: ssh.knownHostsPath,
      },
      http: { url: http.baseUrl },
      network: { url: net.baseUrl },
    },
  };

  const ctrl = Bun.serve({
    port: PORTS.control,
    hostname: HOST,
    fetch(req) {
      const p = new URL(req.url).pathname;
      if (p === "/info") return Response.json(info);
      if (p === "/shutdown") {
        shutdown();
        return Response.json({ shuttingDown: true });
      }
      // Aggregate liveness: exercise each sim's own health routine.
      return Promise.all([ssh.health(), http.health(), net.health()]).then(
        ([sshOk, httpOk, netOk]) => {
          const ok = sshOk && httpOk && netOk;
          const body = {
            ok,
            services: [
              { name: "ssh", healthy: sshOk },
              { name: "http", healthy: httpOk },
              { name: "network", healthy: netOk },
            ],
          };
          return Response.json(body, { status: ok ? 200 : 503 });
        },
      );
    },
  });

  return info;
}

function shutdown(): void {
  if (!handles) return;
  try {
    handles.ssh.close();
  } catch {
    /* ignore */
  }
  try {
    handles.http.close();
  } catch {
    /* ignore */
  }
  try {
    handles.net.close();
  } catch {
    /* ignore */
  }
  handles = null;
  process.exit(0);
}

if (import.meta.main) {
  start()
    .then((info) => {
      // Emit exactly ONE line of JSON describing the farm on stdout.
      process.stdout.write(JSON.stringify(info) + "\n");
    })
    .catch((err) => {
      console.error(`sim-farm startup failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
