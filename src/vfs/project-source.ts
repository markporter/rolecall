/**
 * ProjectSource — the VFS seam through which RoleCall reads project / infra-as-code
 * bytes: playbooks, inventory manifests, and user-authored modules (`module: ./path`).
 *
 * Implementations select WHERE those bytes come from. {@link FsProjectSource} is the
 * only implementation today (local disk); `GitProjectSource` and `S3ProjectSource` are
 * designed-in and deferred (same interface, selected later by env var). Nothing here
 * applies remote state — this is strictly a read / resolve surface. See
 * design/vfs-and-io-abstractions.md for the full backend matrix.
 */
export interface ProjectSource {
  /** Read UTF-8 text at `relPath` (relative to {@link root}). Rejects if the path does not exist. */
  readText(relPath: string): Promise<string>;

  /** True iff an entry exists at `relPath` under the source root. */
  exists(relPath: string): Promise<boolean>;

  /**
   * List logical file paths under the source root as POSIX `/`-separated strings, sorted.
   * With no `glob`, every file is returned recursively. With a glob, only matching relative
   * paths remain: `*` matches any run of characters within one path segment, `**` matches across
   * segments, `?` matches a single character; a pattern without a separator also matches by
   * basename in any directory (so `"*.yaml"` lists YAML files anywhere under the root).
   * @param glob Optional glob restricting which files are listed.
   * @returns Sorted posix-style relative paths matching the query.
   */
  listFiles(glob?: string): Promise<string[]>;

  /**
   * Resolve a module specifier or relative path to its absolute location under the source
   * root so `import()` can load it unchanged across runtime backends. `"./mod.ts"` yields
   * `<root>/mod.ts`. Absolute inputs pass through normalized.
   * @param relPath A relative (or absolute) module path.
   * @returns An absolute filesystem path rooted at {@link root}.
   */
  resolveImportablePath(relPath: string): string;

  /** Absolute filesystem root this source serves from. */
  readonly root: string;
}
