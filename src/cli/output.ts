// Output-plugin registry (Wave 1, Todo 5).
//
// Pluggable renderers selected via the global `--output <plugin>` flag. Three
// built-ins ship registered:
//   - "human_summary" : readable end-of-run text summary for humans
//   - "syslog"        : realtime per-task structured JSON lines (DEFAULT)
//   - "json"          : structured, DETERMINISTICALLY SORTED JSON (stable across runs)
//
// Determinism: the `json` plugin deep-sorts every object key (host names + var
// keys) before stringifying, so integration tests get stable stdout. The
// inventory engine already sorts host/var keys; this is a second safety net.
//
// No transport / templating. Pure serialization boundary.

import type { CliResult } from "./types";

// ---------------------------------------------------------------------------
// Plugin interface + registry
// ---------------------------------------------------------------------------
/** @summary Pluggable output renderer selected via the global `--output <plugin>` flag. */
export interface OutputPlugin {
  readonly name: string;
  render(data: CliResult): string;
}

const registry = new Map<string, OutputPlugin>();

/** Register an output plugin under its `name`, replacing any existing entry. */
export function registerOutputPlugin(plugin: OutputPlugin): void {
  registry.set(plugin.name, plugin);
}

/** Look up a registered output plugin by name, or undefined if none exists. */
export function getOutputPlugin(name: string): OutputPlugin | undefined {
  return registry.get(name);
}

/** Sorted list of registered output-plugin names. */
export function listOutputPlugins(): string[] {
  return [...registry.keys()].sort();
}

/** Render `data` through the named plugin. Throws on an unknown plugin name
 *  (the dispatcher validates the name BEFORE calling this, so this is a guard). */

/** @summary Render a CliResult through the output plugin identified by name. @param name Registered plugin name (@see listOutputPlugins). @param data Result payload to render. @returns Rendered string; throws Error if the plugin name is unknown. */
export function renderOutput(name: string, data: CliResult): string {
  const plugin = getOutputPlugin(name);
  if (!plugin) {
    throw new Error(
      `unknown output plugin: ${name} (available: ${listOutputPlugins().join(", ")})`,
    );
  }
  return plugin.render(data);
}

// ---------------------------------------------------------------------------
// Determinism helper: recursively sort object keys (arrays preserved in order).
// ---------------------------------------------------------------------------
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Built-in: json plugin (stable, sorted)
// ---------------------------------------------------------------------------
function renderJson(data: CliResult): string {
  if (data.command === "agent manifest") {
    return `${JSON.stringify(sortDeep(data.manifest), null, 2)}\n`;
  }
  return `${JSON.stringify(sortDeep(data), null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Built-in: human_summary plugin (readable end-of-run text)
// ---------------------------------------------------------------------------
function formatHuman(data: CliResult): string {
  const lines: string[] = [];
  switch (data.command) {
    case "playbook run": {
      const suffix = `${data.check ? " (+check)" : ""}${data.force ? " (+force)" : ""}`;
      lines.push(`Playbook : ${data.playbook}`);
      if (data.inventory) lines.push(`Inventory: ${data.inventory}`);
      lines.push(`Mode    : ${data.mode}${suffix}`);
      lines.push(
        `Hosts    : ${data.resolvedHosts.length} resolved ` +
          `(${data.resolvedHosts.join(", ") || "none"})`,
      );
      lines.push(`Tasks    : ${data.tasks.length}`);
      for (const t of data.tasks) lines.push(`  - ${t.name} [${t.module}]`);
      lines.push(`Skeleton : ${data.skeleton.length} host x task pair(s)`);
      for (const s of data.skeleton) {
        lines.push(`  ${s.host} :: ${s.task} (${s.module})`);
      }
      if (data.totals) {
        lines.push(
          `Summary  : ok=${data.totals.ok} changed=${data.totals.changed} ` +
            `failed=${data.totals.failed} skipped=${data.totals.skipped}`,
        );
        lines.push("Outcomes:");
        for (const o of data.outcomes ?? []) {
          const tag = o.failed
            ? "FAIL"
            : o.skipped
              ? "SKIP"
              : o.changed
                ? "CHANGED"
                : "ok   ";
          lines.push(
            `  [${tag}] ${o.host} :: ${o.task} (${o.module}) -> ${o.msg ?? "-"}`,
          );
        }
      }
      if (data.rendered && data.rendered.length > 0) {
        lines.push("Rendered templates:");
        for (const r of data.rendered) {
          lines.push(`  [${r.engine}] ${r.task} (@${r.host}):`);
          for (const ln of r.rendered.split("\n")) {
            lines.push(`      ${ln.replace(/\s+$/, "")}`);
          }
        }
      }
      lines.push(`Note     : ${data.note}`);
      break;
    }
    case "facts gather": {
      lines.push(`Facts gather from: ${data.inventory}`);
      if (data.limit) lines.push(`Limit : ${data.limit}`);
      lines.push(
        `Hosts : ${data.resolvedHosts.length} resolved ` +
          `(${data.resolvedHosts.join(", ") || "none"})`,
      );
      const factHosts = Object.keys(data.facts ?? {});
      if (factHosts.length > 0) {
        lines.push(`Collected (${factHosts.length}):`);
        for (const h of factHosts) {
          const entries = Object.entries(data.facts[h] ?? {});
          const summary = entries
            .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
            .join(", ");
          lines.push(`  - ${h}: ${summary || "(empty)"}`);
        }
      }
      if (Object.keys(data.failures ?? {}).length > 0) {
        lines.push("Failures:");
        for (const [h, e] of Object.entries(data.failures)) {
          lines.push(`  ! ${h}: ${e}`);
        }
      }
      lines.push(`Note  : ${data.note}`);
      break;
    }
    case "inventory show": {
      lines.push(`Inventory: ${data.inventory}`);
      lines.push(`Hosts (${data.matchedHosts.length}):`);
      for (const host of data.matchedHosts) {
        const vars = data.hosts[host] ?? {};
        const varStr = Object.entries(vars)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(" ");
        lines.push(`  - ${host}: ${varStr}`);
      }
      break;
    }
    case "inventory list": {
      lines.push(`Inventory: ${data.inventory}`);
      lines.push(`Groups (${data.groups.length}): ${data.groups.join(", ")}`);
      break;
    }
    case "plugin list": {
      lines.push(`Registered plugins (${data.plugins.length}):`);
      for (const p of data.plugins) {
        const detail = p.path
          ? ` (${p.type}, ${p.source}) -> ${p.path}`
          : ` (${p.type}, ${p.source})`;
        lines.push(`  - ${p.name}${detail}`);
      }
      lines.push(`Note: ${data.note}`);
      break;
    }
    case "plugin register": {
      lines.push(`plugin register: ${data.registered ? "ok" : "fail"}`);
      lines.push(`  name : ${data.name}`);
      lines.push(`  type : ${data.type}`);
      lines.push(`  path : ${data.path}`);
      lines.push(`Note: ${data.note}`);
      break;
    }
    case "agent manifest": {
      lines.push(JSON.stringify(sortDeep(data.manifest), null, 2));
      break;
    }
    case "docs search": {
      lines.push(`Query : ${data.query}`);
      lines.push(`Hits  : ${data.count}`);
      for (const h of data.hits) {
        lines.push(`  ${h.file} :: ${h.heading} (line ${h.line})`);
        lines.push(`    ${h.snippet}`);
      }
      break;
    }
    case "docs modules": {
      const scope = data.query ? ` matching '${data.query}'` : "";
      lines.push(`Modules${scope}: ${data.count}`);
      for (const m of data.modules) {
        lines.push(`  - ${m.name}`);
        lines.push(`      ${m.description}`);
        if (m.idempotent) lines.push(`      [idempotent]`);
        if (m.args && Object.keys(m.args).length > 0) {
          lines.push(`      args:`);
          for (const [arg, info] of Object.entries(m.args)) {
            const req = info.required ? "required" : "optional";
            lines.push(`        - ${arg} (${info.type}, ${req}): ${info.description}`);
          }
        }
      }
      break;
    }
    case "vars list": {
      const total = data.declared.reduce((n, g) => n + g.entries.length, 0);
      lines.push(`Vars declared (${total} total):`);
      for (const group of data.declared) {
        lines.push(`  ${group.file}:`);
        for (const e of group.entries) {
          const flags = [e.required ? "required" : "optional"].join(", ");
          lines.push(
            `    - ${e.name} (${e.kind}, ${flags}) :: ${e.type} = ${JSON.stringify(e.default)}`,
          );
        }
      }
      lines.push("Fact capability per connection kind:");
      for (const k of Object.keys(data.factsByKind).sort()) {
        const facts = (data.factsByKind as Record<string, string[]>)[k] ?? [];
        lines.push(`  ${k} (${facts.length}): ${facts.join(", ") || "(none)"}`);
      }
      break;
    }
    case "vars trace": {
      for (const play of data.plays) {
        lines.push(`Play${play.name ? `: ${play.name}` : ""}:`);
        const hostNames = Object.keys(play.hosts).sort();
        if (hostNames.length === 0) {
          lines.push("  (no resolved hosts)");
          continue;
        }
        for (const host of hostNames) {
          lines.push(`  ${host}:`);
          const vars = play.hosts[host];
          if (!vars) {
            lines.push("    (no vars)");
            continue;
          }
          const names = Object.keys(vars).sort();
          if (names.length === 0) {
            lines.push("    (no vars)");
            continue;
          }
          for (const name of names) {
            const r = vars[name];
            if (!r) continue;
            const where = r.file ? ` @ ${r.file}` : "";
            lines.push(`    - ${name} = ${JSON.stringify(r.value)}  [${r.tier}${where}]`);
            if (r.chain.length > 1) {
              const chain = r.chain
                .map((c) => `${c.tier}${c.file ? `:${c.file}` : ""}`)
                .join(" < ");
              lines.push(`        override chain: ${chain}`);
            }
          }
        }
      }
      break;
    }
    default: {
      // Exhaustiveness guard — every CliResult variant is handled above.
      lines.push(JSON.stringify(data));
    }
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Register built-ins.
// ---------------------------------------------------------------------------
registerOutputPlugin({ name: "human_summary", render: formatHuman });

// ---------------------------------------------------------------------------
// Built-in: syslog plugin (realtime per-task structured JSON lines).
//
// The live per-task streaming is performed by the CLI's realtime event sink
// (wired in the playbook command handler) so lines are emitted AS tasks run.
// Because those events are already flushed to stdout immediately, the terminal
// `render` of the end-of-run CliResult is a no-op (it would only duplicate the
// streamed lines). The plugin still exists so `-o syslog` resolves + validates.
// ---------------------------------------------------------------------------

/** @summary Render a playbook/run CliResult as syslog. The realtime per-task JSON lines are emitted live by the CLI event sink; this terminal render is intentionally empty to avoid duplicating them. @param _data Result payload (unused; events streamed live). @returns Empty string. */
function renderSyslog(_data: CliResult): string {
  return "";
}

registerOutputPlugin({ name: "syslog", render: renderSyslog });
registerOutputPlugin({ name: "json", render: renderJson });
