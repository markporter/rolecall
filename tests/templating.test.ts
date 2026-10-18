import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  clearFilters,
  clearTemplateCache,
  getCompiled,
  getFilter,
  getTemplateCacheStats,
  listFilters,
  registerFilter,
  render,
} from "../src/templating/index";

beforeEach(() => {
  clearFilters();
  clearTemplateCache();
});

afterEach(() => {
  clearFilters();
  clearTemplateCache();
});

describe("fast templating — variable rendering", () => {
  it("renders provided vars into the template deterministically", () => {
    const out = render("Hello <%= name %>, you are <%= age %>", {
      name: "bob",
      age: 42,
    });
    expect(out).toBe("Hello bob, you are 42");
  });

  it("returns identical output across repeated renders (deterministic)", () => {
    const vars = { name: "alice", role: "admin" };
    const a = render("<%= name %>:<%= role %>", vars);
    const b = render("<%= name %>:<%= role %>", vars);
    expect(a).toBe(b);
    expect(a).toBe("alice:admin");
  });
});

describe("fast templating — shared filter registry", () => {
  it("applies a registered filter as {{ name(arg) }}", () => {
    registerFilter("upper", (s) => String(s).toUpperCase());
    const out = render("Hi <%= upper(name) %>", { name: "bob" });
    expect(out).toBe("Hi BOB");
  });

  it("passes multiple args to a filter", () => {
    registerFilter("repeat", (s, n) => String(s).repeat(Number(n)));
    const out = render("<%= repeat(word, count) %>", {
      word: "ab",
      count: 3,
    });
    expect(out).toBe("ababab");
  });

  it("exposes the same registry both fast mode and (future) Jinja mode read from", () => {
    registerFilter("trim", (s) => String(s).trim());
    expect(getFilter("trim") !== undefined).toBe(true);
    expect(listFilters()).toContain("trim");
    // The filter is a plain callable usable directly too (single source of truth).
    const fn = getFilter("trim");
    expect(fn?.("  x  ")).toBe("x");
  });

  it("reflects registered filters in listFilters (sorted, deterministic)", () => {
    registerFilter("zeta", (s) => s);
    registerFilter("alpha", (s) => s);
    expect(listFilters()).toEqual(["alpha", "zeta"]);
  });
});

describe("fast templating — compile cache", () => {
  it("compiles each distinct template exactly once (cache hit reuses fn)", () => {
    const tpl = "value=<%= v %>";
    const before = getTemplateCacheStats().compiles;
    const first = render(tpl, { v: 1 });
    const afterFirst = getTemplateCacheStats();
    expect(afterFirst.compiles).toBe(before + 1);

    const fnBefore = getCompiled(tpl);
    const second = render(tpl, { v: 2 });
    const fnAfter = getCompiled(tpl);

    // Same cached function object => no recompile on the second render.
    expect(fnAfter).toBe(fnBefore);
    expect(getTemplateCacheStats().compiles).toBe(before + 1);
    expect(first).toBe("value=1");
    expect(second).toBe("value=2");
  });

  it("compiles separate templates independently", () => {
    render("a=<%= x %>", { x: 1 });
    render("b=<%= y %>", { y: 2 });
    expect(getTemplateCacheStats().size).toBe(2);
    expect(getTemplateCacheStats().compiles).toBe(2);
  });
});

describe("fast templating — lenient undefined (H4 fix)", () => {
  it("does NOT throw on an undefined top-level var and renders as empty", () => {
    let out = "";
    expect(() => {
      out = render("x=[<%= missing %>]", { present: "yes" });
    }).not.toThrow();
    expect(out).toBe("x=[]");
  });

  it("does NOT throw on an undefined nested path (a.b.c) and renders as empty", () => {
    let out = "";
    expect(() => {
      out = render("n=[<%= a.b.c %>]", {});
    }).not.toThrow();
    expect(out).toBe("n=[]");
  });

  it("is deterministic for undefined vars across renders", () => {
    const a = render("u=<%= nope %>", {});
    const b = render("u=<%= nope %>", {});
    expect(a).toBe(b);
    expect(a).toBe("u=");
  });

  it("tolerates a filter applied to an undefined arg without throwing", () => {
    registerFilter("upper", (s) => String(s).toUpperCase());
    let out = "";
    expect(() => {
      out = render("u=<%= upper(absent) %>", {});
    }).not.toThrow();
    expect(out).toBe("u=");
  });
});

describe("fast templating — nested + control flow", () => {
  it("resolves nested variable access", () => {
    const out = render("city=<%= user.address.city %>", {
      user: { address: { city: "Berlin" } },
    });
    expect(out).toBe("city=Berlin");
  });

  it("evaluates a conditional branch for defined values", () => {
    const tpl = "<% if (on) { %>ON<% } else { %>OFF<% } %>";
    expect(render(tpl, { on: true })).toBe("ON");
    expect(render(tpl, { on: false })).toBe("OFF");
  });

  it("does not throw on a conditional over an undefined var (lenient)", () => {
    const tpl = "<% if (missing) { %>ON<% } else { %>OFF<% } %>";
    expect(() => render(tpl, {})).not.toThrow();
  });

  it("evaluates a loop over a provided list", () => {
    const tpl = "<% for (const item of items) { %><%= item %>;<% } %>";
    expect(render(tpl, { items: ["a", "b", "c"] })).toBe("a;b;c;");
  });
});
