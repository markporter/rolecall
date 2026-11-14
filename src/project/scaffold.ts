// Minimal ADR 0030 project scaffold used by `convert ansible --project`.
//
// Creates the documented folder-project shape without overwriting anything that
// already exists. This is intentionally narrower than the full `project create`
// wizard (no VCS, template picker, or interactive prompts).

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

/** Plugin type directories scanned by `src/modules/scanner.ts`. */
const PLUGIN_TYPES = ["modules", "connection_types", "callbacks", "inventory", "facts"] as const;

/** Options for {@link ensureProjectScaffold}. */
export interface ScaffoldOptions {
  /** Human-readable project name written to `rolecall.yaml` (default: directory basename). */
  name?: string;
  /** Namespace used for `plugins/<type>/<namespace>/` (default: slug of the name). */
  namespace?: string;
}

/** Result of a scaffold pass. */
export interface ScaffoldResult {
  root: string;
  name: string;
  namespace: string;
  /** Paths created by this pass (existing paths are not listed). */
  created: string[];
}

/** Convert a project name into a safe plugin namespace slug. */
export function namespaceSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
}

function ensureDir(path: string, created: string[]): void {
  if (existsSync(path)) return;
  mkdirSync(path, { recursive: true });
  created.push(path);
}

function ensureFile(path: string, content: string, created: string[]): void {
  if (existsSync(path)) return;
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
  created.push(path);
}

function isEmptyDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory() && readdirSync(path).length === 0;
  } catch {
    return false;
  }
}

/**
 * @summary Ensure a blank RoleCall project exists at `root`, creating the documented ADR 0014/0030 layout and only writing files/directories that are missing.
 * @param root Project root directory.
 * @param options Optional project name and plugin namespace.
 * @returns The resolved name/namespace and the paths created by this pass.
 */
export function ensureProjectScaffold(root: string, options: ScaffoldOptions = {}): ScaffoldResult {
  const name = options.name ?? basename(root);
  const namespace = options.namespace ?? namespaceSlug(name);
  const created: string[] = [];
  const rootExisted = existsSync(root);
  if (!rootExisted || isEmptyDirectory(root)) {
    ensureDir(root, created);
  } else if (!statSync(root).isDirectory()) {
    throw new Error(`project scaffold: ${root} exists and is not a directory`);
  }

  for (const dir of [
    "playbooks",
    "inventory",
    "plugins",
    "roles",
    "group_vars",
    "host_vars",
    "collections",
    ".rolecall",
  ]) {
    ensureDir(join(root, dir), created);
  }
  for (const type of PLUGIN_TYPES) {
    ensureDir(join(root, "plugins", type, namespace), created);
  }

  ensureFile(
    join(root, "rolecall.yaml"),
    `name: ${JSON.stringify(name)}\n`,
    created,
  );
  ensureFile(
    join(root, "README.md"),
    `# ${name}\n\nCreated by \`rolecall convert ansible --project\`.\n\n\`\`\`sh\nrolecall playbook run playbooks/site.yaml --inventory inventory/inventory.yaml\n\`\`\`\n`,
    created,
  );
  if (!existsSync(join(root, "inventory")) || readdirSync(join(root, "inventory")).length === 0) {
    ensureFile(
      join(root, "inventory", "inventory.yaml"),
      `groups:\n  all:\n    hosts:\n      - localhost\n    vars:\n      rolecall_connection: local\n`,
      created,
    );
  }
  ensureFile(join(root, ".rolecall", "isolation.yaml"), "version: 1\n", created);
  ensureFile(
    join(root, "collections.yml"),
    `# RoleCall-native collections are vendored under collections/<org>/<coll>/.\n# See ADR 0015. This placeholder is intentionally commented out until you add one.\n# collections: []\n`,
    created,
  );

  return { root, name, namespace, created };
}
