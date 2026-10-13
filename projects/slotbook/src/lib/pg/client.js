// Minimal PostgreSQL client (protocol v3) with no dependencies.
//
// Why it exists: Slotbook ships with zero runtime dependencies (see
// docs/ARCHITECTURE.md, "Dependencies"). This client implements only what the
// app needs: SCRAM-SHA-256 / MD5 / cleartext auth, optional TLS with
// certificate verification, the extended query protocol with text-encoded
// parameters, and the simple protocol for migrations. Everything above it
// talks to `query(text, params)`, so swapping in `pg` is a one-file change.

import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";

export class PgError extends Error {
  constructor(fields) {
    super(fields.M || "PostgreSQL error");
    this.name = "PgError";
    this.code = fields.C; // SQLSTATE
    this.severity = fields.S;
    this.detail = fields.D;
    this.constraint = fields.n;
    this.table = fields.t;
    this.column = fields.c;
  }
}

const OID = {
  bool: 16,
  int8: 20,
  int2: 21,
  int4: 23,
  json: 114,
  float4: 700,
  float8: 701,
  timestamp: 1114,
  timestamptz: 1184,
  date: 1082,
  numeric: 1700,
  jsonb: 3802,
};

function parseValue(oid, text) {
  switch (oid) {
    case OID.bool:
      return text === "t";
    case OID.int2:
    case OID.int4:
      return Number.parseInt(text, 10);
    case OID.int8: {
      const n = Number(text);
      return Number.isSafeInteger(n) ? n : text;
    }
    case OID.float4:
    case OID.float8:
      return Number(text);
    case OID.json:
    case OID.jsonb:
      return JSON.parse(text);
    case OID.timestamptz:
    case OID.timestamp:
      return new Date(text.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
    default:
      return text; // numeric, date, text, uuid and others stay strings
  }
}

function serialize(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "boolean") return v ? "t" : "f";
  if (Buffer.isBuffer(v)) return "\\x" + v.toString("hex");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ---------- message writers ----------
const cstr = (s) => Buffer.from(s + "\0", "utf8");
function msg(type, ...parts) {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(type ? 5 : 4);
  if (type) {
    head.write(type, 0, "latin1");
    head.writeInt32BE(body.length + 4, 1);
  } else head.writeInt32BE(body.length + 4, 0);
  return Buffer.concat([head, body]);
}
const i16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n);
  return b;
};
const i32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};

// ---------- SCRAM-SHA-256 ----------
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
const sha256 = (data) => crypto.createHash("sha256").update(data).digest();
const xor = (a, b) => Buffer.from(a.map((x, i) => x ^ b[i]));

export class Client {
  constructor(opts) {
    this.opts = { port: 5432, host: "127.0.0.1", ...opts };
    this.buf = Buffer.alloc(0);
    this.queue = []; // pending operations, one in flight at a time
    this.current = null;
    this.closed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const { host, port } = this.opts;
      const sock = net.connect({ host, port });
      sock.setNoDelay(true);
      const fail = (err) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        sock.off("error", fail);
      };
      sock.once("error", fail);
      sock.once("connect", async () => {
        try {
          this.sock = this.opts.ssl ? await this.#upgrade(sock) : sock;
          cleanup();
          this.#wire();
          this.current = { kind: "startup", resolve, reject };
          this.#write(
            msg(
              null,
              i32(196608),
              cstr("user"),
              cstr(this.opts.user),
              cstr("database"),
              cstr(this.opts.database || this.opts.user),
              cstr("application_name"),
              cstr(this.opts.applicationName || "slotbook"),
              cstr("client_encoding"),
              cstr("UTF8"),
              cstr("TimeZone"),
              cstr("UTC"),
              Buffer.from([0]),
            ),
          );
        } catch (err) {
          fail(err);
        }
      });
    });
  }

  #upgrade(sock) {
    return new Promise((resolve, reject) => {
      sock.once("data", (b) => {
        if (b[0] !== 0x53) return reject(new Error("Server refused TLS but ssl was required"));
        // Certificate verification stays ON. Provide a CA via opts.ssl.ca if needed.
        const opt = typeof this.opts.ssl === "object" ? this.opts.ssl : {};
        const s = tls.connect({ socket: sock, servername: this.opts.host, ...opt, rejectUnauthorized: true });
        s.once("secureConnect", () => resolve(s));
        s.once("error", reject);
      });
      sock.write(Buffer.concat([i32(8), i32(80877103)]));
    });
  }

  #wire() {
    this.sock.on("data", (chunk) => {
      this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
      while (this.buf.length >= 5) {
        const len = this.buf.readInt32BE(1);
        if (this.buf.length < len + 1) break;
        const type = String.fromCharCode(this.buf[0]);
        const body = this.buf.subarray(5, len + 1);
        this.buf = this.buf.subarray(len + 1);
        try {
          this.#handle(type, body);
        } catch (err) {
          this.#failAll(err);
        }
      }
    });
    const onEnd = (err) => {
      this.closed = true;
      this.#failAll(err || new Error("Connection to PostgreSQL closed"));
    };
    this.sock.on("error", onEnd);
    this.sock.on("close", () => onEnd());
  }

  #failAll(err) {
    const ops = [this.current, ...this.queue].filter(Boolean);
    this.current = null;
    this.queue = [];
    for (const op of ops) op.reject(err);
  }

  #write(b) {
    this.sock.write(b);
  }

  #handle(type, body) {
    const op = this.current;
    switch (type) {
      case "R":
        return this.#auth(body);
      case "S":
      case "K":
      case "N":
      case "1":
      case "2":
      case "3":
      case "t":
      case "n":
        return;
      case "E": {
        const fields = {};
        let i = 0;
        while (body[i] !== 0) {
          const code = String.fromCharCode(body[i]);
          const end = body.indexOf(0, i + 1);
          fields[code] = body.toString("utf8", i + 1, end);
          i = end + 1;
        }
        if (op) op.error = new PgError(fields);
        if (op?.kind === "startup") {
          this.current = null;
          op.reject(op.error);
        }
        return;
      }
      case "T": {
        const n = body.readInt16BE(0);
        const cols = [];
        let i = 2;
        for (let k = 0; k < n; k++) {
          const end = body.indexOf(0, i);
          const name = body.toString("utf8", i, end);
          i = end + 1;
          const oid = body.readInt32BE(i + 6);
          cols.push({ name, oid });
          i += 18;
        }
        if (op) op.cols = cols;
        return;
      }
      case "D": {
        const n = body.readInt16BE(0);
        const row = {};
        let i = 2;
        for (let k = 0; k < n; k++) {
          const len = body.readInt32BE(i);
          i += 4;
          const col = op.cols[k];
          if (len === -1) row[col.name] = null;
          else {
            row[col.name] = parseValue(col.oid, body.toString("utf8", i, i + len));
            i += len;
          }
        }
        op.rows.push(row);
        return;
      }
      case "C": {
        const tag = body.toString("utf8", 0, body.length - 1);
        const m = /(\d+)$/.exec(tag);
        if (op) {
          op.rowCount = m ? Number(m[1]) : 0;
          op.command = tag.split(" ")[0];
        }
        return;
      }
      case "I":
        return;
      case "Z": {
        this.current = null;
        if (op?.kind === "startup") op.resolve(this);
        else if (op) {
          if (op.error) op.reject(op.error);
          else op.resolve({ rows: op.rows, rowCount: op.rowCount ?? op.rows.length, command: op.command });
        }
        this.#next();
        return;
      }
      default:
        return;
    }
  }

  #auth(body) {
    const code = body.readInt32BE(0);
    const { user, password = "" } = this.opts;
    if (code === 0) return; // AuthenticationOk
    if (code === 3) return this.#write(msg("p", cstr(password)));
    if (code === 5) {
      const salt = body.subarray(4, 8);
      const inner = crypto
        .createHash("md5")
        .update(password + user)
        .digest("hex");
      const outer = crypto
        .createHash("md5")
        .update(Buffer.concat([Buffer.from(inner), salt]))
        .digest("hex");
      return this.#write(msg("p", cstr("md5" + outer)));
    }
    if (code === 10) {
      const mechs = body.toString("utf8", 4).split("\0");
      if (!mechs.includes("SCRAM-SHA-256")) throw new Error("Server offers no supported SASL mechanism");
      this.scram = { nonce: crypto.randomBytes(18).toString("base64") };
      const first = `n=*,r=${this.scram.nonce}`;
      this.scram.clientFirstBare = first;
      const payload = Buffer.from("n,," + first);
      return this.#write(msg("p", cstr("SCRAM-SHA-256"), i32(payload.length), payload));
    }
    if (code === 11) {
      const serverFirst = body.toString("utf8", 4);
      const attrs = Object.fromEntries(serverFirst.split(",").map((kv) => [kv[0], kv.slice(2)]));
      if (!attrs.r.startsWith(this.scram.nonce)) throw new Error("SCRAM: server nonce mismatch");
      const salted = crypto.pbkdf2Sync(
        password.normalize("NFKC"),
        Buffer.from(attrs.s, "base64"),
        Number(attrs.i),
        32,
        "sha256",
      );
      const clientKey = hmac(salted, "Client Key");
      const storedKey = sha256(clientKey);
      const withoutProof = `c=biws,r=${attrs.r}`;
      const authMessage = `${this.scram.clientFirstBare},${serverFirst},${withoutProof}`;
      const proof = xor(clientKey, hmac(storedKey, authMessage)).toString("base64");
      this.scram.serverSignature = hmac(hmac(salted, "Server Key"), authMessage).toString("base64");
      return this.#write(msg("p", Buffer.from(`${withoutProof},p=${proof}`)));
    }
    if (code === 12) {
      const final = body.toString("utf8", 4);
      const v = /v=([^,]+)/.exec(final)?.[1];
      if (v !== this.scram.serverSignature) throw new Error("SCRAM: server signature mismatch");
      return;
    }
    throw new Error(`Unsupported authentication method ${code}`);
  }

  #next() {
    if (this.current || !this.queue.length) return;
    this.current = this.queue.shift();
    this.#write(this.current.payload);
  }

  #enqueue(payload) {
    if (this.closed) return Promise.reject(new Error("Connection is closed"));
    return new Promise((resolve, reject) => {
      this.queue.push({ kind: "query", payload, rows: [], cols: [], resolve, reject });
      this.#next();
    });
  }

  /** Parameterised query via the extended protocol. Values are always sent as parameters. */
  query(text, params = []) {
    const values = params.map(serialize);
    const bindParts = [cstr(""), cstr(""), i16(0), i16(values.length)];
    for (const v of values) {
      if (v === null) bindParts.push(i32(-1));
      else {
        const b = Buffer.from(v, "utf8");
        bindParts.push(i32(b.length), b);
      }
    }
    bindParts.push(i16(0));
    const payload = Buffer.concat([
      msg("P", cstr(""), cstr(text), i16(0)),
      msg("B", ...bindParts),
      msg("D", Buffer.from("P"), cstr("")),
      msg("E", cstr(""), i32(0)),
      msg("S"),
    ]);
    return this.#enqueue(payload);
  }

  /** Simple protocol: allows several statements (used by migrations only). */
  exec(sql) {
    return this.#enqueue(msg("Q", cstr(sql)));
  }

  end() {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve) => {
      this.sock.once("close", resolve);
      this.sock.end(msg("X"));
    });
  }
}
