import { CliError, type CliResult, type DocsModulesResult, type DocsSearchResult, type GlobalFlags } from "../types";
import { searchDocs } from "../../docs/search";
import { registerAllModules } from "../../modules/builtins";
import { searchModules } from "../../modules/search";

/** @summary Handle `rolecall docs <subcommand>`: dispatch to the search or modules listing. @param sub Subcommand token; one of "search" | "modules". @param rest Positional args; rest[0] is the query/filter term for the chosen subcommand. @param _flags Global flags (unused for docs; output selection is handled downstream by the output plugin). @returns A DocsSearchResult or DocsModulesResult rendered by the output plugin. */
export async function runDocsCommand(
  sub: string | undefined,
  rest: string[],
  _flags: GlobalFlags,
): Promise<CliResult> {
  if (sub === "search") {
    const query = rest[0];
    if (!query || query.trim().length === 0) {
      throw new CliError(true, "docs search requires a query term");
    }
    const res = await searchDocs(query);
    const result: DocsSearchResult = {
      command: "docs search",
      query: res.query,
      count: res.count,
      hits: res.hits,
    };
    return result;
  }

  if (sub === "modules") {
    // Ensure every built-in module has been registered so its `meta` is present.
    registerAllModules();
    const term = (rest[0] ?? "").trim();
    const modules = searchModules(term);
    const result: DocsModulesResult = {
      command: "docs modules",
      query: term,
      count: modules.length,
      modules,
    };
    return result;
  }

  throw new CliError(true, `unknown docs subcommand '${sub ?? ""}' (expected: search | modules)`);
}
