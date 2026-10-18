> **Migrated** from the repo root into `design/architecture/` (2026-09-18). This is the
> transport-layer design reference. Its opening "Status: greenfield" predates the current
> code — today the `Ssh/Local/Network/Http` interfaces exist as **typed scaffolds** (see
> `architecture/overview.md` and `roadmap.md`). The library/architecture recommendations
> below remain forward-looking design guidance.

# RoleCall — Connectivity / Transport Layer Design Brief

> Clientless, push-style config-management tool. Targets: Linux/Unix (SSH), network
> switches/appliances (SSH+CLI diff), generic HTTP/gRPC API endpoints, Windows (WinRM,
> eventual), and an OPTIONAL transient/permanent agent on capable platforms.
> Runtime: Node.js or Bun. Status: greenfield (no existing code in repo).

This brief maps the transport architecture, names concrete library candidates with
verified maturity, and flags gaps that require custom code. Every claim is cited to a
real package/repo with version/date evidence gathered 2026-09-07.

---

## 0. Maturity / Risk Scorecard (read first)

| Layer | Recommended lib | Evidence (version / date) | Maturity | Risk |
|---|---|---|---|---|
| SSH core | **`ssh2`** (pure JS) | v1.15.0, published ~May 2026; 5,817★; MIT; tests vs OpenSSH 8.7 — [npm](https://www.npmjs.com/package/ssh2) / [github](https://github.com/mscdex/ssh2) | **High / production** | Low |
| SSH convenience | `node-ssh` | 1,005★; 459k weekly dl; Promise wrapper over ssh2 — [github](https://github.com/steelbrain/node-ssh) | Medium | Low |
| SFTP | `ssh2-sftp-client` | v12.1.1 Mar 2026; Apache-2.0 — [npm](https://www.npmjs.com/package/ssh2-sftp-client) | High | Low |
| SSH (native FFI) | **`node-libssh2`** | uses libssh2 native bindings — [github](https://github.com/moimran/node-libssh2) | **AVOID** | **CRITICAL**: libssh2 CVE-2026-55200 (pre-auth RCE, CVSS 9.2/9.8) disclosed Jun 2026 — [Arctic Wolf](https://arcticwolf.com/resources/blog/cve-2026-55200-rogueplanet-shieldbreak/) |
| Network device | `nodemiko` | v2.0.0, published ~Jul 2025; **0 weekly downloads**, single maintainer — [npm](https://www.npmjs.com/package/nodemiko) | **Low / experimental** | High — use as reference only |
| Network device (ref) | `n8n-nodes-netdevices` | multi-vendor CLI handling, prompt/commit logic — [github](https://github.com/arpit-patel1/n8n-nodes-netdevices) | Reference impl | Medium |
| HTTP client | `undici` `Pool` / native `fetch` | undici v8.x; CVE-2026-6733 fixed in 8.5.0 — [advisory](https://github.com/advisories/GHSA-35p6-xmwp-9g52) | High | Low (pin >=8.5.0) |
| gRPC (TS) | `nice-grpc` / `@grpc/grpc-node` | nice-grpc v modern TS, 190 snippets — [context7](/deeplay-io/nice-grpc); grpc-node — [context7](/grpc/grpc-node) | High | Low |
| gRPC (web/edge) | `connect-es` | 1,802★; CNCF; 3 protocols (gRPC/gRPC-web/Connect) — [github](https://github.com/connectrpc/connect-es) | High | Low |
| WinRM (JS) | `winrm-client` | v0.0.12 Mar 2026; fork of unmaintained `nodejs-winrm`; Basic+NTLM; TS — [github](https://github.com/shide1989/winrm-client) | **Low / niche** (6★) | **High** |
| WinRM (reference) | `pywinrm` (Python sidecar) | used by Ansible; mature — [PyPI](https://pypi.org/project/pywinrm/) | High (but Python) | Medium |
| WebSocket | `ws` | 22,792★; 247M weekly dl; MIT; updated 19 days ago — [github](https://github.com/websockets/ws) | **High** | Low |
| WebSocket (perf) | `uWebSockets.js` | 9,150★; C++ core; **not on npm registry** (install from GitHub) — [github](https://github.com/uNetworking/uWebSockets.js) | Medium | Medium (build deps) |
| Concurrency | `p-queue` / `p-limit` | p-queue Jul 2026; p-limit 7.3.1 — [npm](https://www.npmjs.com/package/p-queue) | High | Low |
| Retry/backoff | `p-retry` / `async-retry` | p-retry ESM, AbortController, ~5M wk dl — [pkgpulse](https://www.pkgpulse.com/guides/p-retry-vs-async-retry-vs-exponential-backoff-retry-2026) | High | Low |
| Host-key verify | `ssh2` `hostVerifier` + `knownhosts` | skeema/knownhosts — [deepwiki](https://deepwiki.com/skeema/knownhosts/5.1-basic-host-key-verification) | Medium | Low |
| gNMI (structured net) | **none mature in JS** | openconfig/gnmi is Go — [github](https://github.com/openconfig/gnmi) | **Gap** | High — wrap @grpc/grpc-node + gnmi.proto yourself |

---

## 1. SSH Implementation (Node / Bun)

**Core library: `ssh2` (pure JavaScript).** It is the only production-grade SSH2
implementation for Node and runs unchanged on Bun (no native deps). Critically, it is
**pure JS and therefore NOT affected** by the June 2026 libssh2 CVE-2026-55200
(pre-auth memory-corruption RCE). The native-binding alternative `node-libssh2` IS
affected and should be avoided unless you pin a patched libssh2 (commit `97acf3df`).

**Key capabilities verified in `ssh2` API** ([README](https://github.com/mscdex/ssh2)):
- **Key auth**: `privateKey` / `passphrase`; Ed25519 & ECDSA supported (Node ≥12).
- **Host-key verification**: `hostHash` + `hostVerifier(key[, callback])` — return
  `true`/`false` or call `callback(bool)`. Pair with `knownhosts` to hash-check against
  a known_hosts file. **Default is auto-accept if unset — must be configured.**
- **Non-interactive exec**: `conn.exec(cmd, (err, stream) => …)`; stdout/stderr are
  separate streams; `stream.on('exit', (code, signal) => …)`.
- **Keepalives (long fan-outs)**: `keepaliveInterval` (ms, 0=off) and
  `keepaliveCountMax` (default 3) — mirrors OpenSSH `ServerAliveInterval`/
  `ServerAliveCountMax`. Essential for hundreds of idle-but-open sessions.
- **Channel multiplexing**: one TCP connection supports many exec/shell/sftp channels;
  `conn.openssh_forwardInStreamLocal`, agent forwarding, and subsystem (e.g. `netconf`)
  are supported. Reuse a single `Client` per target across many tasks.
- **readyTimeout** for handshake deadline; `algorithms` to relax `serverHostKey` for
  legacy devices (e.g. old switches with only `ssh-rsa`/`ssh-dss`).

**Convenience layer**: `node-ssh` wraps `ssh2` with Promise APIs (`execCommand`,
`putFile`, `tryKeyboard`) and supports `pty: true` for commands that need a TTY
(e.g. `screen -r`). Use it for ergonomics; drop to raw `ssh2` when you need channel
multiplexing or fine-grained stream control.

**Bun note**: Bun's runtime is compatible with `ssh2` (pure JS, uses `net`/`crypto`).
No native SSH exists in Bun — do not expect a built-in.

---

## 2. Network-Device Specifics (SSH + CLI diff)

Network gear is SSH-transport but **not** a general-purpose host. Differences:

- **No JSON by default.** Most vendors return unstructured CLI text. Exceptions:
  Arista EOS (`show version | json`), some Juniper (`| display json`), Cumulus. Plan
  for text parsing; treat JSON-capable vendors as a fast path.
- **Config modes & prompts.** Devices have enable/configure modes, per-vendor prompt
  strings, commit semantics (Cisco IOS `write mem` vs Juniper `commit` vs VyOS
  `commit`/`save`). `nodemiko` models this with `device_type` drivers
  (`cisco_ios`, `juniper_junos`, …) and `sendConfig()` / `enable()`. **Risk**:
  `nodemiko` has ~0 weekly downloads and a single maintainer — treat its driver map as
  a *reference*, not a dependency. The `n8n-nodes-netdevices` repo shows a more
  battle-tested vendor matrix (MikroTik, Extreme, Dell OS10, Ubiquiti, Aruba, Palo Alto)
  with prompt-suppression and commit-handling logic worth copying.
- **Candidate/running compare-and-diff.** There is **no library** that does this for
  you. The pattern (custom code required):
  1. Fetch `running-config` (or `show running-config`) and `candidate`/intended config
     as text.
  2. Normalize (strip timestamps, ordering, `!` banners, VLAN/interface ordering).
  3. Diff with a text-diff lib (`diff` / `jsdiff`,
     [npm](https://www.npmjs.com/package/diff)) — line or LCS based.
  4. For structured devices, prefer **gNMI Get** (see §3) which returns typed data
     you can deep-compare, or NETCONF `<get-config>` via ssh2 subsystem.
- **Batch CLI commands.** Send a command set in one session: `sendCommandTiming` for
  long-running ops with adjustable timeout; collect output per command keyed by prompt.
  Use `expect_string` (regex) to know when a command finished — this is the core of
  any network driver and is the part you must write per vendor.
- **Lack of JSON → parsing burden.** Budget for a per-platform parser layer; isolate
  it behind the `NetworkSSH` connection so the rest of RoleCall sees normalized facts.

---

## 3. HTTP/REST + gRPC Client Patterns

**When to use REST vs gRPC per endpoint type:**

| Endpoint type | Prefer | Why |
|---|---|---|
| CRUD / public-ish API, human-debuggable | **REST + JSON** (`undici`/`fetch`) | Ubiquitous, curl-able, no codegen |
| High-throughput internal service-to-service, streaming, typed contracts | **gRPC** (`@grpc/grpc-node` or `nice-grpc`) | Protobuf binary (3–5× smaller), HTTP/2 multiplexing, native streaming |
| Browser/edge/Bun client or want JSON *and* gRPC interop | **Connect (`connect-es`)** | One server speaks gRPC + gRPC-web + plain HTTP/JSON; CNCF, 1,802★ |

**HTTP client choice (Node/Bun):**
- **`undici` `Pool`** for high fan-out to a fixed set of API origins: configurable
  `connections` (16–128), `keepAliveTimeout`, pipelining, per-origin pooling
  ([docs](https://undici.nodejs.org/api/Pool)). Native `fetch` already uses a shared
  global undici pool, so keep-alive is automatic.
- **Pin `undici >= 8.5.0`** — CVE-2026-6733 (keep-alive response-queue poisoning)
  affects <8.5.0 and is patched there ([advisory](https://github.com/advisories/GHSA-35p6-xmwp-9g52)).
- `axios`/`got` remain fine for ergonomics but add overhead; only reach for them if you
  need interceptors/ecosystem.

**gRPC choice:**
- `@grpc/grpc-node` — the canonical, high-reputation implementation ([context7](/grpc/grpc-node)).
- `nice-grpc` — modern TypeScript, Promise + Async-Iterable streaming, middleware,
  built-in retry/deadline ([context7](/deeplay-io/nice-grpc)). Best DX for the agent.
- `connect-es` — if the agent or any client must run in browser/edge/Bun, or you want
  REST+JSON debugging alongside gRPC.

**Structured network alternative (gap):** gNMI (OpenConfig) gives typed Get/Set/Subscribe
over gRPC — far superior to CLI diff for modern gear (Cisco NX-OS, SONiC, Arista).
**No mature JS gNMI client exists**; `openconfig/gnmi` is Go. You must wrap
`@grpc/grpc-node` (or `nice-grpc`) with `gnmi.proto` yourself. Flag as a build item,
not a library pick.

---

## 4. WinRM (Windows) — Prerequisites & JS Maturity

**Prerequisites on the target** ([MS Learn](https://learn.microsoft.com/en-us/windows/win32/winrm/installation-and-configuration-for-windows-remote-management), [Ansible](https://docs.ansible.com/projects/ansible/latest/os_guide/windows_winrm.html)):
- Service auto-starts on Server; run `winrm quickconfig` to open firewall + create listener.
- **Ports**: 5985 (HTTP) and 5986 (HTTPS/TLS). Prefer 5986 in production.
- **Auth methods**: Kerberos (domain, best), NTLM (local/workgroup, default-on),
  Basic (local only, needs HTTPS), Certificate, CredSSP (delegation). Negotiate picks
  Kerberos→NTLM.
- Workgroup/IP connections need client-side `TrustedHosts` set; domain joins use Kerberos.
- Hardening: disable Basic, `AllowUnencrypted=false`, scope `Remote Management Users`,
  consider JEA (Just Enough Administration) to limit to role commands.

**JS library maturity — the weak link:**
- `nodejs-winrm` — last published **5 years ago**; effectively dead.
- `winrm-client` — active fork (v0.0.12, **Mar 2026**), TypeScript, Basic+NTLM,
  interactive prompt handling ([github](https://github.com/shide1989/winrm-client)).
  **But only ~6 stars** — too small a community for a core dependency.
- Mature equivalents exist only in **other languages**: `pywinrm` (Python, Ansible's
  engine), `WinRb/WinRM` (Ruby), `masterzen/winrm` (Go, no Kerberos).

**Recommendation / risk:** Do **not** block RoleCall's Windows support on a 6-star JS lib.
Two viable paths:
1. **Sidecar**: shell out to a small `pywinrm`-based service (or `winrm` Go binary) and
   talk to it over localhost HTTP/gRPC from the Node control plane.
2. **Adopt `winrm-client` behind an interface** with your own test harness + a fallback
   to the sidecar. Either way, WinRM is the **highest-risk transport** and should be
   isolated behind the `Connection` trait so it can be swapped.

---

## 5. Optional-Agent Protocol Design (vs pure clientless push)

**Two modes, same `Connection` trait:**
- **Clientless push** (default): control plane opens outbound SSH/WinRM/HTTP to target,
  pushes config, closes. No target-side state.
- **Agent mode** (opt-in, capable platforms): a small long-lived agent on the target
  receives tasks, reports status/facts, stays lightweight.

**Agent transport options (verified):**
- **WebSocket (`ws`)** — simplest, 247M weekly downloads, mature. Bidirectional,
  natural for task-push + streaming status. Use `ws` as the default; `uWebSockets.js`
  only if you need >100k concurrent agent connections (it's a C++ addon not on npm).
- **gRPC streaming (`nice-grpc` / `connect-es`)** — if you want typed task/fact
  messages and HTTP/2 multiplexing, especially for many agents behind one connection.
  `connect-es` lets the same agent speak to a browser dashboard too.

**Agent protocol shape (custom, but small):**
```
Agent -> Controller: Register{agent_id, platform, caps[], version}
Controller -> Agent: Task{push_id, target_facts_request?, config_bundle_ref}
Agent -> Controller: Status{state: queued|applying|done|error, progress}
Agent -> Controller: Facts{os, version, current_hash, custom[]}   // for drift detection
Agent -> Controller: Result{ok, diff?, error?}
```
- **Lightweight**: single static binary (compile from the same TS via Bun build or a
  tiny Go/Rust shim); no runtime deps on target. Reuse the *same* `SshConnection`/
  `HttpApiConnection` primitives internally so agent and clientless share logic.
- **Why agent helps**: facts/drift can be collected on a schedule without re-opening
  SSH; long applies survive controller restarts via resumable task IDs; NAT/cloud
  targets where controller can't initiate inbound are reachable (agent dials out).
- **Security**: mutual TLS or token auth; agent only accepts signed task bundles;
  facts are read-only by default.

---

## 6. Connection Pooling / Concurrency / Rate Limiting

Goal: fan out to **hundreds** of targets without exhausting FDs or hammering endpoints.

- **Per-target connection reuse**: keep one `ssh2` `Client` (or undici `Pool` per API
  origin) alive across the tasks for that target; multiplex channels. Avoid
  connect-per-command.
- **Global bounded concurrency**: `p-queue` (priority + interval rate limiting) or
  `p-limit` (simple cap). Size by target class:
  - SSH/Linux: 20–50 concurrent per control node (SSH handshake + exec cost).
  - Network devices: **lower** (5–15) — switches often serialize CLI, and config mode
    is stateful.
  - HTTP APIs: match undici `connections` (16–128) and add `p-queue` interval cap to
    respect provider rate limits (e.g. 429/`Retry-After`).
- **Pool libraries**: `generic-pool` for arbitrary pooled resources (e.g. WinRM
  sessions); undici `Pool` for HTTP; `ssh2` `Client` instances managed by your own
  `Map<target, Client>` with idle eviction.
- **Backpressure**: never `Promise.all` over all targets — feed through the bounded
  queue; surface queue depth as a metric; shed load (fail-fast 503-style) before
  exhausting sockets.

---

## 7. Graceful Degradation & Per-Target Timeout/Retry/Backoff

- **Per-target timeouts**: `readyTimeout` (SSH handshake), `AbortSignal.timeout()` on
  `fetch`/exec, `read_timeout`/`conn_timeout` on device drivers. Always bound both
  connect and in-flight phases.
- **Retry with backoff**: `p-retry` (ESM, `AbortController`, `onFailedAttempt`,
  exponential backoff + jitter) or `async-retry` (Vercel-maintained, `bail()` for
  fatal). Only retry **idempotent** ops; never retry a non-idempotent config push
  blindly — gate on dry-run/diff or use the agent's resumable task ID.
- **Classify failures**: network/timeout/429/5xx → retry with backoff+jitter;
  auth/host-key-mismatch/404 → `bail()` (no retry). Respect `Retry-After`.
- **Degradation tiers**:
  1. Target unreachable → retry w/ backoff, then mark `degraded`, continue others.
  2. Whole transport (e.g. WinRM lib) broken → fall back to sidecar or skip with alert.
  3. Controller overload → shed new tasks, keep in-flight, emit backpressure signal.
- **Observability**: per-target status (ok/degraded/failed), attempt count, last-error
  class, queue depth, pool saturation. This is what makes "hundreds of targets" safe.

---

## 8. Layered Transport Interface Spec

Abstract `Connection` trait, with four implementers. All implementers share:
`connect()`, `exec(task)`, `facts()`, `disconnect()`, `health()`. Concurrency,
retry, and timeouts are applied **outside** the implementer (decorator / queue layer),
so every transport gets them for free.

```typescript
// ---- Core trait ----
interface TargetSpec {
  id: string;
  host: string;
  port?: number;
  auth: SshAuth | WinRmAuth | ApiAuth | AgentAuth;
  transport: 'ssh' | 'netssh' | 'http' | 'winrm' | 'wsagent';
  timeoutMs?: number;
  concurrencyClass?: 'linux' | 'network' | 'api' | 'windows';
}

interface ExecResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  facts?: Record<string, unknown>;   // normalized, not raw
  diff?: DiffEntry[];                // for config targets
  error?: { class: 'auth'|'timeout'|'network'|'fatal'|'retryable'; message: string };
}

interface Connection {
  readonly target: TargetSpec;
  connect(): Promise<void>;
  exec(task: Task): Promise<ExecResult>;   // push a config/command/fact task
  facts(): Promise<Record<string, unknown>>;
  disconnect(): Promise<void>;
  health(): 'ready' | 'degraded' | 'down';
}

// ---- Implementer 1: SSH (Linux/Unix) ----
// Lib: ssh2 (core) + node-ssh (convenience). Pure JS, Bun-compatible.
class SshConnection implements Connection {
  private client: ssh2.Client;          // reused across tasks (channel multiplex)
  // hostVerifier + knownhosts for host-key pinning
  // keepaliveInterval / keepaliveCountMax for long fan-outs
}

// ---- Implementer 2: NetworkSSH (switches/appliances) ----
// Lib: ssh2 transport + CUSTOM vendor driver layer (nodemiko as reference only).
class NetworkSshConnection implements Connection {
  private driver: VendorDriver;        // cisco_ios | junos | eos | vyos | ...
  // sendConfig(), enable(), expect_string prompt handling, commit/save semantics
  // candidate vs running diff via `diff` lib on normalized text; gNMI Get if capable
}

// ---- Implementer 3: HttpApi (REST + gRPC) ----
// Lib: undici Pool (REST) and/or nice-grpc / connect-es (gRPC).
class HttpApiConnection implements Connection {
  private pool: undici.Pool;           // per-origin keep-alive
  private grpc?: GrpcClient;           // optional, for gRPC endpoints
  // respects 429 / Retry-After; JSON or protobuf payloads
}

// ---- Implementer 4: WinRmConnection (Windows, eventual) ----
// Lib: winrm-client (TS fork) OR pywinrm sidecar over localhost. HIGH RISK.
class WinRmConnection implements Connection {
  private client: WinRmClient;         // Basic/NTLM; 5985/5986; TrustedHosts for workgroup
  // isolated behind trait so it can be swapped to sidecar without touching callers
}

// ---- Implementer 5 (optional): WsAgent (agent mode) ----
// Lib: ws (default) or nice-grpc/connect-es streaming. Agent dials OUT.
class WsAgentConnection implements Connection {
  private socket: WebSocket;           // or gRPC bidi stream
  // Register -> Task -> Status* -> Facts -> Result protocol (§5)
  // same internal SshConnection/HttpApiConnection primitives reused on agent side
}

// ---- Cross-cutting decorators (apply to ANY Connection) ----
class BoundedConnection implements Connection {        // p-queue / p-limit
  constructor(private inner: Connection, private queue: PQueue) {}
  exec(task: Task) { return this.queue.add(() => this.inner.exec(task)); }
}
class RetryingConnection implements Connection {        // p-retry, backoff+jitter
  constructor(private inner: Connection, private retry: RetryPolicy) {}
  async exec(task: Task) {
    return pRetry(() => this.inner.exec(task), {
      retries: 4, onFailedAttempt: logAttempt,
      // bail on auth/fatal; only retry retryable
    });
  }
}
class TimeoutConnection implements Connection {         // AbortSignal per phase
  constructor(private inner: Connection, private timeoutMs: number) {}
  exec(task: Task) {
    return withTimeout(() => this.inner.exec(task), this.timeoutMs);
  }
}
```

**Construction:** a `ConnectionFactory` maps `TargetSpec.transport` → implementer,
wraps each in `Timeout → Retry → Bounded` decorators, and registers it in a
`Map<targetId, Connection>` with idle eviction. The orchestrator fans tasks through a
global `p-queue` sized per `concurrencyClass`.

---

## 9. Gaps Requiring Custom Code (no library covers these)

1. **Network vendor driver layer** — prompt/commit/enable handling per OS. `nodemiko`
   is a reference, not a dependency. *(High effort, core to network support.)*
2. **Candidate/running config diff** — normalize + `diff` lib; no off-the-shelf tool.
3. **JS gNMI client** — wrap `@grpc/grpc-node` + `gnmi.proto` for structured network
   state (modern gear). *(Medium effort, high payoff vs CLI diff.)*
4. **WinRM production path** — either harden `winrm-client` or build a `pywinrm`
   sidecar. *(Risk owner for Windows.)*
5. **Agent protocol** — define Register/Task/Status/Facts/Result messages + TLS/token
   auth; reuse core primitives on agent side. *(Medium effort.)*
6. **Host-key pinning store** — `knownhosts`-backed verification wired into `ssh2`
   `hostVerifier` (default is insecure auto-accept).
7. **Per-class concurrency tuning + backpressure metrics** — queue-depth/saturation
   signals so hundreds of targets don't cascade.

---

## 10. Recommended Stack (decision)

- **SSH**: `ssh2` (core) + `node-ssh` (ergonomics). Pin pure-JS; never `node-libssh2`.
- **Network**: `ssh2` + custom driver layer (model on `n8n-nodes-netdevices`); add
  gNMI wrapper for capable gear.
- **HTTP**: `undici` `Pool` (pin ≥8.5.0) or native `fetch`; `nice-grpc`/`connect-es`
  for gRPC endpoints.
- **WinRM**: `winrm-client` behind the trait **or** `pywinrm` sidecar — flagged risk.
- **Agent**: `ws` (default) or `nice-grpc`/`connect-es` streaming; agent dials out.
- **Cross-cutting**: `p-queue`/`p-limit` (concurrency), `p-retry` (backoff+jitter),
  `AbortSignal` (timeouts), `knownhosts` (host keys).

**Top 3 risks to track:** (1) WinRM JS immaturity, (2) network driver layer is custom
build, (3) libssh2 CVE-2026-55200 if anyone reaches for a native SSH binding.
