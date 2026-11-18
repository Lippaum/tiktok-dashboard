import fs from "node:fs";
import path from "node:path";

const CONTENT_EXT = {
  "image/webp": ".webp",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/avif": ".avif",
};

const CACHE_FILE = /^(\d{8,})\.(webp|jpg|png|avif)$/i;

export function parseCoverExpiryMs(url) {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return null;
  try {
    const parsed = new URL(url);
    const raw =
      parsed.searchParams.get("x-expires") ||
      parsed.searchParams.get("expires") ||
      parsed.searchParams.get("X-Expires");
    if (!raw || !/^\d{9,13}$/.test(raw)) return null;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    return numeric < 1e12 ? numeric * 1000 : numeric;
  } catch {
    return null;
  }
}

export function isCoverExpired(url, now = new Date()) {
  const expiryMs = parseCoverExpiryMs(url);
  if (expiryMs == null) return false;
  return expiryMs <= now.getTime();
}

export function readCachedCovers(cacheDir) {
  const map = new Map();
  if (!cacheDir || !fs.existsSync(cacheDir)) return map;
  for (const entry of fs.readdirSync(cacheDir)) {
    const match = entry.match(CACHE_FILE);
    if (!match) continue;
    const full = path.join(cacheDir, entry);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile() && stat.size > 64) {
        map.set(match[1], entry);
      }
    } catch {
      // Ignora arquivo inacessível.
    }
  }
  return map;
}

function inferExtension(contentType, url) {
  const cleanType = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (CONTENT_EXT[cleanType]) return CONTENT_EXT[cleanType];
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(".webp")) return ".webp";
    if (pathname.endsWith(".png")) return ".png";
    if (pathname.endsWith(".avif")) return ".avif";
  } catch {
    // Usa extensão padrão.
  }
  return ".jpg";
}

export async function cacheCovers(
  videos,
  cacheDir,
  {
    now = new Date(),
    maxDownloads = 45,
    concurrency = 6,
    timeoutMs = 5000,
    maxBytes = 250_000,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  if (!cacheDir) return new Map();
  fs.mkdirSync(cacheDir, { recursive: true });
  const existing = readCachedCovers(cacheDir);
  const activeIds = new Set();
  const queue = [];

  for (const video of videos || []) {
    if (!video?.id) continue;
    activeIds.add(String(video.id));
    if (existing.has(String(video.id))) continue;
    const url = video.coverUrl;
    if (typeof url !== "string" || !/^https:\/\//i.test(url)) continue;
    if (isCoverExpired(url, now)) continue;
    if (queue.length < maxDownloads) {
      queue.push({ id: String(video.id), url });
    }
  }

  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const target = queue[cursor++];
      try {
        const response = await fetchImpl(target.url, {
          headers: {
            Accept: "image/webp,image/avif,image/*,*/*;q=0.8",
            "User-Agent": "Mozilla/5.0 (compatible; RadarViral/2.0)",
          },
          referrerPolicy: "no-referrer",
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) continue;
        const type = response.headers.get("content-type") || "";
        if (type && !type.toLowerCase().startsWith("image/")) continue;
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength < 64 || buffer.byteLength > maxBytes) continue;
        const ext = inferExtension(type, target.url);
        const fileName = `${target.id}${ext}`;
        const tempPath = path.join(cacheDir, `${fileName}.${process.pid}.tmp`);
        const finalPath = path.join(cacheDir, fileName);
        fs.writeFileSync(tempPath, buffer);
        fs.renameSync(tempPath, finalPath);
        existing.set(target.id, fileName);
      } catch {
        // Falha pontual de capa não interrompe a coleta.
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
  await Promise.all(workers);

  for (const [id, fileName] of [...existing.entries()]) {
    if (activeIds.size > 0 && !activeIds.has(id)) {
      try {
        fs.unlinkSync(path.join(cacheDir, fileName));
      } catch {
        // Ignora erro ao limpar cache antigo.
      }
      existing.delete(id);
    }
  }

  return existing;
}
