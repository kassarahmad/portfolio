// Local static server for dist/ that applies the "/*" rules from dist/_headers,
// so the Content-Security-Policy is enforced exactly as in production.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
};

async function globalHeaders() {
  const text = await readFile(path.join(DIST, "_headers"), "utf8").catch(() => "");
  const block = text
    .split(/\n(?=\/)/)[0]
    .split("\n")
    .slice(1);
  return Object.fromEntries(
    block
      .filter((l) => l.includes(":"))
      .map((l) => [
        l.trim().split(":")[0],
        l
          .trim()
          .slice(l.trim().indexOf(":") + 1)
          .trim(),
      ]),
  );
}

export async function serve(port = Number(process.env.PORT || 8080)) {
  const headers = await globalHeaders();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://local");
    let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
    if (!file.startsWith(DIST)) {
      res.writeHead(400);
      return res.end();
    }
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
      const body = await readFile(file);
      res.writeHead(200, { ...headers, "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { ...headers, "Content-Type": TYPES[".html"] });
      const lang = url.pathname.split("/")[1];
      const page = /^[a-z]{2}$/.test(lang) ? `${lang}/404.html` : "en/404.html";
      res.end(await readFile(path.join(DIST, page)).catch(() => "Not found"));
    }
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await serve();
  process.stdout.write(`Serving dist/ on http://127.0.0.1:${s.address().port}\n`);
}
