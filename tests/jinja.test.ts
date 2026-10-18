import { describe, it, expect } from "bun:test";
import {
  renderJinja,
  registerFilter,
  clearFilters,
  hasFilter,
} from "../src/templating/index.js";

describe("jinja mode (LiquidJS)", () => {
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

  it("(c) renders undefined variables leniently (no throw) by default", () => {
    // Undefined top-level var -> empty string, no exception.
    expect(renderJinja(`{{ missing }}`)).toBe("");
    // Undefined nested path -> empty string, no exception.
    expect(renderJinja(`{{ a.b.c }}`, {})).toBe("");
    // Undefined var inside a conditional does not throw in lenient mode.
    expect(renderJinja(`{% if ghost %}yes{% else %}no{% endif %}`)).toBe("no");
  });

  it("(d) strict opt-in throws on undefined variable", () => {
    expect(() => renderJinja(`{{ missing }}`, {}, { strict: true })).toThrow();
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
