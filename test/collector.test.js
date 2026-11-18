import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildCatalog } from "../collector/aggregate.js";
import {
  MISSING_TOKEN_MESSAGE,
  assertWithinBudget,
  buildSearchInput,
  buildTrendingInput,
  estimateUsage,
  loadConfig,
  selectKeywords,
} from "../collector/config.js";
import { main } from "../collector/collect.js";
import { cacheCovers, isCoverExpired } from "../collector/covers.js";
import { normalizeItem } from "../collector/normalize.js";
import {
  listSnapshotFiles,
  pruneSnapshots,
  readSnapshots,
  snapshotFileName,
  writeSnapshot,
} from "../collector/store.js";
import { classify, detectLanguage, NICHE_OPTIONS } from "../collector/tag.js";
import { redact } from "../collector/util.js";
import { startPreview } from "../preview.js";
import { assembleSite } from "../scripts/assemble-site.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function temporaryDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "radar-"));
}

test("configuração cabe no crédito e pede o Brasil", () => {
  const config = loadConfig(path.join(root, "config/sources.json"));
  const estimate = assertWithinBudget(config);
  assert.equal(config.region, "BR");
  assert.equal(estimate.perRun, 35);
  assert.equal(estimate.monthlyItems, 6300);
  assert.equal(estimate.monthlyUsd, 1.58);
  assert.deepEqual(buildTrendingInput(config), {
    regions: ["BR"],
    maxVideosPerRegion: 15,
  });
  const keywords = selectKeywords(
    config.search.keywords,
    config.search.keywordsPerRun,
    new Date("2026-01-01T00:00:00.000Z"),
    4,
  );
  const search = buildSearchInput(config, keywords);
  assert.deepEqual(Object.keys(search), [
    "keywords",
    "region",
    "sortType",
    "publishTime",
    "maxResultsPerKeyword",
  ]);
  assert.equal(search.region, "BR");
  assert.equal(search.sortType, "1");
  assert.equal(search.publishTime, "7");
  assert.equal(buildSearchInput(config, keywords, { runIndex: 1 }).publishTime, "1");
  assert.equal(search.maxResultsPerKeyword, 4);
  assert.equal(search.keywords.length, 5);
});

test("o rodízio de hashtags cobre a lista inteira por relógio e por cursor de snapshot", () => {
  const config = loadConfig(path.join(root, "config/sources.json"));
  const stepsNeeded = Math.ceil(config.search.keywords.length / config.search.keywordsPerRun);
  const start = new Date("2026-01-01T00:00:00.000Z");
  const seenClock = new Set();
  for (let step = 0; step < stepsNeeded; step += 1) {
    const when = new Date(start.getTime() + step * 4 * 3_600_000);
    for (const keyword of selectKeywords(config.search.keywords, 5, when, 4)) {
      seenClock.add(keyword.query);
    }
  }
  assert.equal(seenClock.size, config.search.keywords.length);

  const previousSnapshots = [];
  const seenCursor = new Set();
  for (let run = 0; run < stepsNeeded; run += 1) {
    const irregularTime = new Date(start.getTime() + run * 11 * 3_600_000);
    const chosen = selectKeywords(config.search.keywords, 5, irregularTime, 4, previousSnapshots);
    for (const kw of chosen) seenCursor.add(kw.query);
    previousSnapshots.push({ keywords: chosen.map((kw) => kw.query) });
  }
  assert.equal(seenCursor.size, config.search.keywords.length);
});

test("configuração cara demais é recusada", () => {
  const config = loadConfig(path.join(root, "config/sources.json"));
  config.trending.maxVideosPerRegion = 50;
  config.search.keywordsPerRun = config.search.keywords.length;
  config.search.maxResultsPerKeyword = 20;
  assert.throws(() => assertWithinBudget(config), /crédito grátis/);
  assert.ok(estimateUsage(config).monthlyUsd > 4);
});

test("normaliza os três formatos de actor, salvamentos e duração zerada", () => {
  const kaito = normalizeItem(
    {
      id: "7100000000000001111",
      text: "História narrada #terror",
      playCount: "1500",
      diggCount: 100,
      commentCount: 4,
      shareCount: 8,
      collectCount: 38,
      createTimeISO: "2026-11-10T12:00:00.000Z",
      authorMeta: { name: "conta.teste", nickName: "Conta", fans: 90 },
      videoMeta: { duration: 27, coverUrl: "https://cdn.example/capa.jpg" },
      webVideoUrl: "https://www.tiktok.com/@conta.teste/video/7100000000000001111",
      hashtags: [{ name: "Terror" }],
      videoUrlNoWatermark: "https://cdn.example/video.mp4",
    },
    "trending",
  );
  assert.equal(kaito.id, "7100000000000001111");
  assert.equal(kaito.views, 1500);
  assert.equal(kaito.saves, 38);
  assert.equal(kaito.durationSec, 27);
  assert.equal(kaito.author, "conta.teste");
  assert.equal(kaito.coverUrl, "https://cdn.example/capa.jpg");
  assert.ok(kaito.hashtags.includes("terror"));
  assert.deepEqual(kaito.sources, ["trending"]);

  const flat = normalizeItem(
    {
      "authorMeta.name": "ritmo.da.semana",
      "authorMeta.fans": 10,
      text: "trend #dance",
      playCount: 90,
      diggCount: 3,
      "videoMeta.duration": 14,
      "videoMeta.coverUrl": "covers/dance.svg",
      createTimeISO: "2026-11-12T00:00:00.000Z",
      webVideoUrl: "https://www.tiktok.com/@ritmo.da.semana/video/7100000000000002222",
    },
    "search",
  );
  assert.equal(flat.id, "7100000000000002222");
  assert.equal(flat.author, "ritmo.da.semana");
  assert.equal(flat.durationSec, 14);
  assert.equal(flat.coverUrl, "covers/dance.svg");

  const aweme = normalizeItem(
    {
      aweme_id: "7100000000000003333",
      desc: "chat #conversasfakes",
      create_time: 1763000000,
      author: { unique_id: "conversas.falsas", nickname: "Chat", follower_count: 12 },
      statistics: { play_count: 40, digg_count: 2, comment_count: 1, share_count: 1, collect_count: 5 },
      video: { duration: 18000, cover: { url_list: ["https://cdn.example/c.jpg"] } },
      is_aigc: true,
    },
    "search",
  );
  assert.equal(aweme.durationSec, 18);
  assert.equal(aweme.saves, 5);
  assert.equal(aweme.authorFollowers, 12);
  assert.equal(aweme.aiMeta, true);
  assert.equal(aweme.url, "https://www.tiktok.com/@conversas.falsas/video/7100000000000003333");
  assert.equal(normalizeItem({ text: "sem id" }, "search"), null);
  assert.equal(
    normalizeItem({ id: "7100000000000004444", duration: 15000, playCount: 1 }, "search").durationSec,
    15,
  );
  assert.equal(
    normalizeItem({ id: "7100000000000004444", duration: 0, playCount: 1 }, "search").durationSec,
    null,
  );
});

test("a heurística sem rosto/IA e o detector de idioma separam formatos BR de ruído", () => {
  const terror = classify({
    caption: "História de terror narrada por IA",
    hashtags: ["historiasdeterror", "ia", "narracao"],
    aiMeta: false,
  });
  assert.equal(terror.faceless, true);
  assert.equal(terror.language, "pt");
  assert.ok(terror.niches.some((niche) => niche.id === "terror"));
  assert.ok(terror.niches.some((niche) => niche.id === "ia"));

  const dance = classify({ caption: "A trend #dance", hashtags: ["dance", "ia"], aiMeta: false });
  assert.equal(dance.faceless, false);

  const football = classify({
    caption: "DAVID RAYA #PremierLeague #narracaoemocionante #editfootball #defesasdegoleiro",
    hashtags: ["premierleague", "narracaoemocionante", "editfootball", "defesasdegoleiro"],
    aiMeta: false,
  });
  assert.equal(football.faceless, false);
  assert.ok(!football.niches.some((niche) => niche.id === "narracao"));

  const fruitAi = classify({
    author: "alertax_",
    authorName: "PlotIA",
    caption: "#miniseries #frutinovelas #aifruitstories #frutas",
    hashtags: ["miniseries", "frutinovelas", "aifruitstories", "frutas"],
    aiMeta: false,
  });
  assert.equal(fruitAi.faceless, true);
  assert.ok(fruitAi.niches.some((niche) => niche.id === "ia"));

  const whatsapp = classify({
    author: "midia.bee",
    caption: "Casamento Cancelado - PARTE 1 #novelinhas #conversasdowhatsapp",
    hashtags: ["novelinhas", "conversasdowhatsapp"],
    aiMeta: false,
  });
  assert.equal(whatsapp.faceless, true);
  assert.ok(whatsapp.niches.some((niche) => niche.id === "conversas"));

  const onlyPasta = classify({ caption: "creepypasta", hashtags: ["creepypasta"], aiMeta: false });
  assert.equal(onlyPasta.faceless, false);

  const meta = classify({ caption: "olha isso", hashtags: [], aiMeta: true });
  assert.equal(meta.faceless, true);
  assert.deepEqual(meta.niches, [{ id: "outros", label: "Outros" }]);
  assert.ok(meta.facelessReasons.includes("metadado de IA"));

  assert.equal(
    detectLanguage({
      caption: "¿Solo el 1% puede resolver esto? Desapareció en 1981",
      hashtags: ["acertijo", "parati"],
    }),
    "es",
  );
  assert.equal(
    detectLanguage({
      caption: "Desert vibes #CamelUK #UKTikTok #AnimalLover",
      hashtags: ["cameluk", "uktiktok", "animallover"],
    }),
    "en",
  );
});

test("o catálogo de exemplo calcula crescimento/hora, explosão, série e nicho", async () => {
  const dir = temporaryDir();
  const catalog = await main(["--fixture", "--out", dir], {});
  assert.equal(catalog.source, "fixture");
  assert.equal(catalog.videoCount, 10);
  assert.equal(catalog.videos[0].id, "7100000000000001001");
  const lead = catalog.videos[0];
  assert.equal(lead.growthViews, 120000);
  assert.equal(lead.growthHours, 4);
  assert.equal(lead.growthPerHour, 30000);
  assert.equal(lead.viewsPerHour, 8666.7);
  assert.equal(lead.engagementRate, 0.1269);
  assert.ok(lead.breakoutScore > 0);
  assert.equal(lead.faceless, true);
  assert.equal(lead.durationSec, 27);
  assert.equal(lead.authorFollowers, 4200);
  assert.deepEqual(
    lead.history.map((point) => point.views),
    [80000, 140000, 260000],
  );
  assert.ok(lead.sources.includes("trending"));
  assert.ok(lead.sources.includes("search"));

  const byId = new Map(catalog.videos.map((video) => [video.id, video]));
  assert.equal(byId.get("7100000000000001006").faceless, false);
  assert.equal(byId.get("7100000000000001010").faceless, true);
  assert.equal(byId.get("7100000000000001010").aiMeta, true);
  assert.equal(byId.get("7100000000000001003").durationSec, 18);
  assert.equal(byId.get("7100000000000001002").author, "fatos.narrados");
  const face = catalog.videos.findIndex((video) => video.id === "7100000000000001006");
  const facts = catalog.videos.findIndex((video) => video.id === "7100000000000001002");
  assert.ok(face < facts);

  const again = await main(["--fixture", "--out", dir], {});
  assert.equal(again.videos[0].history.length, 3);
});

test("snapshots antigos são podados e duas coletas na mesma hora fundem itens sem perda", () => {
  const dir = temporaryDir();
  for (let hour = 0; hour < 5; hour += 1) {
    writeSnapshot(dir, {
      collectedAt: `2026-11-01T0${hour}:15:00.000Z`,
      items: [],
    });
  }
  assert.equal(snapshotFileName("2026-11-13T21:57:00.000Z"), "2026-11-13T21.json");
  const removed = pruneSnapshots(dir, 2);
  assert.deepEqual(removed, ["2026-11-01T00.json", "2026-11-01T01.json", "2026-11-01T02.json"]);
  assert.deepEqual(listSnapshotFiles(dir), ["2026-11-01T03.json", "2026-11-01T04.json"]);

  const mergeDir = temporaryDir();
  writeSnapshot(mergeDir, {
    collectedAt: "2026-11-13T10:05:00.000Z",
    keywords: ["feito com ia"],
    itemsReceived: 1,
    estimatedUsd: 0.0003,
    items: [{ id: "7100000000000009001", views: 100, hashtags: [], sources: ["search"] }],
  });
  writeSnapshot(mergeDir, {
    collectedAt: "2026-11-13T10:40:00.000Z",
    keywords: ["fatos curiosos"],
    itemsReceived: 1,
    estimatedUsd: 0.0003,
    items: [{ id: "7100000000000009002", views: 200, hashtags: [], sources: ["trending"] }],
  });
  const loaded = readSnapshots(mergeDir);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].items.length, 2);
  assert.deepEqual(loaded[0].keywords, ["feito com ia", "fatos curiosos"]);
});

test("detector de expiração de capa e cache local funcionam", async () => {
  const now = new Date("2026-11-18T06:00:00.000Z");
  const expiredSec = Math.floor(new Date("2026-11-17T00:00:00.000Z").getTime() / 1000);
  const validSec = Math.floor(new Date("2026-11-19T00:00:00.000Z").getTime() / 1000);
  assert.equal(isCoverExpired(`https://p16.tiktokcdn.com/img.webp?x-expires=${expiredSec}`, now), true);
  assert.equal(isCoverExpired(`https://p16.tiktokcdn.com/img.webp?x-expires=${validSec}`, now), false);

  const cacheDir = temporaryDir();
  const fakeBytes = new Uint8Array(120).fill(7);
  const cached = await cacheCovers(
    [
      { id: "7100000000000007777", coverUrl: `https://cdn.example/a.webp?x-expires=${validSec}` },
      { id: "7100000000000008888", coverUrl: `https://cdn.example/b.webp?x-expires=${expiredSec}` },
    ],
    cacheDir,
    {
      now,
      fetchImpl: async () =>
        new Response(fakeBytes, {
          status: 200,
          headers: { "content-type": "image/webp" },
        }),
    },
  );
  assert.equal(cached.get("7100000000000007777"), "7100000000000007777.webp");
  assert.equal(cached.has("7100000000000008888"), false);
});

test("sem APIFY_TOKEN a coleta ao vivo falha com a mensagem do segredo", () => {
  const result = spawnSync(process.execPath, ["collector/collect.js"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, APIFY_TOKEN: "" },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /APIFY_TOKEN/);
  assert.match(MISSING_TOKEN_MESSAGE, /Settings → Secrets and variables → Actions/);
});

test("o token não vaza numa mensagem de erro", () => {
  const secret = "apify_api_exemplo_nao_usar_123456";
  assert.equal(redact(`falha ${secret} no corpo`, secret), "falha [REDACTED] no corpo");
  assert.doesNotMatch(fs.readFileSync(path.join(root, "README.md"), "utf8"), /apify_api_[a-z0-9]{8,}/i);
});

test("a interface em português lista os nichos e os workflows estão íntegros", () => {
  const html = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "web/app.js"), "utf8");
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/collect.yml"), "utf8");
  const config = JSON.parse(fs.readFileSync(path.join(root, "config/sources.json"), "utf8"));
  assert.match(html, /lang="pt-BR"/);
  assert.match(html, /Só sem rosto\/IA/);
  assert.match(html, /Última atualização/);
  assert.match(app, /data\/videos\.json/);
  for (const niche of NICHE_OPTIONS) assert.match(html, new RegExp(niche.label));
  assert.match(workflow, /APIFY_TOKEN/);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /GITHUB_REF/);
  assert.doesNotMatch(workflow, /\$\{\{\s*github\.ref\s*\}\}/);
  assert.match(workflow, new RegExp(config.scheduleCron.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(readme, /https:\/\/lippaum\.github\.io\/tiktok-dashboard\//);
  assert.match(readme, /APIFY_TOKEN/);
  assert.match(readme, /US\$ 1,58/);
  const committed = JSON.parse(fs.readFileSync(path.join(root, "data/videos.json"), "utf8"));
  assert.ok(Array.isArray(committed.videos));
  assert.equal(committed.videoCount, committed.videos.length);
});

test("a montagem multiplataforma e o preview local servem o catálogo e capas em cache", async () => {
  const dataDir = temporaryDir();
  const siteDir = temporaryDir();
  const coverCacheDir = temporaryDir();
  await main(["--fixture", "--out", dataDir], {});
  fs.writeFileSync(path.join(coverCacheDir, "7100000000000001001.webp"), Buffer.alloc(128, 1));

  const built = assembleSite({
    rootDir: root,
    dataDir,
    outDir: siteDir,
    coverCacheDir,
  });
  assert.equal(built.videoCount, 10);
  assert.ok(fs.existsSync(path.join(siteDir, "covers/terror.svg")));
  assert.ok(fs.existsSync(path.join(siteDir, "covers/cache/7100000000000001001.webp")));
  const builtCatalog = JSON.parse(fs.readFileSync(path.join(siteDir, "data/videos.json"), "utf8"));
  const lead = builtCatalog.videos.find((v) => v.id === "7100000000000001001");
  assert.equal(lead.coverUrl, "covers/cache/7100000000000001001.webp");

  const preview = await startPreview({
    dataFile: path.join(siteDir, "data/videos.json"),
    coverCacheDir,
    port: 0,
  });
  try {
    const page = await fetch(preview.url);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Radar/);
    const data = await fetch(new URL("data/videos.json", preview.url));
    const catalog = await data.json();
    assert.equal(catalog.videoCount, 10);
    const cover = await fetch(new URL("covers/terror.svg", preview.url));
    assert.equal(cover.status, 200);
    assert.match(await cover.text(), /<svg/);
    const cachedCover = await fetch(new URL("covers/cache/7100000000000001001.webp", preview.url));
    assert.equal(cachedCover.status, 200);
  } finally {
    await preview.close();
  }
});

test("duas coletas geram crescimento/hora e penalizam vídeos esquecidos há dias", () => {
  const now = new Date("2026-11-17T18:00:00.000Z");
  const baseItem = (id, views) => ({
    id,
    url: `https://www.tiktok.com/@conta/video/${id}`,
    caption: "narração de IA #ia #narracao",
    coverUrl: null,
    author: "conta",
    authorName: "Conta",
    authorFollowers: 10,
    views,
    likes: 10,
    comments: 2,
    shares: 3,
    saves: 5,
    durationSec: 20,
    postedAt: "2026-11-17T08:00:00.000Z",
    hashtags: ["narracao", "ia"],
    sources: ["search"],
    aiMeta: false,
  });
  const catalog = buildCatalog([
    {
      collectedAt: "2026-11-14T10:00:00.000Z",
      mode: "live",
      items: [baseItem("7100000000000005551", 1000)],
    },
    {
      collectedAt: "2026-11-14T14:00:00.000Z",
      mode: "live",
      items: [baseItem("7100000000000005551", 2000)],
    },
    {
      collectedAt: "2026-11-17T14:00:00.000Z",
      mode: "live",
      items: [baseItem("7100000000000005552", 100)],
    },
    {
      collectedAt: now.toISOString(),
      mode: "live",
      items: [baseItem("7100000000000005552", 700)],
    },
  ]);
  assert.equal(catalog.videos[0].id, "7100000000000005552");
  assert.equal(catalog.videos[0].growthViews, 600);
  assert.equal(catalog.videos[0].growthHours, 4);
  assert.equal(catalog.videos[0].growthPerHour, 150);
  assert.equal(catalog.videos[0].engagementRate, roundExpected((10 + 2 + 3 + 5) / 700));
  assert.equal(catalog.videos[1].hoursSinceLastSeen, 76);
});

function roundExpected(value) {
  return Math.round(value * 10_000) / 10_000;
}
