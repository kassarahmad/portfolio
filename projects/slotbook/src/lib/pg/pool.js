import { Client } from "./client.js";

/**
 * Small connection pool. `query` borrows a connection for one statement;
 * `tx` runs a callback inside BEGIN/COMMIT on a single connection and rolls
 * back if it throws.
 */
export class Pool {
  constructor(opts, { max = 10, acquireTimeoutMs = 5000 } = {}) {
    this.opts = opts;
    this.max = max;
    this.acquireTimeoutMs = acquireTimeoutMs;
    this.idle = [];
    this.size = 0;
    this.waiters = [];
    this.ending = false;
  }

  async #create() {
    this.size++;
    try {
      const c = new Client(this.opts);
      await c.connect();
      return c;
    } catch (err) {
      this.size--;
      throw err;
    }
  }

  async acquire() {
    if (this.ending) throw new Error("Pool is shutting down");
    while (this.idle.length) {
      const c = this.idle.pop();
      if (!c.closed) return c;
      this.size--;
    }
    if (this.size < this.max) return this.#create();
    return new Promise((resolve, reject) => {
      const w = { resolve, reject };
      w.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(Object.assign(new Error("Timed out waiting for a database connection"), { code: "POOL_TIMEOUT" }));
      }, this.acquireTimeoutMs);
      this.waiters.push(w);
    });
  }

  release(c, broken = false) {
    if (broken || c.closed) {
      this.size--;
      if (!c.closed) c.end().catch(() => {});
      if (this.waiters.length && !this.ending) {
        const w = this.waiters.shift();
        clearTimeout(w.timer);
        this.#create().then(w.resolve, w.reject);
      }
      return;
    }
    const w = this.waiters.shift();
    if (w) {
      clearTimeout(w.timer);
      w.resolve(c);
    } else this.idle.push(c);
  }

  async query(text, params) {
    const c = await this.acquire();
    try {
      const r = await c.query(text, params);
      this.release(c);
      return r;
    } catch (err) {
      this.release(c, !err.code || c.closed);
      throw err;
    }
  }

  async tx(fn) {
    const c = await this.acquire();
    try {
      await c.query("BEGIN");
      const out = await fn(c);
      await c.query("COMMIT");
      this.release(c);
      return out;
    } catch (err) {
      try {
        await c.query("ROLLBACK");
        this.release(c);
      } catch {
        this.release(c, true);
      }
      throw err;
    }
  }

  async end() {
    this.ending = true;
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error("Pool is shutting down"));
    }
    this.waiters = [];
    await Promise.all(this.idle.splice(0).map((c) => c.end()));
  }
}
