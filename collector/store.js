import fs from "node:fs";
import path from "node:path";

import { mergeItems } from "./aggregate.js";

const SNAPSHOT_NAME = /^(\d{4}-\d{2}-\d{2}T\d{2})\.json$/;

export function snapshotFileName(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`Data inválida de snapshot: ${iso}`);
  return `${date.toISOString().slice(0, 13)}.json`;
}

function snapshotDir(outDir) {
  return path.join(outDir, "snapshots");
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

export function writeSnapshot(outDir, snapshot) {
  const file = path.join(snapshotDir(outDir), snapshotFileName(snapshot.collectedAt));
  let finalSnapshot = snapshot;
  if (fs.existsSync(file)) {
    try {
      const existing = JSON.parse(fs.readFileSync(file, "utf8"));
      if (existing && Array.isArray(existing.items) && existing.collectedAt !== snapshot.collectedAt) {
        const keywords = new Set([...(existing.keywords || []), ...(snapshot.keywords || [])]);
        finalSnapshot = {
          ...existing,
          ...snapshot,
          itemsReceived: (existing.itemsReceived ?? 0) + (snapshot.itemsReceived ?? 0),
          estimatedUsd: Number(((existing.estimatedUsd ?? 0) + (snapshot.estimatedUsd ?? 0)).toFixed(4)),
          keywords: [...keywords],
          items: mergeItems([...existing.items, ...(snapshot.items || [])]),
        };
      }
    } catch {
      // Se o snapshot anterior estiver corrompido, sobrescreve com o novo.
    }
  }
  writeJson(file, finalSnapshot);
  return file;
}

export function writeCatalog(outDir, catalog) {
  const file = path.join(outDir, "videos.json");
  writeJson(file, catalog);
  return file;
}

export function listSnapshotFiles(outDir) {
  const dir = snapshotDir(outDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => SNAPSHOT_NAME.test(name))
    .sort();
}

export function pruneSnapshots(outDir, keep) {
  const dir = snapshotDir(outDir);
  const files = listSnapshotFiles(outDir);
  const extra = files.slice(0, Math.max(0, files.length - keep));
  for (const name of extra) fs.unlinkSync(path.join(dir, name));
  return extra;
}

export function readSnapshots(outDir) {
  const dir = snapshotDir(outDir);
  return listSnapshotFiles(outDir).map((name) => {
    let snapshot;
    try {
      snapshot = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    } catch (error) {
      throw new Error(`Snapshot ilegível (${name}): ${error.message}`);
    }
    if (!snapshot?.collectedAt || !Array.isArray(snapshot.items)) {
      throw new Error(`Snapshot inválido: ${name}`);
    }
    return snapshot;
  });
}
