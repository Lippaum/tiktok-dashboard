import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runActor } from "./apify.js";
import { buildCatalog } from "./aggregate.js";
import {
  MISSING_TOKEN_MESSAGE,
  assertWithinBudget,
  buildSearchInput,
  buildTrendingInput,
  loadConfig,
  selectKeywords,
} from "./config.js";
import { loadFixtureSnapshots } from "./fixtures.js";
import { normalizeItem } from "./normalize.js";
import { pruneSnapshots, readSnapshots, writeCatalog, writeSnapshot } from "./store.js";
import { redact, round, sampleKeys } from "./util.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const HELP = `Uso:
  node collector/collect.js              coleta ao vivo (exige APIFY_TOKEN)
  node collector/collect.js --fixture    gera dados de exemplo em .demo-data/
  node collector/collect.js --out <dir>  pasta de saída (padrão: data/)
  node collector/collect.js --config <arquivo>
`;

function loadDotEnv(file, env) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || env[match[1]]) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
}

function parseArgs(argv) {
  const options = { fixture: false, out: null, config: null, fixtureFile: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixture") options.fixture = true;
    else if (arg === "--out") options.out = path.resolve(argv[++index] || "");
    else if (arg === "--config") options.config = path.resolve(argv[++index] || "");
    else if (arg === "--fixture-file") options.fixtureFile = path.resolve(argv[++index] || "");
    else if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else {
      throw new Error(`Argumento desconhecido: ${arg}\n${HELP}`);
    }
  }
  return options;
}

function takeItems(rawItems, source, limit) {
  const items = [];
  let skipped = 0;
  let logged = false;
  for (const raw of rawItems.slice(0, limit)) {
    const normalized = normalizeItem(raw, source);
    if (!normalized) {
      skipped += 1;
      if (!logged) {
        console.warn(`Item de ${source} ignorado. Chaves: ${sampleKeys(raw)}`);
        logged = true;
      }
      continue;
    }
    items.push(normalized);
  }
  return { items, skipped };
}

async function collectLive(config, env, now, estimate) {
  const token = String(env.APIFY_TOKEN || "").trim();
  if (!token) throw new Error(MISSING_TOKEN_MESSAGE);

  const known = new Set([
    "kaitoeasyapi/tiktok-trending-feed-scraper",
    "kaitoeasyapi/tiktok-search-scraper",
  ]);
  for (const actorId of [config.trending.actorId, config.search.actorId]) {
    if (!known.has(actorId)) {
      console.warn(
        `Aviso: ${actorId} não é um dos actors baratos previstos. Confira pricePerThousandUsd, senão o teto de custo mente.`,
      );
    }
  }

  const keywords = selectKeywords(
    config.search.keywords,
    config.search.keywordsPerRun,
    now,
    config.intervalHours,
  );
  const trendingInput = buildTrendingInput(config);
  const searchInput = buildSearchInput(config, keywords);
  console.log(
    `Teto deste run: ${estimate.perRun} resultados, cerca de US$ ${estimate.perRunUsd.toFixed(4)}. ` +
      `Teto do mês: US$ ${estimate.monthlyUsd.toFixed(2)}.`,
  );
  console.log(`Em alta ${config.trending.actorId}: ${JSON.stringify(trendingInput)}`);
  console.log(`Busca ${config.search.actorId}: ${JSON.stringify(searchInput)}`);

  const trending = await runActor(token, config.trending.actorId, trendingInput);
  const search = await runActor(token, config.search.actorId, searchInput);
  const received = trending.items.length + search.items.length;
  const trendingKept = takeItems(trending.items, "trending", config.trending.maxVideosPerRegion);
  const searchKept = takeItems(
    search.items,
    "search",
    keywords.length * config.search.maxResultsPerKeyword,
  );
  const items = [...trendingKept.items, ...searchKept.items];
  const skipped = trendingKept.skipped + searchKept.skipped;
  if (items.length === 0) {
    throw new Error(
      `Nenhum vídeo identificável. A Apify devolveu ${received} itens e ${skipped} foram ignorados. ` +
        "Os dados antigos foram mantidos. Se o formato do actor mudou, ajuste collector/normalize.js.",
    );
  }
  if (received > estimate.perRun) {
    console.warn(
      `A Apify devolveu ${received} itens, acima dos ${estimate.perRun} pedidos. ` +
        "O custo segue a quantidade devolvida. O arquivo guarda só o teto configurado.",
    );
  }
  const estimatedUsd = round((received * config.pricePerThousandUsd) / 1000, 4);
  console.log(`Itens recebidos: ${received}. Custo estimado deste run: US$ ${estimatedUsd.toFixed(4)}.`);
  return [
    {
      collectedAt: now.toISOString(),
      region: config.region,
      mode: "live",
      itemsReceived: received,
      estimatedUsd,
      keywords: keywords.map((keyword) => keyword.query),
      actors: {
        trending: { id: config.trending.actorId, input: trendingInput, returned: trending.items.length },
        search: { id: config.search.actorId, input: searchInput, returned: search.items.length },
      },
      items,
    },
  ];
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  if (env === process.env) loadDotEnv(path.join(root, ".env"), env);
  const config = loadConfig(options.config || path.join(root, "config/sources.json"));
  const estimate = assertWithinBudget(config);
  const dataDir = path.join(root, "data");
  const outDir = options.out || (options.fixture ? path.join(root, ".demo-data") : dataDir);
  if (options.fixture && path.resolve(outDir) === dataDir) {
    throw new Error(
      "O modo --fixture não escreve em data/, para não misturar exemplo com a coleta real. A saída padrão é .demo-data/.",
    );
  }
  const now = new Date();
  const snapshots = options.fixture
    ? loadFixtureSnapshots(options.fixtureFile || path.join(root, "fixtures/scenario.json"), now)
    : await collectLive(config, env, now, estimate);

  if (options.fixture) fs.rmSync(path.join(outDir, "snapshots"), { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "snapshots"), { recursive: true });
  for (const snapshot of snapshots) writeSnapshot(outDir, snapshot);
  const removed = pruneSnapshots(outDir, config.keepSnapshots);
  if (removed.length) console.log(`Snapshots antigos removidos: ${removed.length}.`);
  const all = readSnapshots(outDir);
  const catalog = buildCatalog(all, {
    region: config.region,
    maxHistoryPoints: config.maxHistoryPoints,
  });
  writeCatalog(outDir, catalog);
  const faceless = catalog.videos.filter((video) => video.faceless).length;
  console.log(
    `Catálogo: ${catalog.videoCount} vídeos (${faceless} com a heurística sem rosto/IA). ` +
      `Atualizado em ${catalog.updatedAt}. Pasta: ${outDir}`,
  );
  return catalog;
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (invokedDirectly()) {
  main().catch((error) => {
    const token = process.env.APIFY_TOKEN;
    console.error(`ERRO: ${redact(error?.stack || error?.message || error, token)}`);
    process.exitCode = 1;
  });
}
