// Structured JSON logs, one object per line, to stdout.
// Never pass request bodies, tokens, passwords or cookies to the logger.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const REDACT = /pass(word)?|token|secret|authorization|cookie/i;

function scrub(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = REDACT.test(k) ? "[redacted]" : v;
  return out;
}

export function createLogger({ level = "info", sink = (line) => process.stdout.write(line + "\n"), base = {} } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const write = (lvl, msg, fields = {}) => {
    if (LEVELS[lvl] < min) return;
    /** @type {Record<string, any>} */
    const entry = { ts: new Date().toISOString(), level: lvl, msg, ...base, ...scrub(fields) };
    if (fields.err instanceof Error) {
      entry.err = { name: fields.err.name, message: fields.err.message, code: fields.err.code };
      if (lvl === "error") entry.err.stack = fields.err.stack;
    }
    sink(JSON.stringify(entry));
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (extra) => createLogger({ level, sink, base: { ...base, ...extra } }),
  };
}
