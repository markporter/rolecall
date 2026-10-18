// Projects repository (Todo 19). Typed CRUD over the `projects` table.
// All mutations are serialized through the shared write chain so two writers can
// never interleave their statements; reads bypass the chain freely.
//
// Statements are plain parameterized SQL executed over the runtime-selected PAL
// SqliteDb (bun:sqlite / node:sqlite): every value is bound positionally, so no user
// input is ever string-concatenated into SQL. Read-modify-write updates run inside a
// BEGIN IMMEDIATE span so two connections on one file cannot lose a write.

import { randomUUID } from "node:crypto";
import type { SqliteDb, SqliteRow } from "../pal";
import type { WriteQueue } from "./write-chain";
import { execute, selectAll, selectOne, transactional, type StoreRow } from "./sql";
import type {
  CreateProjectInput,
  Project,
  ProjectsRepo,
  UpdateProjectPatch,
} from "./types";

function rowToProject(row: SqliteRow): Project {
  return {
    id: String(row.id),
    path: String(row.path),
    inventoryRef: row.inventoryRef != null ? String(row.inventoryRef) : undefined,
    playbookRef: row.playbookRef != null ? String(row.playbookRef) : undefined,
    vars: typeof row.vars === "string" && row.vars.length > 0 ? JSON.parse(row.vars) : {},
    history: typeof row.history === "string" && row.history.length > 0 ? JSON.parse(row.history) : [],
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

export class ProjectsRepository implements ProjectsRepo {
  readonly #db: SqliteDb;
  readonly #writes: WriteQueue;

  /** @param db Runtime-selected synchronous sqlite connection shared with every repository. @param writes Shared single-writer serialization queue owned by StoreImpl. */
  constructor(db: SqliteDb, writes: WriteQueue) {
    this.#db = db;
    this.#writes = writes;
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const ts = Date.now();
    const rec = {
      id: randomUUID(),
      path: input.path,
      inventoryRef: input.inventoryRef ?? null,
      playbookRef: input.playbookRef ?? null,
      vars: input.vars ?? {},
      history: input.history ?? [],
      createdAt: ts,
      updatedAt: ts,
    };
    return this.#writes.enqueue(async (): Promise<Project> => {
      execute(
        this.#db,
        "INSERT INTO projects (id, path, inventoryRef, playbookRef, vars, history, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [rec.id, rec.path, rec.inventoryRef, rec.playbookRef, JSON.stringify(rec.vars), JSON.stringify(rec.history), rec.createdAt, rec.updatedAt],
      );
      // Just inserted under the lock, so it is guaranteed present.
      const row = selectOne<StoreRow>(this.#db, "SELECT * FROM projects WHERE id = ?", [rec.id]);
      return row ? rowToProject(row) : ({ id: rec.id, path: rec.path } as Project);
    });
  }

  async get(id: string): Promise<Project | null> {
    const row = selectOne<StoreRow>(this.#db, "SELECT * FROM projects WHERE id = ?", [id]);
    return row ? rowToProject(row) : null;
  }

  async list(): Promise<Project[]> {
    const rows = selectAll<StoreRow>(this.#db, "SELECT * FROM projects ORDER BY createdAt ASC, id ASC");
    return rows.map((r) => rowToProject(r));
  }

  async update(id: string, patch: UpdateProjectPatch): Promise<Project | null> {
    // Read-modify-write happens entirely inside one BEGIN IMMEDIATE span under the
    // single-writer lock — no check-then-set on an in-memory map, so concurrent updates
    // (even from a second connection on the same file) cannot clobber.
    return this.#writes.enqueue(async (): Promise<Project | null> => {
      return transactional(this.#db, (): Project | null => {
        const cur = selectOne<StoreRow>(this.#db, "SELECT * FROM projects WHERE id = ?", [id]);
        if (!cur) return null;
        const base = rowToProject(cur);
        const vars = patch.vars !== undefined ? patch.vars : base.vars;
        const history =
          patch.history && patch.history.length > 0 ? [...base.history, ...patch.history] : base.history;
        execute(
          this.#db,
          "UPDATE projects SET path = ?, inventoryRef = ?, playbookRef = ?, vars = ?, history = ?, updatedAt = ? WHERE id = ?",
          [patch.path ?? base.path, patch.inventoryRef ?? base.inventoryRef ?? null, patch.playbookRef ?? base.playbookRef ?? null, JSON.stringify(vars), JSON.stringify(history), Date.now(), id],
        );
        const updated = selectOne<StoreRow>(this.#db, "SELECT * FROM projects WHERE id = ?", [id]);
        return updated ? rowToProject(updated) : null;
      });
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.#writes.enqueue(async (): Promise<boolean> => {
      const res = execute(this.#db, "DELETE FROM projects WHERE id = ?", [id]);
      return (res.changes ?? 0) > 0;
    });
  }
}
