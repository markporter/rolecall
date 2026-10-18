/**
 * FsProjectSource — the local-disk {@link ProjectSource}. Reads project / infra-as-code
 * bytes straight from a directory using Node's `fs` (runtime-agnostic: identical under Bun
 * and Node), so default behavior — project on local disk — never changes. This is the only
 * ProjectSource implementation shipped today; git/S3 variants implement the same interface.
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep, basename } from "node:path";
import type { ProjectSource } from "./project-source.js";

/** Translate a small glob subset into an anchored RegExp (`*`,`**`,`?`; dots escaped). */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === undefined) continue;
    if (c === "*") {
      // `**` spans path segments; lone `*` stays within one segment.
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += ".";
    } else {
      // Escape regex metacharacters so literal dots etc. match verbatim.
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

/** True if a module specifier points inside the source tree rather than naming a registered module. */
function looksRelative(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../");
}

export class FsProjectSource implements ProjectSource {
  /** Absolute filesystem root this source serves from. Defaults to the current working directory. */
  public readonly root: string;

  /**
   * @param root Directory backing this source. Relative roots resolve against `process.cwd()`.
   *   When omitted the current working directory is used, preserving the historical
   *   "read from cwd" default exactly.
   */
  constructor(root: string = process.cwd()) {
    this.root = isAbsolute(root) ? normalize(root) : join(process.cwd(), root);
  }

  private abs(relPath: string): string {
    // Absolute inputs are normalized as-is (matching resolveImportablePath); relative
    // inputs join under the root. Note: `path.join` concatenates even with an absolute
    // second segment, so absolute `relPath` must be handled explicitly.
    return isAbsolute(relPath) ? normalize(relPath) : join(this.root, relPath);
  }

  async readText(relPath: string): Promise<string> {
    // Synchronous read inside an async fn throws synchronously on a missing file, which the
    // caller observes as a rejected promise — matching the interface contract.
    return readFileSync(this.abs(relPath), "utf8");
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      return statSync(this.abs(relPath)).isFile() || statSync(this.abs(relPath)).isDirectory();
    } catch {
      return false;
    }
  }

  async listFiles(glob?: string): Promise<string[]> {
    const all = this.walk(this.root);
    if (!glob) return all;
    const pattern = globToRegExp(glob);
    return all.filter((p) => pattern.test(p) || pattern.test(basename(p)));
  }

  /** Recursively collect posix-style relative paths of every file beneath `dir`, sorted. */
  private walk(dir: string): string[] {
    let out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        out = out.concat(this.walk(full));
      } else {
        out.push(relative(this.root, full).split(sep).join("/"));
      }
    }
    return out.sort();
  }

  resolveImportablePath(relPath: string): string {
    // Join under the root and normalize so `"./mod.ts"` -> `<root>/mod.ts`; absolute inputs pass through.
    return normalize(isAbsolute(relPath) ? relPath : join(this.root, relPath));
  }
}
