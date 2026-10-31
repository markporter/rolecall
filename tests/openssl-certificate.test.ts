// Unit tests for the `openssl_certificate` command builder (Todo 27).
// Exercises the pure `buildCertPlan` / `purposeToEKU` helpers so the openssl
// argument surface is locked down without needing the `openssl` CLI present.
// Bun-only MVP (bun test).

import { describe, expect, test } from "bun:test";
import { buildCertPlan, purposeToEKU, type OpenSSLCertArgs } from "../src/modules/builtins/openssl_certificate";

describe("purposeToEKU", () => {
  test("maps a single friendly purpose to EKU", () => {
    expect(purposeToEKU("server")).toEqual(["serverAuth"]);
    expect(purposeToEKU("client")).toEqual(["clientAuth"]);
    expect(purposeToEKU("codesign")).toEqual(["codeSigning"]);
    expect(purposeToEKU("email")).toEqual(["emailProtection"]);
    expect(purposeToEKU("timestamp")).toEqual(["timeStamping"]);
  });

  test("maps a comma list and passes through explicit EKU", () => {
    expect(purposeToEKU("server,client")).toEqual(["serverAuth", "clientAuth"]);
    expect(purposeToEKU(["codeSigning"])).toEqual(["codeSigning"]);
  });

  test("returns empty for undefined", () => {
    expect(purposeToEKU(undefined)).toEqual([]);
  });
});

describe("buildCertPlan — self-signed leaf", () => {
  const args: OpenSSLCertArgs = {
    path: "/etc/nginx/ssl/site.crt",
    privatekey_path: "/etc/nginx/ssl/site.key",
    common_name: "site1.example.com",
    san: ["DNS:site1.example.com"],
    days: 365,
    algorithm: "rsa",
    key_size: 2048,
    purpose: "server",
  };

  test("emits a single self-signed command with SAN + EKU + leaf constraints", () => {
    const plan = buildCertPlan(args);
    expect(plan.commands).toHaveLength(1);
    expect(plan.extfile).toBeUndefined();
    const c = plan.commands[0].replace(/'/g, "");
    expect(c).toContain("-x509");
    expect(c).toContain("-subj /CN=site1.example.com");
    expect(c).toContain("subjectAltName=DNS:site1.example.com");
    expect(c).toContain("extendedKeyUsage=serverAuth");
    expect(c).toContain("basicConstraints=critical,CA:FALSE");
    expect(c).toContain("keyUsage=critical,digitalSignature,keyEncipherment");
    expect(c).toContain("rsa:2048");
  });
});

describe("buildCertPlan — self-signed CA", () => {
  test("flags CA:TRUE and CA key usage, no extfile", () => {
    const plan = buildCertPlan({
      path: "/etc/ca/ca.crt",
      privatekey_path: "/etc/ca/ca.key",
      common_name: "My CA",
      ca: true,
      algorithm: "rsa",
    });
    expect(plan.commands).toHaveLength(1);
    expect(plan.extfile).toBeUndefined();
    const c = plan.commands[0];
    expect(c).toContain("basicConstraints=critical,CA:TRUE");
    expect(c).toContain("keyUsage=critical,keyCertSign,cRLSign");
  });
});

describe("buildCertPlan — CA-signed", () => {
  const base: OpenSSLCertArgs = {
    path: "/etc/nginx/ssl/site.crt",
    privatekey_path: "/etc/nginx/ssl/site.key",
    common_name: "site1.example.com",
    ca_cert: "/etc/ca/ca.crt",
    ca_key: "/etc/ca/ca.key",
    san: ["DNS:site1.example.com", "IP:10.0.0.1"],
    purpose: "client",
  };

  test("generates CSR then signs, with an extfile", () => {
    const plan = buildCertPlan(base);
    expect(plan.commands).toHaveLength(2);
    expect(plan.extfile).toBeDefined();
    expect(plan.extfile!.path).toBe("/etc/nginx/ssl/site.crt.ext");
    expect(plan.extfile!.content).toContain("[v3]");
    expect(plan.extfile!.content).toContain("subjectAltName=DNS:site1.example.com,IP:10.0.0.1");
    expect(plan.extfile!.content).toContain("extendedKeyUsage=clientAuth");
    expect(plan.commands[0].replace(/'/g, "")).toContain("req -newkey");
    expect(plan.commands[1].replace(/'/g, "")).toContain("x509 -req -in");
    expect(plan.commands[1].replace(/'/g, "")).toContain("-CA /etc/ca/ca.crt -CAkey /etc/ca/ca.key");
    expect(plan.commands[1].replace(/'/g, "")).toContain("-extfile /etc/nginx/ssl/site.crt.ext -extensions v3");
  });

  test("signs an existing CSR in a single command", () => {
    const plan = buildCertPlan({ ...base, csr: "/tmp/site.csr" });
    expect(plan.commands).toHaveLength(1);
    expect(plan.commands[0].replace(/'/g, "")).toContain("x509 -req -in /tmp/site.csr");
  });

  test("reuses an existing private key with req -new -key", () => {
    const plan = buildCertPlan(base, true);
    expect(plan.commands).toHaveLength(2);
    const req = plan.commands[0].replace(/'/g, "");
    expect(req).toContain("openssl req -new -key /etc/nginx/ssl/site.key");
    expect(req).not.toContain("-newkey");
    expect(req).not.toContain("-keyout");
  });

  test("generates a new key with -newkey when no key exists", () => {
    const plan = buildCertPlan(base, false);
    expect(plan.commands[0].replace(/'/g, "")).toContain("req -newkey");
  });

  test("writes the CSR to csr_path and defaults it to <path>.csr", () => {
    const custom = buildCertPlan({ ...base, csr_path: "/etc/nginx/ssl/custom.csr" });
    expect(custom.commands[0].replace(/'/g, "")).toContain("/etc/nginx/ssl/custom.csr");
    const fallback = buildCertPlan(base);
    expect(fallback.commands[0].replace(/'/g, "")).toContain("/etc/nginx/ssl/site.crt.csr");
  });

  test("signs a CSR that already exists at csr_path without regenerating it", () => {
    const plan = buildCertPlan({ ...base, csr_path: "/etc/nginx/ssl/custom.csr" }, true, true);
    expect(plan.commands).toHaveLength(1);
    expect(plan.commands[0].replace(/'/g, "")).toContain("x509 -req -in /etc/nginx/ssl/custom.csr");
  });
});

describe("buildCertPlan — digest", () => {
  test("defaults to sha256", () => {
    expect(buildCertPlan({ path: "c", privatekey_path: "k" }).commands[0]).toContain("-sha256");
  });

  test("digest sha384 applies to self-signed and CA paths", () => {
    const self = buildCertPlan({ path: "c", privatekey_path: "k", common_name: "x", digest: "sha384" });
    expect(self.commands[0].replace(/'/g, "")).toContain("-sha384");

    const ca = buildCertPlan({
      path: "c",
      privatekey_path: "k",
      common_name: "x",
      ca_cert: "/ca.crt",
      ca_key: "/ca.key",
      digest: "sha384",
    });
    expect(ca.commands[0].replace(/'/g, "")).toContain("-sha384");
    const sign = ca.commands[1].replace(/'/g, "");
    expect(sign).toContain("x509 -req");
    expect(sign).toContain("-sha384");
  });
});

describe("buildCertPlan — subject_alt_name alias", () => {
  test("feeds SANs when san is absent", () => {
    const plan = buildCertPlan({
      path: "c",
      privatekey_path: "k",
      subject_alt_name: ["DNS:alias.example.com", "IP:10.0.0.9"],
    });
    expect(plan.commands[0].replace(/'/g, "")).toContain("subjectAltName=DNS:alias.example.com,IP:10.0.0.9");
  });

  test("san wins when both are set", () => {
    const plan = buildCertPlan({
      path: "c",
      privatekey_path: "k",
      san: ["DNS:preferred.example.com"],
      subject_alt_name: ["DNS:alias.example.com"],
    });
    const c = plan.commands[0].replace(/'/g, "");
    expect(c).toContain("subjectAltName=DNS:preferred.example.com");
    expect(c).not.toContain("alias.example.com");
  });
});

describe("buildCertPlan — key algorithms", () => {
  test("rsa key size, ecdsa curve, ed25519", () => {
    expect(buildCertPlan({ path: "c", privatekey_path: "k", algorithm: "rsa", key_size: 4096 }).commands[0]).toContain("rsa:4096");
    expect(buildCertPlan({ path: "c", privatekey_path: "k", algorithm: "ecdsa", curve: "secp384r1" }).commands[0]).toContain("ecdsa:secp384r1");
    expect(buildCertPlan({ path: "c", privatekey_path: "k", algorithm: "ed25519" }).commands[0]).toContain("ed25519");
  });

  test("defaults to rsa:2048 when unspecified", () => {
    expect(buildCertPlan({ path: "c", privatekey_path: "k" }).commands[0]).toContain("rsa:2048");
  });
});
