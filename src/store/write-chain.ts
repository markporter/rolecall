// Single-writer serialization queue (dbt #14550 lesson, Todo 19).
//
// Concurrent server / scheduler / webhook+writer processes must never interleave
// SQLite writes into the same WAL database. Rather than check-then-set any shared
// in-memory map (which races), we funnel EVERY mutation through ONE promise chain
// gated on a boolean `writing` flag plus a FIFO task queue. Reads bypass it. If a
// step rejects, the rejection is delivered to its awaiter but the chain keeps going
// (`catch(() => undefined)`) so one bad transaction cannot stall every later write.

type Task = () => Promise<void>;

export class WriteQueue {
  #writing = false;
  #queue: Array<Task> = [];

  /** Enqueue a mutation; returns a promise resolving when it has committed. */
  enqueue(task: () => Promise<void>): Promise<void>;
  enqueue<T>(task: () => Promise<T>): Promise<T>;
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.#queue.push(async () => {
        try {
          resolve(await task());
        } catch (err) {
          reject(err);
        }
      });
      this.#pump();
    });
  }

  #pump(): void {
    // Respect the boolean gate: only one writer proceeds at a time.
    if (this.#writing || this.#queue.length === 0) return;
    this.#writing = true;
    const next = this.#queue.shift() as Task;
    Promise.resolve()
      .then(next)
      .catch(() => undefined) // failure already surfaced to this caller's promise
      .finally(() => {
        this.#writing = false;
        this.#pump(); // drain the next queued writer
      });
  }

  /** Number of mutations still waiting behind the active one. */
  get pending(): number {
    return this.#queue.length;
  }
}
