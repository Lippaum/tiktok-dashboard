import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".");
const webRoot = path.join(root, "web");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function resolveWeb(urlPath) {
  const pathname = decodeURIComponent(urlPath.split("?")[0]);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (relative.includes("\0")) return null;
  const full = path.resolve(webRoot, relative);
  if (full !== webRoot && !full.startsWith(webRoot + path.sep)) return null;
  return full;
}

function send(response, status, body, type) {
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-cache",
  });
  response.end(body);
}

export function startPreview({ dataFile, port = 4173, host = "127.0.0.1" } = {}) {
  const catalog = path.resolve(dataFile || path.join(root, "data/videos.json"));
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/data/videos.json") {
      if (!fs.existsSync(catalog)) {
        send(response, 404, "Catálogo não encontrado.\n", "text/plain; charset=utf-8");
        return;
      }
      send(response, 200, fs.readFileSync(catalog), "application/json; charset=utf-8");
      return;
    }
    const file = resolveWeb(url.pathname);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      send(
        response,
        404,
        "<!doctype html><meta charset=\"utf-8\"><title>Não encontrado</title><p>Não encontrado.</p>",
        "text/html; charset=utf-8",
      );
      return;
    }
    const type = MIME[path.extname(file)] || "application/octet-stream";
    send(response, 200, fs.readFileSync(file), type);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        url: `http://${host}:${address.port}/`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (invokedDirectly()) {
  const args = process.argv.slice(2);
  let dataFile = null;
  let port = 4173;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--data") dataFile = args[++index];
    else if (args[index] === "--port") port = Number(args[++index]);
  }
  const preview = await startPreview({ dataFile, port, host: "127.0.0.1" });
  console.log(`Radar local: ${preview.url}`);
  console.log("Ctrl+C encerra. Os dados vêm de", path.resolve(dataFile || "data/videos.json"));
}
