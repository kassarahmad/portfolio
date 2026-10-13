// Method + path routing with :params. Routes carry metadata (auth roles,
// rate-limit bucket) that the app pipeline enforces before the handler runs.
export class Router {
  constructor(prefix = "") {
    this.prefix = prefix;
    this.routes = [];
  }

  add(method, path, opts, handler) {
    if (typeof opts === "function") [handler, opts] = [opts, {}];
    const full = this.prefix + path;
    const keys = [];
    const re = new RegExp(
      "^" +
        full.replace(/\/:(\w+)/g, (_, k) => {
          keys.push(k);
          return "/([^/]+)";
        }) +
        "/?$",
    );
    this.routes.push({ method, path: full, re, keys, handler, auth: opts.auth ?? null, bucket: opts.bucket ?? "api" });
    return this;
  }

  get(p, o, h) {
    return this.add("GET", p, o, h);
  }
  post(p, o, h) {
    return this.add("POST", p, o, h);
  }
  put(p, o, h) {
    return this.add("PUT", p, o, h);
  }
  patch(p, o, h) {
    return this.add("PATCH", p, o, h);
  }
  delete(p, o, h) {
    return this.add("DELETE", p, o, h);
  }

  /** @returns {{route?: any, params?: Record<string, string>, allowed?: string[]} | null} */
  match(method, pathname) {
    const allowed = [];
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      if (r.method !== method && !(method === "HEAD" && r.method === "GET")) {
        allowed.push(r.method);
        continue;
      }
      /** @type {Record<string, string>} */
      const params = {};
      r.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1]);
      });
      return { route: r, params };
    }
    return allowed.length ? { allowed } : null;
  }
}
