import { describe, it, expect } from "bun:test";
import {
  renderJinja,
  registerFilter,
  clearFilters,
  hasFilter,
} from "../src/templating/index.js";

describe("jinja mode (Nunjucks + Ansible compatibility)", () => {
  it("(a) renders {% if %} and {% for %} control flow", () => {
    const tpl = `{% if active %}on{% else %}off{% endif %}`;
    expect(renderJinja(tpl, { active: true })).toBe("on");
    expect(renderJinja(tpl, { active: false })).toBe("off");

    const loop = `{% for n in items %}{{ n }}{% endfor %}`;
    expect(renderJinja(loop, { items: [1, 2, 3] })).toBe("123");
  });

  it("(b) applies a filter registered in the shared registry", () => {
    clearFilters();
    // Register once in the shared registry — must work in jinja mode.
    registerFilter("shout", (...args: unknown[]) => {
      const [value] = args;
      return String(value ?? "").toUpperCase() + "!";
    });
    expect(hasFilter("shout")).toBe(true);

    const out = renderJinja(`{{ name | shout }}`, { name: "rolecall" });
    expect(out).toBe("ROLECALL!");
  });

  it("(c) renders undefined variables leniently when strict:false", () => {
    expect(renderJinja(`{{ missing }}`, {}, { strict: false })).toBe("");
    expect(renderJinja(`{{ a.b.c }}`, {}, { strict: false })).toBe("");
    expect(renderJinja(`{% if ghost %}yes{% else %}no{% endif %}`, {}, { strict: false })).toBe("no");
  });

  it("(d) is strict by default and throws on undefined variables", () => {
    expect(() => renderJinja(`{{ missing }}`)).toThrow();
    expect(() => renderJinja(`{{ a.b.c }}`, {})).toThrow();
  });

  it("supports Jinja macros and loop.index", () => {
    const tpl = `{% macro row(n, i) %}{{ n }}:{{ i }} {% endmacro %}{% for n in items %}{{ row(n, loop.index) }}{% endfor %}`;
    expect(renderJinja(tpl, { items: ["a", "b"] })).toBe("a:1 b:2 ");
  });

  it("implements common Ansible filters", () => {
    expect(renderJinja(`{{ missing | default("fallback") }}`)).toBe("fallback");
    expect(renderJinja(`{{ "" | default("fallback", true) }}`)).toBe("fallback");
    expect(renderJinja(`{{ "yes" | bool }}`)).toBe("true");
    expect(renderJinja(`{{ {"a": 1} | to_json }}`)).toBe('{"a":1}');
    expect(renderJinja(`{{ '{"a":2}' | from_json | to_json }}`)).toBe('{"a":2}');
    expect(renderJinja(`{% for i in d | dict2items %}{{ i.key }}={{ i.value }}{% endfor %}`, { d: { a: 1 } })).toBe("a=1");
    expect(renderJinja(`{{ [1, [2, [3]]] | flatten(1) | to_json }}`)).toBe("[1,2,[3]]");
    expect(renderJinja(`{{ [1, 2, 2, 3] | unique | to_json }}`)).toBe("[1,2,3]");
    expect(renderJinja(`{{ base | combine(extra, true) | to_json }}`, { base: { a: { b: 1 } }, extra: { a: { c: 2 } } })).toBe('{"a":{"b":1,"c":2}}');
    expect(renderJinja(`{{ "a-b-c" | regex_replace("-", "_") }}`)).toBe("a_b_c");
    expect(renderJinja(`{{ "hello" | b64encode }}`)).toBe("aGVsbG8=");
    expect(renderJinja(`{{ "/srv/app.conf" | basename }}`)).toBe("app.conf");
    expect(renderJinja(`{{ true | ternary("yes", "no") }}`)).toBe("yes");
    expect(renderJinja(`{{ 3.5 | type_debug }}`)).toBe("float");
  });

  it("implements Ansible tests (defined/none/version_compare)", () => {
    expect(renderJinja(`{% if missing is defined %}yes{% else %}no{% endif %}`)).toBe("no");
    expect(renderJinja(`{% if value is defined %}yes{% else %}no{% endif %}`, { value: 1 })).toBe("yes");
    expect(renderJinja(`{% if value is none %}yes{% else %}no{% endif %}`, { value: null })).toBe("yes");
    expect(renderJinja(`{{ "1.10" | version_compare("1.2", ">") }}`)).toBe("true");
    expect(renderJinja(`{% if "abc" is search("b") %}yes{% else %}no{% endif %}`)).toBe("yes");
  });

  it("reuses the SAME registry as fast mode (no second registry)", () => {
    clearFilters();
    // A filter registered here is visible to jinja via the shared registry.
    registerFilter("double", (...args: unknown[]) => {
      const [value] = args;
      return Number(value) * 2;
    });
    expect(renderJinja(`{{ n | double }}`, { n: 21 })).toBe("42");
  });
});

describe("Ansible filters/tests added for conversion", () => {
  it("ipaddr handles IPv4 CIDR queries", () => {
    expect(renderJinja(`{{ "192.168.1.10/24" | ipaddr("network") }}`)).toBe("192.168.1.0");
    expect(renderJinja(`{{ "192.168.1.10/24" | ipaddr("prefix") }}`)).toBe("24");
    expect(renderJinja(`{{ "192.168.1.10/24" | ipaddr("broadcast") }}`)).toBe("192.168.1.255");
    expect(renderJinja(`{{ "192.168.1.10/24" | ipaddr("network/prefix") }}`)).toBe("192.168.1.0/24");
  });

  it("strftime and human_readable", () => {
    expect(renderJinja(`{{ "2026-11-14T12:34:56Z" | strftime("%Y-%m-%d") }}`)).toBe("2026-11-14");
    expect(renderJinja(`{{ 1536 | human_readable }}`)).toBe("1.50 KB");
    expect(renderJinja(`{{ 8 | human_readable(true) }}`)).toBe("1 B");
  });

  it("password_hash is deterministic", () => {
    const a = renderJinja(`{{ "secret" | password_hash("sha256", "salt") }}`);
    const b = renderJinja(`{{ "secret" | password_hash("sha256", "salt") }}`);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("iterable/mapping and result-state tests", () => {
    expect(renderJinja(`{% if [1] is iterable %}yes{% endif %}`)).toBe("yes");
    expect(renderJinja(`{% if {"a": 1} is mapping %}yes{% endif %}`)).toBe("yes");
    expect(renderJinja(`{% if reg.ok is succeeded %}yes{% endif %}`, { reg: { ok: { failed: false } } })).toBe("yes");
    expect(renderJinja(`{% if reg.bad is failed %}yes{% endif %}`, { reg: { bad: { failed: true } } })).toBe("yes");
    expect(renderJinja(`{% if reg.c is changed %}yes{% endif %}`, { reg: { c: { changed: true } } })).toBe("yes");
    expect(renderJinja(`{% if reg.r is running %}yes{% endif %}`, { reg: { r: { running: true } } })).toBe("yes");
  });
});
