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
import { normalizeItem } from "../collector/normalize.js";
import { listSnapshotFiles, pruneSnapshots, snapshotFileName, writeSnapshot } from "../collector/store.js";
import { classify, NICHE_OPTIONS } from "../collector/tag.js";
import { redact } from "../collector/util.js";
import { startPreview } from "../preview.js";

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
  const keywords = selectKeywords(config.search.keywords, config.search.keywordsPerRun, new Date("2026-01-01T00:00:00.000Z"), 4);
  const search = buildSearchInput(config, keywords);
  assert.deepEqual(Object.keys(search), ["keywords", "region", "sortType", "publishTime", "maxResultsPerKeyword"]);
  assert.equal(search.region, "BR");
  assert.equal(search.sortType, "1");
  assert.equal(search.publishTime, "7");
  assert.equal(search.maxResultsPerKeyword, 4);
  assert.equal(search.keywords.length, 5);
});

test("o rodízio de hashtags cobre a lista em três coletas", () => {
  const config = loadConfig(path.join(root, "config/sources.json"));
  const start = new Date("2026-01-01T00:00:00.000Z");
  const seen = new Set();
  for (let step = 0; step < 3; step += 1) {
    const when = new Date(start.getTime() + step * 4 * 3_600_000);
    for (const keyword of selectKeywords(config.search.keywords, 5, when, 4)) seen.add(keyword.query);
  }
  assert.equal(seen.size, config.search.keywords.length);
});

test("configuração cara demais é recusada", () => {
  const config = loadConfig(path.join(root, "config/sources.json"));
  config.trending.maxVideosPerRegion = 50;
  config.search.keywordsPerRun = config.search.keywords.length;
  config.search.maxResultsPerKeyword = 20;
  assert.throws(() => assertWithinBudget(config), /crédito grátis/);
  assert.ok(estimateUsage(config).monthlyUsd > 4);
});

test("normaliza os três formatos de actor", () => {
  const kaito = normalizeItem({
    id: "7100000000000001111",
    text: "História narrada #terror",
    playCount: "1500",
    diggCount: 100,
    commentCount: 4,
    shareCount: 8,
    createTimeISO: "2026-11-10T12:00:00.000Z",
    authorMeta: { name: "conta.teste", nickName: "Conta", fans: 90 },
    videoMeta: { duration: 27, coverUrl: "https://cdn.example/capa.jpg" },
    webVideoUrl: "https://www.tiktok.com/@conta.teste/video/7100000000000001111",
    hashtags: [{ name: "Terror" }],
    videoUrlNoWatermark: "https://cdn.example/video.mp4",
  }, "trending");
  assert.equal(kaito.id, "7100000000000001111");
  assert.equal(kaito.views, 1500);
  assert.equal(kaito.durationSec, 27);
  assert.equal(kaito.author, "conta.teste");
  assert.equal(kaito.coverUrl, "https://cdn.example/capa.jpg");
  assert.ok(kaito.hashtags.includes("terror"));
  assert.deepEqual(kaito.sources, ["trending"]);

  const flat = normalizeItem({
    "authorMeta.name": "ritmo.da.semana",
    "authorMeta.fans": 10,
    text: "trend #dance",
    playCount: 90,
    diggCount: 3,
    "videoMeta.duration": 14,
    "videoMeta.coverUrl": "covers/dance.svg",
    createTimeISO: "2026-11-12T00:00:00.000Z",
    webVideoUrl: "https://www.tiktok.com/@ritmo.da.semana/video/7100000000000002222",
  }, "search");
  assert.equal(flat.id, "7100000000000002222");
  assert.equal(flat.author, "ritmo.da.semana");
  assert.equal(flat.durationSec, 14);
  assert.equal(flat.coverUrl, "covers/dance.svg");

  const aweme = normalizeItem({
    aweme_id: "7100000000000003333",
    desc: "chat #conversasfakes",
    create_time: 1763000000,
    author: { unique_id: "conversas.falsas", nickname: "Chat", follower_count: 12 },
    statistics: { play_count: 40, digg_count: 2, comment_count: 1, share_count: 1 },
    video: { duration: 18000, cover: { url_list: ["https://cdn.example/c.jpg"] } },
    is_aigc: true,
  }, "search");
  assert.equal(aweme.durationSec, 18);
  assert.equal(aweme.authorFollowers, 12);
  assert.equal(aweme.aiMeta, true);
  assert.equal(aweme.url, "https://www.tiktok.com/@conversas.falsas/video/7100000000000003333");
  assert.equal(normalizeItem({ text: "sem id" }, "search"), null);
  assert.equal(normalizeItem({ id: "7100000000000004444", duration: 15000, playCount: 1 }, "search").durationSec, 15);
  assert.equal(normalizeItem({ id: "7100000000000004444", duration: 27, playCount: 1 }, "search").durationSec, 27);
});

test("a etiqueta sem rosto/IA é uma heurística com limite", () => {
  const terror = classify({
    caption: "História de terror narrada por IA",
    hashtags: ["historiasdeterror", "ia", "narracao"],
    aiMeta: false,
  });
  assert.equal(terror.faceless, true);
  assert.ok(terror.niches.some((niche) => niche.id === "terror"));
  assert.ok(terror.niches.some((niche) => niche.id === "ia"));

  const dance = classify({ caption: "A trend #dance", hashtags: ["dance", "ia"], aiMeta: false });
  assert.equal(dance.faceless, false);

  const onlyPasta = classify({ caption: "creepypasta", hashtags: ["creepypasta"], aiMeta: false });
  assert.equal(onlyPasta.faceless, false);

  const meta = classify({ caption: "olha isso", hashtags: [], aiMeta: true });
  assert.equal(meta.faceless, true);
  assert.deepEqual(meta.niches, [{ id: "outros", label: "Outros" }]);
  assert.ok(meta.facelessReasons.includes("metadado de IA"));

  const accent = classify({ caption: "Mistério narrado", hashtags: ["Mistério"], aiMeta: false });
  assert.ok(accent.niches.some((niche) => niche.id === "misterio"));
  assert.ok(accent.niches.some((niche) => niche.id === "narracao"));
});

test("o catálogo de exemplo calcula crescimento, série e nicho", async () => {
  const dir = temporaryDir();
  const catalog = await main(["--fixture", "--out", dir], {});
  assert.equal(catalog.source, "fixture");
  assert.equal(catalog.videoCount, 10);
  assert.equal(catalog.videos[0].id, "7100000000000001001");
  const lead = catalog.videos[0];
  assert.equal(lead.growthViews, 120000);
  assert.equal(lead.growthHours, 4);
  assert.equal(lead.viewsPerHour, 8666.7);
  assert.equal(lead.engagementRate, 0.1269);
  assert.equal(lead.faceless, true);
  assert.equal(lead.durationSec, 27);
  assert.equal(lead.authorFollowers, 4200);
  assert.deepEqual(lead.history.map((point) => point.views), [80000, 140000, 260000]);
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

test("snapshots antigos são podados e o nome não tem dois-pontos", () => {
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

test("a interface em português lista os nichos e o workflow cobra o segredo", () => {
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
  assert.match(workflow, new RegExp(config.scheduleCron.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(readme, /https:\/\/lippaum\.github\.io\/tiktok-dashboard\//);
  assert.match(readme, /APIFY_TOKEN/);
  assert.match(readme, /US\$ 1,58/);
  const committed = JSON.parse(fs.readFileSync(path.join(root, "data/videos.json"), "utf8"));
  assert.equal(committed.videoCount, 0);
  assert.deepEqual(committed.videos, []);
});

test("o site estático e o preview local servem o catálogo", async () => {
  const dir = temporaryDir();
  await main(["--fixture", "--out", dir], {});
  const preview = await startPreview({ dataFile: path.join(dir, "videos.json"), port: 0 });
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
  } finally {
    await preview.close();
  }

  const site = path.join(root, "_site");
  fs.rmSync(site, { recursive: true, force: true });
  const assembled = spawnSync("bash", ["scripts/assemble-site.sh"], { cwd: root, encoding: "utf8" });
  assert.equal(assembled.status, 0, assembled.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(site, "data/videos.json"), "utf8")).videoCount, 0);
  assert.ok(fs.existsSync(path.join(site, "covers/terror.svg")));
  fs.rmSync(site, { recursive: true, force: true });
});

test("duas coletas geram crescimento a partir do snapshot anterior", () => {
  const now = new Date("2026-11-13T18:00:00.000Z");
  const item = (views, at) => ({
    id: "7100000000000005555",
    url: "https://www.tiktok.com/@conta/video/7100000000000005555",
    caption: "narração de IA",
    coverUrl: null,
    author: "conta",
    authorName: "Conta",
    authorFollowers: 10,
    views,
    likes: 1,
    comments: 0,
    shares: 0,
    durationSec: 20,
    postedAt: "2026-11-13T08:00:00.000Z",
    hashtags: ["narracao", "ia"],
    sources: ["search"],
    aiMeta: false,
  });
  void item;
  const catalog = buildCatalog([
    {
      collectedAt: "2026-11-13T14:00:00.000Z",
      mode: "live",
      itemsReceived: 1,
      estimatedUsd: 0.0003,
      keywords: ["narracao"],
      items: [{ ...item(100), views: 100 }],
    },
    {
      collectedAt: now.toISOString(),
      mode: "live",
      itemsReceived: 1,
      estimatedUsd: 0.0003,
      keywords: ["narracao"],
      items: [{ ...item(250), views: 250 }],
    },
  ]);
  assert.equal(catalog.videos[0].growthViews, 150);
  assert.equal(catalog.videos[0].growthHours, 4);
  assert.equal(catalog.videos[0].viewsPerHour, 25);
  assert.equal(catalog.source, "live");
});
