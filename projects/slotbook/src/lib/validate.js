// Small schema validator for request input. Objects are strict: unknown keys
// are rejected so typos and mass-assignment attempts fail loudly.
import { validation } from "./errors.js";

class Issue extends Error {
  constructor(path, message) {
    super(message);
    this.path = path;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const make = (check, meta = {}) => ({ check, ...meta });

export const v = {
  /** @param {{min?: number, max?: number, trim?: boolean, pattern?: RegExp, lower?: boolean}} [opts] */
  string({ min = 0, max = 1000, trim = true, pattern, lower = false } = {}) {
    return make((x, p) => {
      if (typeof x !== "string") throw new Issue(p, "must be a string");
      let s = trim ? x.trim() : x;
      if (lower) s = s.toLowerCase();
      if (s.length < min) throw new Issue(p, min === 1 ? "is required" : `must be at least ${min} characters`);
      if (s.length > max) throw new Issue(p, `must be at most ${max} characters`);
      if (pattern && !pattern.test(s)) throw new Issue(p, "has an invalid format");
      return s;
    });
  },
  email() {
    return make((x, p) => {
      const s = v.string({ min: 3, max: 254, lower: true }).check(x, p);
      if (!EMAIL.test(s)) throw new Issue(p, "must be a valid email address");
      return s;
    });
  },
  int({ min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, coerce = false } = {}) {
    return make((x, p) => {
      const n = coerce && typeof x === "string" && /^-?\d+$/.test(x) ? Number(x) : x;
      if (!Number.isInteger(n)) throw new Issue(p, "must be a whole number");
      if (n < min || n > max) throw new Issue(p, `must be between ${min} and ${max}`);
      return n;
    });
  },
  boolean({ coerce = false } = {}) {
    return make((x, p) => {
      if (coerce && (x === "true" || x === "false")) return x === "true";
      if (typeof x !== "boolean") throw new Issue(p, "must be true or false");
      return x;
    });
  },
  uuid() {
    return make((x, p) => {
      if (typeof x !== "string" || !UUID.test(x)) throw new Issue(p, "must be a valid id");
      return x.toLowerCase();
    });
  },
  enum(values) {
    return make((x, p) => {
      if (!values.includes(x)) throw new Issue(p, `must be one of: ${values.join(", ")}`);
      return x;
    });
  },
  date() {
    return make((x, p) => {
      if (typeof x !== "string" || !DATE.test(x)) throw new Issue(p, "must be a date like 2026-10-13");
      const d = new Date(`${x}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== x) throw new Issue(p, "is not a real date");
      return x;
    });
  },
  time() {
    return make((x, p) => {
      if (typeof x !== "string" || !TIME.test(x)) throw new Issue(p, "must be a time like 09:30");
      return x;
    });
  },
  datetime() {
    return make((x, p) => {
      if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(x))
        throw new Issue(p, "must be an ISO 8601 date-time with a time zone");
      const d = new Date(x);
      if (Number.isNaN(d.getTime())) throw new Issue(p, "is not a real date-time");
      return d;
    });
  },
  array(item, { min = 0, max = 100 } = {}) {
    return make((x, p) => {
      if (!Array.isArray(x)) throw new Issue(p, "must be a list");
      if (x.length < min || x.length > max) throw new Issue(p, `must contain between ${min} and ${max} items`);
      return x.map((el, i) => item.check(el, `${p}[${i}]`));
    });
  },
  optional(schema) {
    return { ...schema, optional: true };
  },
  nullable(schema) {
    return { ...schema, check: (x, p) => (x === null ? null : schema.check(x, p)) };
  },
  object(shape, { strict = true } = {}) {
    return make((x, p) => {
      if (typeof x !== "object" || x === null || Array.isArray(x)) throw new Issue(p, "must be an object");
      const out = {};
      const issues = [];
      for (const key of Object.keys(x)) {
        if (strict && !(key in shape)) issues.push(new Issue(p ? `${p}.${key}` : key, "is not an allowed field"));
      }
      for (const [key, schema] of Object.entries(shape)) {
        const path = p ? `${p}.${key}` : key;
        if (x[key] === undefined || (x[key] === "" && schema.optional)) {
          if (!schema.optional) issues.push(new Issue(path, "is required"));
          continue;
        }
        try {
          out[key] = schema.check(x[key], path);
        } catch (e) {
          if (e instanceof Issue) issues.push(e);
          else if (e?.issues) issues.push(...e.issues);
          else throw e;
        }
      }
      if (issues.length) throw Object.assign(new Error("invalid"), { issues });
      return out;
    });
  },
};

/** Validate input or throw a 422 ApiError listing every problem. */
export function parse(schema, input) {
  try {
    return schema.check(input, "");
  } catch (e) {
    const issues = e instanceof Issue ? [e] : e?.issues;
    if (!issues) throw e;
    throw validation(issues.map((i) => ({ field: i.path || "(body)", message: i.message })));
  }
}
