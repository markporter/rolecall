// Targeted built-in fact gatherers added for Ansible magic-variable parity.

import { describe, expect, test } from "bun:test";
import type { Connection } from "../src/transport/connection";
import {
  dateTimeGatherer,
  defaultIpv4Gatherer,
  dnsGatherer,
  systemGatherer,
} from "../src/facts/gatherers";

class FakeConnection {
  readonly kind = "local";
  constructor(private readonly responses: Record<string, string>) {}
  async exec(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return { exitCode: 0, stdout: this.responses[command] ?? "", stderr: "" };
  }
}

const asConnection = (fake: FakeConnection): Connection => fake as unknown as Connection;

describe("built-in system facts", () => {
  test("parses distro, package manager, and service manager", async () => {
    const fake = new FakeConnection({
      "cat /etc/os-release": 'ID=ubuntu\nVERSION_ID="22.04"\nVERSION_CODENAME=jammy\n',
      "command -v apt-get >/dev/null 2>&1 && echo yes || echo no": "yes\n",
      "command -v systemctl >/dev/null 2>&1 && echo yes || echo no": "yes\n",
      "command -v dnf >/dev/null 2>&1 && echo yes || echo no": "no\n",
      "command -v yum >/dev/null 2>&1 && echo yes || echo no": "no\n",
      "command -v zypper >/dev/null 2>&1 && echo yes || echo no": "no\n",
      "command -v pacman >/dev/null 2>&1 && echo yes || echo no": "no\n",
      "command -v apk >/dev/null 2>&1 && echo yes || echo no": "no\n",
    });
    const facts = await systemGatherer.gather(asConnection(fake));
    expect(facts.distribution).toBe("ubuntu");
    expect(facts.distribution_version).toBe("22.04");
    expect(facts.distribution_major_version).toBe("22");
    expect(facts.distribution_release).toBe("jammy");
    expect(facts.pkg_mgr).toBe("apt");
    expect(facts.service_mgr).toBe("systemd");
  });
});

describe("built-in network facts", () => {
  test("parses the default IPv4 route", async () => {
    const fake = new FakeConnection({
      "ip -4 route get 1.1.1.1 2>/dev/null || true": "1.1.1.1 via 10.0.0.1 dev eth0 src 10.0.0.5 uid 0\n",
    });
    const facts = await defaultIpv4Gatherer.gather(asConnection(fake));
    expect(facts.default_ipv4).toEqual({ address: "10.0.0.5", interface: "eth0" });
  });

  test("parses resolv.conf", async () => {
    const fake = new FakeConnection({
      "cat /etc/resolv.conf": "nameserver 1.1.1.1\nnameserver 8.8.8.8\nsearch example.com\n",
    });
    const facts = await dnsGatherer.gather(asConnection(fake));
    expect(facts.dns).toEqual({ nameservers: ["1.1.1.1", "8.8.8.8"], search: ["example.com"], domain: undefined });
  });
});

describe("built-in date/time facts", () => {
  test("returns ISO-8601 and component fields", async () => {
    const fake = new FakeConnection({
      "date -u +%Y-%m-%dT%H:%M:%SZ": "2026-11-14T12:34:56Z\n",
      "date +%s": "1763123696\n",
      "date +%Y-%m-%d-%H-%M-%S": "2026-11-14-12-34-56\n",
    });
    const facts = await dateTimeGatherer.gather(asConnection(fake));
    expect(facts.date_time).toEqual({
      iso8601: "2026-11-14T12:34:56Z",
      epoch: 1763123696,
      year: "2026",
      month: "11",
      day: "14",
      hour: "12",
      minute: "34",
      second: "56",
      date: "2026-11-14",
      time: "12:34:56",
    });
  });
});
