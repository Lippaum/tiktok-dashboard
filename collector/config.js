import fs from "node:fs";

import { round } from "./util.js";

const SORT_TYPES = new Set(["0", "1", "3"]);
const PUBLISH_TIMES = new Set(["0", "1", "7", "30", "90", "180"]);
const ACTOR_ID = /^[\w.\-]+\/[\w.\-]+$/;

export const MISSING_TOKEN_MESSAGE =
  "Falta o segredo APIFY_TOKEN. No GitHub: Settings → Secrets and variables → Actions → New repository secret. Nome: APIFY_TOKEN. Valor: o token em https://console.apify.com/settings/integrations. Sem esse segredo a coleta não roda. Nada foi enviado para a Apify.";

function requireInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} precisa ser um inteiro entre ${min} e ${max}.`);
  }
  return value;
}

export function loadConfig(file) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Não consegui ler ${file}: ${error.message}`);
  }
  if (!/^[A-Z]{2}$/.test(raw.region || "")) {
    throw new Error("region precisa ser um código ISO de 2 letras, por exemplo BR.");
  }
  if (!ACTOR_ID.test(raw.trending?.actorId || "") || !ACTOR_ID.test(raw.search?.actorId || "")) {
    throw new Error("actorId precisa ter o formato usuario/actor.");
  }
  const sortType = String(raw.search?.sortType ?? "");
  const publishTime = String(raw.search?.publishTime ?? "");
  if (!SORT_TYPES.has(sortType)) throw new Error("search.sortType precisa ser 0, 1 ou 3.");
  if (!PUBLISH_TIMES.has(publishTime)) {
    throw new Error("search.publishTime precisa ser 0, 1, 7, 30, 90 ou 180.");
  }
  const keywords = raw.search?.keywords;
  if (!Array.isArray(keywords) || keywords.length === 0) {
    throw new Error("search.keywords precisa ter pelo menos uma busca.");
  }
  for (const keyword of keywords) {
    if (typeof keyword?.query !== "string" || !keyword.query.trim()) {
      throw new Error("Cada keyword precisa de query.");
    }
  }

  return {
    region: raw.region,
    scheduleCron: raw.scheduleCron,
    intervalHours: requireInteger(raw.intervalHours, "intervalHours", 1, 24),
    expectedRunsPerMonth: requireInteger(raw.expectedRunsPerMonth, "expectedRunsPerMonth", 1, 744),
    pricePerThousandUsd: Number(raw.pricePerThousandUsd),
    monthlyBudgetUsd: Number(raw.monthlyBudgetUsd),
    keepSnapshots: requireInteger(raw.keepSnapshots, "keepSnapshots", 2, 90),
    maxHistoryPoints: requireInteger(raw.maxHistoryPoints, "maxHistoryPoints", 2, 90),
    trending: {
      actorId: raw.trending.actorId,
      maxVideosPerRegion: requireInteger(raw.trending.maxVideosPerRegion, "maxVideosPerRegion", 1, 50),
    },
    search: {
      actorId: raw.search.actorId,
      sortType,
      publishTime,
      maxResultsPerKeyword: requireInteger(raw.search.maxResultsPerKeyword, "maxResultsPerKeyword", 1, 20),
      keywordsPerRun: requireInteger(raw.search.keywordsPerRun, "keywordsPerRun", 1, keywords.length),
      keywords: keywords.map((keyword) => ({
        query: keyword.query.trim(),
        niche: keyword.niche || null,
      })),
    },
  };
}

export function selectKeywords(keywords, perRun, now, intervalHours) {
  const take = Math.min(perRun, keywords.length);
  if (take >= keywords.length) return keywords.slice();
  const slot = Math.floor(now.getTime() / (intervalHours * 3_600_000));
  const start = (slot * take) % keywords.length;
  const chosen = [];
  for (let index = 0; index < take; index += 1) {
    chosen.push(keywords[(start + index) % keywords.length]);
  }
  return chosen;
}

export function estimateUsage(config) {
  const keywords = Math.min(config.search.keywordsPerRun, config.search.keywords.length);
  const perRun = config.trending.maxVideosPerRegion + keywords * config.search.maxResultsPerKeyword;
  const monthlyItems = perRun * config.expectedRunsPerMonth;
  const monthlyUsd = (monthlyItems / 1000) * config.pricePerThousandUsd;
  const perRunUsd = (perRun / 1000) * config.pricePerThousandUsd;
  return {
    perRun,
    perRunUsd: round(perRunUsd, 4),
    monthlyItems,
    monthlyUsd: round(monthlyUsd, 2),
  };
}

export function assertWithinBudget(config) {
  if (!Number.isFinite(config.pricePerThousandUsd) || config.pricePerThousandUsd <= 0) {
    throw new Error("pricePerThousandUsd precisa ser um número maior que zero.");
  }
  if (!Number.isFinite(config.monthlyBudgetUsd) || config.monthlyBudgetUsd <= 0) {
    throw new Error("monthlyBudgetUsd precisa ser um número maior que zero.");
  }
  const estimate = estimateUsage(config);
  if (estimate.monthlyUsd > config.monthlyBudgetUsd) {
    throw new Error(
      `Esta configuração pediria cerca de US$ ${estimate.monthlyUsd.toFixed(2)}/mês ` +
        `(${estimate.monthlyItems} resultados × US$ ${config.pricePerThousandUsd} por mil). ` +
        `O teto está em US$ ${config.monthlyBudgetUsd} para caber no crédito grátis de US$ 5 da Apify, com folga. ` +
        "Reduza maxVideosPerRegion, keywordsPerRun ou maxResultsPerKeyword em config/sources.json.",
    );
  }
  return estimate;
}

export function buildTrendingInput(config) {
  return {
    regions: [config.region],
    maxVideosPerRegion: config.trending.maxVideosPerRegion,
  };
}

export function buildSearchInput(config, keywords) {
  return {
    keywords: keywords.map((keyword) => keyword.query),
    region: config.region,
    sortType: config.search.sortType,
    publishTime: config.search.publishTime,
    maxResultsPerKeyword: config.search.maxResultsPerKeyword,
  };
}
