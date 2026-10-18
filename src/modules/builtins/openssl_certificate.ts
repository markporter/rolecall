// Batteries-included `openssl_certificate` module (Todo 27).
//
// Declarative X.509 certificate management backed by the system `openssl` CLI.
// Covers the common cases an infra role needs:
//   * self-signed leaf certs (the default) and self-signed CAs (`ca: true`),
//   * certs signed by an existing CA (`ca_cert` + `ca_key`),
//   * Subject Alternative Names (`san: ["DNS:foo","IP:1.2.3.4","email:a@b"]`),
//   * per-purpose Extended Key Usage (`purpose: server|client|codesign|...`),
//   * key algorithm/size selection (rsa/ecdsa/ed25519).
//
// Idempotent via `resource()`: `describe` inspects the existing cert on the
// target (subject, SAN, expiry) and reports `inDesired` when it already matches,
// so re-runs issue ZERO openssl calls. `force: true` always regenerates.

import type { Module, ModuleContext, ModuleResult } from "../../executor/module";
import type { CheckableModule } from "../../idempotency/types";
import { resource } from "../resource";
import { shQuote, readRemoteFile, writeRemoteFile } from "./fs";
import type { ModuleSummary } from "../search";

/** @summary Arguments for the `openssl_certificate` module. */
export interface OpenSSLCertArgs {
  /** Destination path of the signed certificate (PEM). Required. */
  path: string;
  /** Destination path of the private key (PEM, written unencrypted). Required. */
  privatekey_path: string;
  /** `present` (default) creates/keeps the cert; `absent` removes it. */
  state?: "present" | "absent";
  /** Certificate Common Name (CN). Used to build the subject when `subject` is unset. */
  common_name?: string;
  /** Full subject, e.g. `/CN=foo/O=bar`; overrides `common_name` when provided. */
  subject?: string;
  /** Subject Alternative Names as OpenSSL tokens: `["DNS:foo","IP:1.2.3.4","email:a@b","URI:https://x"]`. */
  san?: string[];
  /** Validity in days (default 365). */
  days?: number;
  /** Key algorithm: `rsa` (default), `ecdsa`, or `ed25519`. */
  algorithm?: "rsa" | "ecdsa" | "ed25519";
  /** RSA key size (default 2048; only for `algorithm: rsa`). */
  key_size?: number;
  /** Curve for `ecdsa` (e.g. `prime256v1`) or key type for `ed25519`. */
  curve?: string;
  /** Friendly purpose(s) mapping to Extended Key Usage: `server`, `client`, `codesign`, `email`, `timestamp`. */
  purpose?: string | string[];
  /** Explicit `keyUsage` values (e.g. `["critical,digitalSignature","keyEncipherment"]`). Overrides the purpose default. */
  key_usage?: string[];
  /** Explicit `extendedKeyUsage` values. Overrides the `purpose` default. */
  extended_key_usage?: string[];
  /** When true, mint a self-signed CA cert (`basicConstraints=CA:TRUE`). */
  ca?: boolean;
  /** CA certificate path: sign the new cert with this CA instead of self-signing. */
  ca_cert?: string;
  /** CA private key path (required with `ca_cert`). */
  ca_key?: string;
  /** Path to an existing CSR to sign (skips key/CSR generation). Requires `ca_cert`+`ca_key`. */
  csr?: string;
  /** Force regeneration even when an existing cert already matches. */
  force?: boolean;
  /** Dry-run: report the planned openssl commands without executing them. */
  dry_run?: boolean;
}

const PURPOSE_EKU: Record<string, string> = {
  server: "serverAuth",
  client: "clientAuth",
  codesign: "codeSigning",
  email: "emailProtection",
  timestamp: "timeStamping",
};

/** Map a friendly `purpose` (or explicit list) to OpenSSL Extended Key Usage values. */
export function purposeToEKU(purpose?: string | string[]): string[] {
  if (Array.isArray(purpose)) return purpose;
  if (!purpose) return [];
  return purpose
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => PURPOSE_EKU[p] ?? p);
}

/** @summary Ordered openssl commands plus an optional signing extfile the module will materialize on the target. */
export interface CertPlan {
  /** Raw openssl commands (NOT sudo-wrapped; the module wraps them at exec time). */
  commands: string[];
  /** When signing by a CA, the extfile to write on the target before signing. */
  extfile?: { path: string; content: string };
}

/** Build the openssl command plan for a `present` cert. Pure — no I/O, easy to unit test. */
export function buildCertPlan(args: OpenSSLCertArgs): CertPlan {
  const subject = args.subject ?? `/CN=${args.common_name ?? "localhost"}`;
  const days = args.days ?? 365;
  const algo = args.algorithm ?? "rsa";
  const keyOpt =
    algo === "rsa"
      ? `rsa:${args.key_size ?? 2048}`
      : algo === "ecdsa"
        ? `ecdsa:${args.curve ?? "prime256v1"}`
        : "ed25519";
  const san = args.san && args.san.length > 0 ? `subjectAltName=${args.san.join(",")}` : null;

  const isCA = args.ca === true;
  const eku = args.extended_key_usage ? args.extended_key_usage : purposeToEKU(args.purpose);
  const ku = args.key_usage
    ? args.key_usage
    : isCA
      ? ["critical,keyCertSign", "cRLSign"]
      : ["critical,digitalSignature", "keyEncipherment"];

  const extLines = [`basicConstraints=${isCA ? "critical,CA:TRUE" : "critical,CA:FALSE"}`];
  if (ku.length) extLines.push(`keyUsage=${ku.join(",")}`);
  if (eku.length) extLines.push(`extendedKeyUsage=${eku.join(",")}`);
  if (san) extLines.push(san);

  const keyPath = args.privatekey_path;
  const certPath = args.path;
  const commands: string[] = [];

  if (args.ca_cert && args.ca_key) {
    const extPath = `${certPath}.ext`;
    const extfile = { path: extPath, content: `[v3]\n${extLines.join("\n")}` };
    if (args.csr) {
      commands.push(
        `openssl x509 -req -in ${shQuote(args.csr)} -CA ${shQuote(args.ca_cert)} -CAkey ${shQuote(args.ca_key)} -CAcreateserial -out ${shQuote(certPath)} -days ${days} -extfile ${shQuote(extPath)} -extensions v3`,
      );
    } else {
      const csrPath = `${certPath}.csr`;
      const csrAddext = san ? `-addext ${shQuote(san)}` : "";
      commands.push(
        `openssl req -newkey ${keyOpt} -keyout ${shQuote(keyPath)} -out ${shQuote(csrPath)} -subj ${shQuote(subject)} -nodes ${csrAddext}`.trim(),
      );
      commands.push(
        `openssl x509 -req -in ${shQuote(csrPath)} -CA ${shQuote(args.ca_cert)} -CAkey ${shQuote(args.ca_key)} -CAcreateserial -out ${shQuote(certPath)} -days ${days} -extfile ${shQuote(extPath)} -extensions v3`,
      );
    }
    return { commands, extfile };
  }

  const addexts: string[] = [];
  addexts.push(`-addext ${shQuote(`basicConstraints=${isCA ? "critical,CA:TRUE" : "critical,CA:FALSE"}`)}`);
  if (ku.length) addexts.push(`-addext ${shQuote(`keyUsage=${ku.join(",")}`)}`);
  if (eku.length) addexts.push(`-addext ${shQuote(`extendedKeyUsage=${eku.join(",")}`)}`);
  if (san) addexts.push(`-addext ${shQuote(san)}`);
  commands.push(
    `openssl req -x509 -newkey ${keyOpt} -keyout ${shQuote(keyPath)} -out ${shQuote(certPath)} -days ${days} -subj ${shQuote(subject)} -nodes ${addexts.join(" ")}`,
  );
  return { commands };
}

/** Wrap a script under `sudo sh -c '<shQuote>'` when `become` is requested (single-quote safe). */
function becomeSh(cmd: string, become: boolean): string {
  return become && !cmd.startsWith("sudo ") ? `sudo sh -c ${shQuote(cmd)}` : cmd;
}

/** Inspect an existing cert on the target, extracting CN, SANs, and expiry. */
async function inspectCert(
  conn: import("../../transport/connection").Connection,
  path: string,
  become: boolean,
): Promise<{ cn?: string; san: string[]; notAfter?: Date } | null> {
  const r = await conn.exec(
    becomeSh(`openssl x509 -in ${shQuote(path)} -noout -subject -enddate -ext subjectAltName`, become),
  );
  if (r.exitCode !== 0) return null;
  const out = r.stdout ?? "";
  const cn = out.match(/\/CN=([^/]+)/)?.[1];
  const san = [...out.matchAll(/(?:DNS|IP|email|URI):([^\s,]+)/g)].map((m) => m[0]);
  const exp = out.match(/notAfter=\s*(.+)/)?.[1];
  let notAfter: Date | undefined;
  if (exp) {
    const d = new Date(exp.trim());
    if (!Number.isNaN(d.getTime())) notAfter = d;
  }
  return { cn, san, notAfter };
}

/** True when the on-target cert already satisfies the requested args (subject/SAN/expiry). */
async function certMatches(
  conn: import("../../transport/connection").Connection,
  args: OpenSSLCertArgs,
  become: boolean,
): Promise<boolean> {
  const info = await inspectCert(conn, args.path, become);
  if (!info) return false;
  if (args.common_name && info.cn && info.cn !== args.common_name) return false;
  if (args.san && args.san.length > 0) {
    const want = new Set(args.san);
    if (info.san.length !== want.size || !info.san.every((s) => want.has(s))) return false;
  }
  if (info.notAfter && info.notAfter.getTime() <= Date.now()) return false;
  return true;
}

/** Search metadata for the `openssl_certificate` module (auto-collected by builtins/index.ts). */
export const meta: ModuleSummary = {
  name: "openssl_certificate",
  description:
    "Declarative X.509 certificate management via openssl: self-signed leaf/CA certs, CA-signed certs, SANs, and per-purpose EKU (server/client/code-signing). Idempotent.",
  idempotent: true,
  source: "builtin",
  args: {
    path: { type: "string", required: true, description: "Destination certificate path (PEM)." },
    privatekey_path: { type: "string", required: true, description: "Destination private key path (PEM, unencrypted)." },
    state: { type: "'present' | 'absent'", required: false, description: "Default 'present'. 'absent' removes the cert and key." },
    common_name: { type: "string", required: false, description: "Certificate CN." },
    subject: { type: "string", required: false, description: "Full subject (e.g. '/CN=foo/O=bar'); overrides common_name." },
    san: { type: "string[]", required: false, description: "SAN tokens: ['DNS:foo','IP:1.2.3.4','email:a@b']." },
    days: { type: "number", required: false, description: "Validity in days (default 365)." },
    algorithm: { type: "'rsa' | 'ecdsa' | 'ed25519'", required: false, description: "Key algorithm (default rsa)." },
    key_size: { type: "number", required: false, description: "RSA key size (default 2048)." },
    curve: { type: "string", required: false, description: "Curve (ecdsa) or key type (ed25519)." },
    purpose: { type: "string | string[]", required: false, description: "server|client|codesign|email|timestamp -> EKU." },
    key_usage: { type: "string[]", required: false, description: "Explicit keyUsage values." },
    extended_key_usage: { type: "string[]", required: false, description: "Explicit extendedKeyUsage values." },
    ca: { type: "boolean", required: false, description: "Mint a self-signed CA (basicConstraints=CA:TRUE)." },
    ca_cert: { type: "string", required: false, description: "CA cert to sign with (enables CA-signed mode)." },
    ca_key: { type: "string", required: false, description: "CA private key (with ca_cert)." },
    csr: { type: "string", required: false, description: "Existing CSR to sign (CA mode only)." },
    force: { type: "boolean", required: false, description: "Regenerate even if an existing cert matches." },
    dry_run: { type: "boolean", required: false, description: "Plan only; execute nothing." },
  },
  examples: [
    `- openssl_certificate:
    path: /etc/nginx/ssl/site.crt
    privatekey_path: /etc/nginx/ssl/site.key
    common_name: site1.example.com
    san:
      - 'DNS:site1.example.com'
    purpose: server`,
    `- openssl_certificate:
    path: /etc/ca/ca.crt
    privatekey_path: /etc/ca/ca.key
    common_name: My Internal CA
    ca: true`,
    `- openssl_certificate:
    path: /etc/nginx/ssl/client.crt
    privatekey_path: /etc/nginx/ssl/client.key
    common_name: admin
    purpose: client
    ca_cert: /etc/ca/ca.crt
    ca_key: /etc/ca/ca.key`,
  ],
  notes:
    "≠ Ansible `community.crypto.openssl_certificate`: covers self-signed, CA, and CA-signed certs with SANs + EKU. Idempotent via on-target inspection (subject/SAN/expiry). Requires the `openssl` CLI on the target.",
};

/** @summary Declarative X.509 certificate module: self-signed/CA/CA-signed with SANs and purpose EKU; idempotent via resource(). @returns Module & CheckableModule. */
export const opensslCertModule: Module & CheckableModule = resource({
  name: "openssl_certificate",
  async describe(args, ctx: ModuleContext) {
    const a = args as unknown as OpenSSLCertArgs;
    const conn = ctx.connection;
    const bec = Boolean(ctx.become);
    if (a.state === "absent") {
      const cert = await readRemoteFile(conn, a.path, bec);
      const key = await readRemoteFile(conn, a.privatekey_path, bec);
      return { current: { cert: cert !== null, key: key !== null }, inDesired: cert === null && key === null };
    }
    if (a.force) return { current: null, inDesired: false };
    const cert = await readRemoteFile(conn, a.path, bec);
    if (cert === null) return { current: null, inDesired: false };
    const ok = await certMatches(conn, a, bec);
    return { current: { exists: true }, inDesired: ok };
  },
  async converge(args, ctx: ModuleContext): Promise<ModuleResult> {
    const a = args as unknown as OpenSSLCertArgs;
    const argBag = args as Record<string, unknown>;
    const conn = ctx.connection;
    const bec = Boolean(ctx.become);
    const dryRun = Boolean(a.dry_run) || Boolean(argBag["_check"]);

    if (a.state === "absent") {
      if (dryRun) return { changed: false, msg: `would remove ${a.path}` };
      const res = await conn.exec(becomeSh(`rm -f ${shQuote(a.path)} ${shQuote(a.privatekey_path)}`, bec));
      return {
        changed: (res.exitCode ?? 0) === 0,
        failed: (res.exitCode ?? 0) !== 0,
        msg: `removed ${a.path}`,
        stderr: res.stderr,
      };
    }

    const plan = buildCertPlan(a);
    if (dryRun) {
      return { changed: false, msg: `would run ${plan.commands.length} openssl command(s)`, data: { commands: plan.commands } };
    }
    if (plan.extfile) await writeRemoteFile(conn, plan.extfile.path, plan.extfile.content, bec);

    for (const cmd of plan.commands) {
      const res = await conn.exec(becomeSh(cmd, bec));
      if ((res.exitCode ?? 0) !== 0) {
        return {
          changed: false,
          failed: true,
          msg: `openssl failed: ${res.stderr || res.stdout}`,
          stdout: res.stdout,
          stderr: res.stderr,
        };
      }
    }
    return { changed: true, msg: `certificate written to ${a.path}`, data: { path: a.path } };
  },
});

(opensslCertModule as Module & CheckableModule & { meta: ModuleSummary }).meta = meta;
