/**
 * Server-Sent Events hub. Each client gets an initial snapshot, then `sample`
 * and `alert` events, and a comment line every 15 s so proxies don't close an
 * idle connection. Event ids let a reconnecting browser send Last-Event-ID;
 * since history is in the API, a reconnect simply receives a fresh snapshot.
 */
export class SseHub {
  constructor({ maxClients = 100, heartbeatMs = 15_000 } = {}) {
    this.clients = new Set();
    this.maxClients = maxClients;
    this.seq = 0;
    this.timer = setInterval(() => this.#write(": keep-alive\n\n"), heartbeatMs);
    this.timer.unref();
  }

  get size() {
    return this.clients.size;
  }

  /** @returns {boolean} false when the hub is full */
  add(req, res, snapshot) {
    if (this.clients.size >= this.maxClients) return false;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // tell nginx-style proxies not to buffer
    });
    res.write("retry: 3000\n\n");
    this.#send(res, "snapshot", snapshot);
    this.clients.add(res);
    const drop = () => this.clients.delete(res);
    req.on("close", drop);
    res.on("error", drop);
    return true;
  }

  broadcast(event, data) {
    for (const res of this.clients) this.#send(res, event, data);
  }

  #send(res, event, data) {
    this.seq += 1;
    res.write(`id: ${this.seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  #write(line) {
    for (const res of this.clients) res.write(line);
  }

  close() {
    clearInterval(this.timer);
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}
