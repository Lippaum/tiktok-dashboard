import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildCatalog } from "../collector/aggregate.js";
import { loadConfig } from "../collector/config.js";
import { readCachedCovers } from "../collector/covers.js";
import { readSnapshots } from "../collector/store.js";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function requireNonEmpty(file) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    throw new Error(`Arquivo obrigatório ausente ou vazio: ${file}`);
  }
}

export function assembleSite({
  rootDir = defaultRoot,
  dataDir = path.join(rootDir, "data"),
  outDir = path.join(rootDir, "_site"),
  configFile = path.join(rootDir, "config/sources.json"),
  coverCacheDir = null,
} = {}) {
  const webDir = path.join(rootDir, "web");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "data"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "covers"), { recursive: true });

  for (const asset of ["index.html", "styles.css", "app.js", "favicon.svg"]) {
    fs.copyFileSync(path.join(webDir, asset), path.join(outDir, asset));
  }

  const coversSrc = path.join(webDir, "covers");
  if (fs.existsSync(coversSrc)) {
    for (const entry of fs.readdirSync(coversSrc)) {
      if (entry.endsWith(".svg")) {
        fs.copyFileSync(path.join(coversSrc, entry), path.join(outDir, "covers", entry));
      }
    }
  }

  const snapshots = readSnapshots(dataDir);
  let catalog;
  if (snapshots.length > 0) {
    const config = loadConfig(configFile);
    catalog = buildCatalog(snapshots, {
      region: config.region,
      maxHistoryPoints: config.maxHistoryPoints,
    });
  } else {
    const fallbackFile = path.join(dataDir, "videos.json");
    if (fs.existsSync(fallbackFile)) {
      catalog = JSON.parse(fs.readFileSync(fallbackFile, "utf8"));
    } else {
      catalog = {
        schemaVersion: 2,
        updatedAt: null,
        region: "BR",
        source: null,
        videoCount: 0,
        videos: [],
        run: null,
      };
    }
  }

  const cachedCovers = readCachedCovers(coverCacheDir);
  if (cachedCovers.size > 0 && Array.isArray(catalog.videos)) {
    const cacheOutDir = path.join(outDir, "covers", "cache");
    fs.mkdirSync(cacheOutDir, { recursive: true });
    for (const video of catalog.videos) {
      const fileName = cachedCovers.get(String(video.id));
      if (!fileName) continue;
      fs.copyFileSync(path.join(coverCacheDir, fileName), path.join(cacheOutDir, fileName));
      video.coverUrl = `covers/cache/${fileName}`;
    }
  }

  fs.writeFileSync(path.join(outDir, "data", "videos.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, ".nojekyll"), "");

  requireNonEmpty(path.join(outDir, "index.html"));
  requireNonEmpty(path.join(outDir, "styles.css"));
  requireNonEmpty(path.join(outDir, "app.js"));
  requireNonEmpty(path.join(outDir, "data", "videos.json"));

  return { outDir, videoCount: catalog.videoCount ?? 0 };
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (invokedDirectly()) {
  const argv = process.argv.slice(2);
  let outDir;
  let dataDir;
  let coverCacheDir = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") outDir = path.resolve(argv[++index] || "");
    else if (arg === "--data-dir") dataDir = path.resolve(argv[++index] || "");
    else if (arg === "--cover-cache") coverCacheDir = path.resolve(argv[++index] || "");
  }
  const result = assembleSite({ outDir, dataDir, coverCacheDir });
  console.log(`Site montado em ${result.outDir} (${result.videoCount} vídeos).`);
}
