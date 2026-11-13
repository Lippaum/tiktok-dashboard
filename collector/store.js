import fs from "node:fs";
import path from "node:path";

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
  writeJson(file, snapshot);
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
