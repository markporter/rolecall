// Integration test for SshConnection against a real (containerized) sshd — OR,
// when no container runtime is available (this harness), against the reusable
// in-process createSshSim() simulator from src/testing/sims so the suite still
// exercises connect/exec/facts/host-key behavior offline with zero deps.
//
// Container path (unchanged): `bash scripts/ssh-sim.sh start --runtime docker|lxc`
// prints ONE line of JSON describing the running sim; this suite runs it under
// beforeAll and tears it down under afterAll. When neither script nor runtime
// exists, we fall back to the in-process farm-free simulator below.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, beforeAll, afterAll, test, expect } from "bun:test";
import { SshConnection } from "../../src/transport/ssh";
import { createSshSim, type SshSimHandle } from "../../src/testing/sims/ssh-server";

// --- Detect available runtime at module load -------------------------------
function hasRuntime(bin: string): boolean {
  try {
    return Bun.spawnSync([bin, "info"], { stdout: "ignore", stderr: "ignore" }).success;
  } catch {
    // Binary absent from $PATH -> spawnSync throws ENOENT; treat as unavailable.
    return false;
  }
}
function daemonReachable(bin: string): boolean {
  try {
    return Bun.spawnSync([bin, "info"], { stdout: "ignore", stderr: "ignore" }).success;
  } catch {
    return false;
  }
}
const runtime: "docker" | null = daemonReachable("docker") ? "docker" : null;

const scriptPath = join(import.meta.dir, "..", "..", "scripts", "ssh-sim.sh");
const canDocker = runtime !== null && existsSync(scriptPath);

// The in-process simulator is always usable here, so this suite runs regardless
// of container availability (previously it skipped when no runtime existed).
const suite = describe;

/** Common shape bridging the container JSON and the in-process handle. */
interface SimTarget {
  host: string;
  port: number;
  user: string;
  privateKeyPath: string;
  knownHostsPath: string;
}

const NO_RETRY = { retries: 0, minTimeout: 10, maxTimeout: 50, factor: 2, randomize: false };

let target: SimTarget | null = null;
// In-process handle kept for teardown (the bridged SimTarget has no close()).
let simHandle: SshSimHandle | null = null;
let containerId: string | null = null;

function getTarget(): SimTarget {
  if (!target) throw new Error("sim target not started (beforeAll failed?)");
  return target;
}

function connFor(t: SimTarget): SshConnection {
  return new SshConnection({
    kind: "ssh",
    host: t.host,
    port: t.port,
    user: t.user,
    credentials: { privateKey: readFileSync(t.privateKeyPath, "utf-8") },
    knownHostsPath: t.knownHostsPath,
    strictHostKeyChecking: true,
    retry: NO_RETRY,
    timeoutMs: 10000,
  });
}

function spawnSim(args: string[]): { success: boolean; stdout: string; stderr: string } {
  const r = Bun.spawnSync(["bash", scriptPath, ...args], { stdout: "pipe", stderr: "pipe" });
  return {
    success: r.success,
    stdout: r.stdout.toString().trim(),
    stderr: r.stderr.toString().trim(),
  };
}

suite("SshConnection integration", () => {
  beforeAll(async () => {
    if (canDocker) {
      const r = spawnSim(["start", "--runtime", runtime!]);
      if (!r.success) {
        throw new Error(`ssh-sim start failed: ${r.stderr || r.stdout}`);
      }
      const parsed = JSON.parse(r.stdout) as {
        containerId: string;
        host: string;
        port: number;
        user: string;
        privateKeyPath: string;
        knownHostsPath: string;
      };
      containerId = parsed.containerId;
      target = {
        host: parsed.host,
        port: parsed.port,
        user: parsed.user,
        privateKeyPath: parsed.privateKeyPath,
        knownHostsPath: parsed.knownHostsPath,
      };
    } else {
      // Offline fallback: reusable in-process SSH simulator (RSA host key + pubkey).
      const h: SshSimHandle = await createSshSim({
        // Ephemeral port (OS-assigned): avoids clashing with other test files' sims.
        port: 0,
        execHandlers: {
          "uname -srm": "Linux 5.15.0-123-generic x86_64\n",
          "whoami": "root\n",
          "echo hello": "hello\n",
        },
      });
      target = {
        host: h.host,
        port: h.port,
        user: h.user,
        privateKeyPath: h.privateKeyPath,
        knownHostsPath: h.knownHostsPath,
      };
      simHandle = h;
    }
  });

  afterAll(() => {
    if (containerId) {
      const r = spawnSim(["stop", containerId!]);
      if (!r.success) {
        console.warn(`ssh-sim stop warning: ${r.stderr || r.stdout}`);
      }
      containerId = null;
    } else if (simHandle) {
      simHandle.close();
    }
    target = null;
    simHandle = null;
  });

  test("(a) connect + exec echo", async () => {
    const s = getTarget();
    const conn = connFor(s);
    await conn.connect();
    try {
      const res = await conn.exec("echo hello");
      expect(res.exitCode).toBe(0);
      expect(res.stdout.trim()).toBe("hello");
    } finally {
      await conn.disconnect();
    }
  });

  test("(b) facts() reports ssh transport + Linux", async () => {
    const s = getTarget();
    const conn = connFor(s);
    await conn.connect();
    try {
      const facts = await conn.facts();
      expect(facts.transport).toBe("ssh");
      expect(facts.os).toMatch(/Linux/);
    } finally {
      await conn.disconnect();
    }
  });

  test("(c) host-key accept with real known_hosts", async () => {
    const s = getTarget();
    const conn = connFor(s);
    await expect(conn.connect()).resolves.toBeUndefined();
    await conn.disconnect();
  });

  test("(d) host-key reject with bogus known_hosts", async () => {
    const s = getTarget();
    // Generate a fresh keypair and use its public key as a bogus known_hosts entry.
    const bogusDir = mkdtempSync(join(tmpdir(), "rolecall-bogus-"));
    const bogusKey = join(bogusDir, "id");
    Bun.spawnSync(["ssh-keygen", "-t", "ed25519", "-N", "", "-f", bogusKey], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const bogusPub = Bun.spawnSync(["ssh-keygen", "-y", "-f", bogusKey], {
      stdout: "pipe",
      stderr: "ignore",
    })
      .stdout.toString()
      .trim();
    const bogusKh = join(bogusDir, "known_hosts");
    writeFileSync(bogusKh, `${s.host} ${bogusPub}\n`);

    const conn = connFor(s);
    // Point the client at the mismatched known_hosts to force verification failure.
    conn.options.knownHostsPath = bogusKh;
    await expect(conn.connect()).rejects.toThrow();
  });

  // Transient/retry behavior is covered exhaustively by the unit tests
  // (tests/transport.test.ts) which mock the ssh2 Client; running it here would
  // only add slow, flaky wall-clock waits against a real server. Skipped by default.
  test.skip("(e) transient retry/backoff — covered by unit tests", () => {});
});
