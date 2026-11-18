const PAGE_SIZE = 36;
const SAVED_STORAGE_KEY = "radar-viral:saved-v1";

const SORT_LABELS = {
  breakout: "ordenados por explosão recente",
  growth: "ordenados por crescimento/hora",
  growthRaw: "ordenados por crescimento bruto",
  vph: "ordenados por visualizações/hora",
  views: "ordenados por visualizações",
  engagement: "ordenados por engajamento",
};

const NICHE_COVER_SVG = {
  ia: "covers/aigc.svg",
  terror: "covers/terror.svg",
  misterio: "covers/farol.svg",
  curiosidades: "covers/curiosidades.svg",
  narracao: "covers/narracao.svg",
  conversas: "covers/chat.svg",
  historias: "covers/historias.svg",
  memes: "covers/meme.svg",
  outros: "covers/outros.svg",
};

const updatedEl = document.querySelector("#updated");
const statusSub = document.querySelector("#status-sub");
const banner = document.querySelector("#banner");
const summaryEl = document.querySelector("#summary");
const countEl = document.querySelector("#count");
const resetInlineBtn = document.querySelector("#reset-inline");
const listEl = document.querySelector("#lista");
const moreWrapEl = document.querySelector("#more-wrap");
const loadMoreBtn = document.querySelector("#load-more");
const savedOnlyBtn = document.querySelector("#saved-only");
const exportCsvBtn = document.querySelector("#export-csv");
const costEl = document.querySelector("#cost");

let catalog = null;
let visibleLimit = PAGE_SIZE;
let lastFiltered = [];
const expandedIds = new Set();
const savedIds = loadSavedIds();

function loadSavedIds() {
  try {
    const raw = localStorage.getItem(SAVED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

function persistSavedIds() {
  try {
    localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify([...savedIds]));
  } catch {
    // Ignora modo privado sem escrita.
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

function foldText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function formatCompact(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  const sign = number < 0 ? "-" : "";
  const abs = Math.abs(number);
  if (abs >= 1_000_000) {
    const scaled = abs / 1_000_000;
    return `${sign}${scaled.toLocaleString("pt-BR", { maximumFractionDigits: scaled >= 10 ? 0 : 1 })} mi`;
  }
  if (abs >= 1_000) {
    const scaled = abs / 1_000;
    return `${sign}${scaled.toLocaleString("pt-BR", { maximumFractionDigits: scaled >= 100 ? 0 : 1 })} mil`;
  }
  return `${sign}${Math.round(abs).toLocaleString("pt-BR")}`;
}

function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatWhen(iso) {
  if (!iso) return "ainda sem coleta";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "ainda sem coleta";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatRelative(iso, now) {
  if (!iso) return "data desconhecida";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "data desconhecida";
  const hours = (now.getTime() - then.getTime()) / 3_600_000;
  if (hours < 0) return "agora";
  if (hours < 1) return `há ${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 36) return `há ${Math.round(hours)} h`;
  const days = hours / 24;
  if (days < 1.5) return "há 1 dia";
  return `há ${Math.round(days)} dias`;
}

function formatHourGap(hours) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
}

function getGrowthPerHour(video) {
  if (video.growthPerHour != null && Number.isFinite(video.growthPerHour)) return video.growthPerHour;
  if (video.growthViews != null && video.growthHours != null && video.growthHours > 0) {
    return video.growthViews / video.growthHours;
  }
  return null;
}

function getHoursSinceLastSeen(video, referenceMs) {
  if (video.hoursSinceLastSeen != null && Number.isFinite(video.hoursSinceLastSeen)) {
    return video.hoursSinceLastSeen;
  }
  const lastAt = video.lastSeenAt || video.history?.at(-1)?.at;
  if (!lastAt) return 0;
  const parsed = Date.parse(lastAt);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, (referenceMs - parsed) / 3_600_000);
}

function freshnessFactor(hoursSinceSeen) {
  if (hoursSinceSeen == null || hoursSinceSeen <= 12) return 1;
  return Math.pow(0.5, (hoursSinceSeen - 12) / 24);
}

function formatGrowth(video) {
  if (video.growthViews == null) return "primeira coleta";
  const rate = getGrowthPerHour(video);
  const sign = video.growthViews > 0 ? "+" : "";
  if (rate != null && video.growthViews > 0) {
    return `+${formatCompact(rate)}/h (${sign}${formatCompact(video.growthViews)})`;
  }
  const gap = video.growthHours == null ? "" : ` em ${formatHourGap(video.growthHours)}`;
  return `${sign}${formatCompact(video.growthViews)}${gap}`;
}

function growthClass(video) {
  if (video.growthViews == null || video.growthViews === 0) return "";
  return video.growthViews > 0 ? "up" : "down";
}

function formatPerHour(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${formatCompact(value)}/h`;
}

function formatEngagement(rate) {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function isCoverExpired(url, now) {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    const raw =
      parsed.searchParams.get("x-expires") ||
      parsed.searchParams.get("expires") ||
      parsed.searchParams.get("X-Expires");
    if (!raw || !/^\d{9,13}$/.test(raw)) return false;
    const value = Number(raw);
    const expiryMs = value < 1e12 ? value * 1000 : value;
    return expiryMs <= now.getTime();
  } catch {
    return false;
  }
}

function safeCover(url, now) {
  if (typeof url !== "string") return "";
  if (/^covers\/(?:cache\/)?[\w.\-]+\.(?:svg|webp|jpg|png|avif)$/i.test(url)) return url;
  if (/^https:\/\//i.test(url)) {
    if (isCoverExpired(url, now)) return "";
    return url;
  }
  return "";
}

function safeVideoUrl(url) {
  if (typeof url !== "string") return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "";
    const host = parsed.hostname.replace(/^www\./, "");
    if (!["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"].includes(host)) return "";
    return parsed.href;
  } catch {
    return "";
  }
}

function authorProfileUrl(author) {
  if (typeof author !== "string" || !/^[\w.\-]+$/.test(author)) return "";
  return `https://www.tiktok.com/@${author}`;
}

function sparkline(history) {
  if (!Array.isArray(history) || history.length < 2) {
    return `<span class="spark-empty">1ª leitura</span>`;
  }
  const values = history.map((point) => point.views);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 120;
  const height = 32;
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * (width - 4) + 2;
    const y = (1 - (value - min) / span) * (height - 8) + 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const [cx, cy] = points.at(-1).split(",");
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="Histórico de visualizações">
    <polyline points="${points.join(" ")}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
    <circle cx="${cx}" cy="${cy}" r="2.6" fill="currentColor"></circle>
  </svg>`;
}

function nicheArtSvg(video) {
  const nicheId = video.niches?.[0]?.id || "outros";
  return NICHE_COVER_SVG[nicheId] || NICHE_COVER_SVG.outros;
}

function coverArtHtml(video, compact = false) {
  const label = video.niches?.[0]?.label || "Vídeo";
  const art = nicheArtSvg(video);
  if (compact) {
    return `<img class="thumb" src="${escapeHtml(art)}" alt="" loading="lazy" decoding="async">`;
  }
  const handle = video.author ? `@${video.author}` : "TikTok BR";
  return `<span class="cover-art" style="background-image:url('${escapeHtml(art)}')">
    <span class="cover-art-label">${escapeHtml(label)}</span>
    <span class="cover-art-sub">${escapeHtml(handle)}</span>
  </span>`;
}

function coverSlotHtml(video, url, now) {
  const cover = safeCover(video.coverUrl, now);
  const nicheId = video.niches?.[0]?.id || "outros";
  const label = video.niches?.[0]?.label || "Vídeo";
  const handle = video.author ? `@${video.author}` : "TikTok BR";
  const saved = savedIds.has(String(video.id));
  const saveBtn = `<button type="button" class="save-pin ${saved ? "is-saved" : ""}" data-save="${escapeHtml(video.id)}" aria-label="${saved ? "Remover dos salvos" : "Salvar vídeo como referência"}" title="${saved ? "Salvo nas suas referências" : "Salvar referência"}">${saved ? "★" : "☆"}</button>`;
  const inner = cover
    ? `<img class="cover" src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-fallback="1" data-niche="${escapeHtml(nicheId)}" data-label="${escapeHtml(label)}" data-handle="${escapeHtml(handle)}">`
    : coverArtHtml(video, false);

  if (url) {
    return `<div class="cover-slot">
      <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir vídeo de ${escapeHtml(handle)} no TikTok" style="display:block;width:100%;height:100%;color:inherit;text-decoration:none">${inner}</a>
      ${saveBtn}
    </div>`;
  }
  return `<div class="cover-slot">${inner}${saveBtn}</div>`;
}

function thumbHtml(video, now) {
  const cover = safeCover(video.coverUrl, now);
  const nicheId = video.niches?.[0]?.id || "outros";
  if (!cover) return `<span class="thumb-wrap">${coverArtHtml(video, true)}</span>`;
  return `<span class="thumb-wrap"><img class="thumb" src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-fallback="thumb" data-niche="${escapeHtml(nicheId)}"></span>`;
}

function badgesHtml(video, refMs) {
  const items = [];
  if (video.faceless) {
    items.push(
      `<span class="badge faceless" title="Heurística pela legenda, hashtags, perfil e metadados. Não confirma sozinha que o vídeo é sem rosto ou feito por IA.">Sem rosto/IA</span>`,
    );
  }
  if (video.growthPercent != null && video.growthPercent >= 80 && getHoursSinceLastSeen(video, refMs) <= 24) {
    items.push(`<span class="badge hot">+${Math.round(video.growthPercent)}%</span>`);
  }
  for (const niche of video.niches || []) {
    items.push(`<span class="badge">${escapeHtml(niche.label)}</span>`);
  }
  if (video.language === "es" || video.language === "en" || video.language === "other") {
    items.push(`<span class="badge foreign">${escapeHtml(video.language.toUpperCase())}</span>`);
  }
  const staleHours = getHoursSinceLastSeen(video, refMs);
  if (staleHours > 18) {
    items.push(
      `<span class="badge stale" title="Última aparição nas coletas da Apify">visto há ${escapeHtml(formatHourGap(staleHours))}</span>`,
    );
  }
  return items.join("");
}

function readControls() {
  return {
    q: document.querySelector("#search").value.trim(),
    niche: document.querySelector("#niche").value,
    lang: document.querySelector("#lang").value,
    fresh: document.querySelector("#fresh").value,
    faceless: document.querySelector("#faceless").checked,
    savedOnly: savedOnlyBtn.getAttribute("aria-pressed") === "true",
    duration: document.querySelector("#duration").value,
    posted: document.querySelector("#posted").value,
    sort: document.querySelector("#sort").value,
    view: document.querySelector("[data-view].is-active")?.dataset.view || "cards",
  };
}

function isDefaultControls(controls) {
  return (
    !controls.q &&
    controls.niche === "todos" &&
    controls.lang === "br" &&
    controls.fresh === "todas" &&
    !controls.faceless &&
    !controls.savedOnly &&
    controls.duration === "todas" &&
    controls.posted === "todas"
  );
}

function syncUrlFromControls(controls) {
  const params = new URLSearchParams();
  if (controls.q) params.set("q", controls.q);
  if (controls.niche !== "todos") params.set("niche", controls.niche);
  if (controls.lang !== "br") params.set("lang", controls.lang);
  if (controls.fresh !== "todas") params.set("fresh", controls.fresh);
  if (controls.faceless) params.set("faceless", "1");
  if (controls.savedOnly) params.set("saved", "1");
  if (controls.duration !== "todas") params.set("duration", controls.duration);
  if (controls.posted !== "todas") params.set("posted", controls.posted);
  if (controls.sort !== "breakout") params.set("sort", controls.sort);
  if (controls.view !== "cards") params.set("view", controls.view);
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
  window.history.replaceState(null, "", next);
}

function applyControlsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const setSelect = (selector, param) => {
    const value = params.get(param);
    const el = document.querySelector(selector);
    if (value && el && [...el.options].some((opt) => opt.value === value)) {
      el.value = value;
    }
  };
  if (params.get("q")) document.querySelector("#search").value = params.get("q");
  setSelect("#niche", "niche");
  setSelect("#lang", "lang");
  setSelect("#fresh", "fresh");
  setSelect("#duration", "duration");
  setSelect("#posted", "posted");
  setSelect("#sort", "sort");
  if (params.get("faceless") === "1") document.querySelector("#faceless").checked = true;
  if (params.get("saved") === "1") savedOnlyBtn.setAttribute("aria-pressed", "true");
  const view = params.get("view");
  if (view === "table" || view === "cards") {
    document.querySelectorAll("[data-view]").forEach((btn) => {
      const active = btn.dataset.view === view;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }
}

function passes(video, controls, now, refMs) {
  if (controls.savedOnly && !savedIds.has(String(video.id))) return false;
  if (controls.niche !== "todos" && !(video.niches || []).some((niche) => niche.id === controls.niche)) {
    return false;
  }
  if (controls.faceless && !video.faceless) return false;
  if (controls.lang === "br" && ["es", "en", "other"].includes(video.language)) {
    return false;
  }
  if (controls.lang === "pt" && video.language !== "pt") {
    return false;
  }
  if (controls.fresh !== "todas") {
    const maxSeenHours = Number(controls.fresh);
    if (getHoursSinceLastSeen(video, refMs) > maxSeenHours) return false;
  }
  const seconds = video.durationSec;
  if (controls.duration !== "todas" && !document.querySelector("#duration").disabled) {
    if (seconds == null) return false;
    if (controls.duration === "short" && seconds > 30) return false;
    if (controls.duration === "mid" && (seconds <= 30 || seconds >= 60)) return false;
    if (controls.duration === "long" && seconds < 60) return false;
  }
  if (controls.posted !== "todas") {
    const posted = Date.parse(video.postedAt || "");
    if (Number.isNaN(posted)) return false;
    const age = now.getTime() - posted;
    const days = Number(controls.posted);
    if (age < 0 || age > days * 86_400_000) return false;
  }
  if (controls.q) {
    const needle = foldText(controls.q.replace(/^[#@]/, ""));
    const hay = foldText(
      `${video.caption || ""} ${video.author || ""} ${video.authorName || ""} ${(video.hashtags || []).join(" ")}`,
    );
    if (!hay.includes(needle)) return false;
  }
  return true;
}

function sortVideos(videos, sort, refMs) {
  const pick = {
    breakout: (video) => {
      if (video.breakoutScore != null) return video.breakoutScore;
      const rate = getGrowthPerHour(video) ?? video.viewsPerHour ?? 0;
      return rate * freshnessFactor(getHoursSinceLastSeen(video, refMs));
    },
    growth: (video) => {
      const rate = getGrowthPerHour(video);
      if (rate == null) return null;
      return rate * freshnessFactor(getHoursSinceLastSeen(video, refMs));
    },
    growthRaw: (video) => video.growthViews,
    vph: (video) => video.viewsPerHour,
    views: (video) => video.views,
    engagement: (video) => video.engagementRate,
  }[sort] || ((video) => video.views);

  return videos.slice().sort((a, b) => {
    const left = pick(a);
    const right = pick(b);
    if (left == null && right == null) return (b.viewsPerHour ?? b.views ?? 0) - (a.viewsPerHour ?? a.views ?? 0);
    if (left == null) return 1;
    if (right == null) return -1;
    if (right !== left) return right - left;
    return (b.viewsPerHour ?? b.views ?? 0) - (a.viewsPerHour ?? a.views ?? 0);
  });
}

function median(values) {
  const valid = values.filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!valid.length) return null;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 1 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
}

function paintSummary(shown, refMs) {
  if (!shown.length) {
    summaryEl.hidden = true;
    summaryEl.innerHTML = "";
    return;
  }
  const activeCount = shown.filter((v) => getHoursSinceLastSeen(v, refMs) <= 36).length;
  const medVph = median(shown.map((v) => v.viewsPerHour));
  const medEng = median(shown.map((v) => v.engagementRate));
  const nicheCounts = new Map();
  for (const video of shown) {
    for (const niche of video.niches || []) {
      if (niche.id === "outros" && shown.length > 5) continue;
      nicheCounts.set(niche.label, (nicheCounts.get(niche.label) || 0) + 1);
    }
  }
  const topNiche = [...nicheCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  summaryEl.hidden = false;
  summaryEl.innerHTML = `
    <div class="kpi">
      <p class="kpi-label">Ativos (≤ 36h)</p>
      <p class="kpi-value">${activeCount} <span style="font-size:0.95rem;color:var(--muted)">/ ${shown.length}</span></p>
      <p class="kpi-sub">vistos nas coletas mais recentes</p>
    </div>
    <div class="kpi">
      <p class="kpi-label">Ritmo mediano</p>
      <p class="kpi-value">${formatPerHour(medVph)}</p>
      <p class="kpi-sub">régua de tração deste recorte</p>
    </div>
    <div class="kpi">
      <p class="kpi-label">Engajamento mediano</p>
      <p class="kpi-value">${formatEngagement(medEng)}</p>
      <p class="kpi-sub">curtidas, comentários, shares e saves</p>
    </div>
    <div class="kpi">
      <p class="kpi-label">Nicho em destaque</p>
      <p class="kpi-value">${escapeHtml(topNiche ? topNiche[0] : "Geral")}</p>
      <p class="kpi-sub">${topNiche ? `${topNiche[1]} vídeos neste filtro` : "distribuição mista"}</p>
    </div>
  `;
}

function updateNicheOptionCounts() {
  if (!catalog?.videos?.length) return;
  const select = document.querySelector("#niche");
  for (const option of select.options) {
    if (!option.dataset.baseLabel) option.dataset.baseLabel = option.textContent;
    if (option.value === "todos") {
      option.textContent = `${option.dataset.baseLabel} (${catalog.videos.length})`;
      continue;
    }
    const total = catalog.videos.filter((v) => (v.niches || []).some((n) => n.id === option.value)).length;
    option.textContent = `${option.dataset.baseLabel} (${total})`;
  }
}

function syncDurationAvailability() {
  const select = document.querySelector("#duration");
  const label = document.querySelector("#duration-label");
  const hasAnyDuration = catalog?.videos?.some((v) => v.durationSec != null && v.durationSec > 0);
  if (!hasAnyDuration && catalog?.videos?.length) {
    select.value = "todas";
    select.disabled = true;
    select.title = "O scraper atual não enviou a duração dos vídeos neste lote.";
    if (label) label.textContent = "Duração (indisponível)";
  } else {
    select.disabled = false;
    select.title = "";
    if (label) label.textContent = "Duração";
  }
}

function updateSavedButton() {
  const total = savedIds.size;
  savedOnlyBtn.textContent = `★ Salvos (${total})`;
}

function engagementBreakdownTitle(video) {
  const parts = [
    `${formatCompact(video.likes)} curtidas`,
    `${formatCompact(video.comments)} comentários`,
    `${formatCompact(video.shares)} compartilhamentos`,
  ];
  if (video.saves > 0) parts.push(`${formatCompact(video.saves)} salvamentos`);
  return parts.join(" · ");
}

function cardHtml(video, now, refMs, hasDurations) {
  const url = safeVideoUrl(video.url);
  const profileUrl = authorProfileUrl(video.author);
  const authorText = video.author ? `@${video.author}` : "autor desconhecido";
  const followers = video.authorFollowers != null ? ` · ${formatCompact(video.authorFollowers)} seg.` : "";
  const authorHtml = profileUrl
    ? `<a href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer" title="Ver perfil completo no TikTok">${escapeHtml(authorText)}</a>${escapeHtml(followers)}`
    : `${escapeHtml(authorText)}${escapeHtml(followers)}`;

  const captionText = video.caption || "Sem legenda";
  const expanded = expandedIds.has(String(video.id));
  const canExpand = captionText.length > 125;
  const expandBtn = canExpand
    ? `<button type="button" class="expand-btn" data-expand="${escapeHtml(video.id)}">${expanded ? "Recolher legenda" : "Ler legenda completa"}</button>`
    : "";

  const tags = (video.hashtags || [])
    .slice(0, 5)
    .map((tag) => `<button type="button" class="tag-chip" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`)
    .join("");
  const tagRow = tags ? `<div class="tag-row">${tags}</div>` : "";

  const reasons =
    video.faceless && video.facelessReasons?.length
      ? `<p class="reasons">Sinais: ${escapeHtml(video.facelessReasons.join(" · "))}</p>`
      : "";

  const extraMetric = hasDurations
    ? `<div><dt>Duração</dt><dd>${formatDuration(video.durationSec)}</dd></div>`
    : `<div><dt>Engajamento</dt><dd title="${escapeHtml(engagementBreakdownTitle(video))}">${formatEngagement(video.engagementRate)}</dd></div>`;

  const open = url
    ? `<a class="open" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Abrir no TikTok</a>`
    : "";
  const copyBtn = video.caption
    ? `<button type="button" class="ghost-btn" data-copy="${escapeHtml(video.id)}">Copiar gancho</button>`
    : "";

  return `<article class="card">
    ${coverSlotHtml(video, url, now)}
    <div class="card-body">
      <div class="badges">${badgesHtml(video, refMs)}</div>
      <h2 class="caption ${expanded ? "is-expanded" : ""}">${escapeHtml(captionText)}</h2>
      ${expandBtn}
      <p class="author">${authorHtml}</p>
      ${tagRow}
      <dl class="metrics">
        <div><dt>Visualizações</dt><dd>${formatCompact(video.views)}</dd></div>
        <div><dt>Crescimento</dt><dd class="${growthClass(video)}">${escapeHtml(formatGrowth(video))}</dd></div>
        <div><dt>Vis./hora</dt><dd>${formatPerHour(video.viewsPerHour)}</dd></div>
        ${extraMetric}
        <div><dt>Curtidas</dt><dd>${formatCompact(video.likes)}</dd></div>
        <div><dt>Publicado</dt><dd>${escapeHtml(formatRelative(video.postedAt, now))}</dd></div>
      </dl>
      <div class="spark-row"><span class="spark-label">Histórico</span>${sparkline(video.history)}</div>
      ${reasons}
      <div class="card-actions">${open}${copyBtn}</div>
    </div>
  </article>`;
}

function sortHeaderHtml(label, sortKey, currentSort) {
  const active = currentSort === sortKey;
  const arrow = active ? " ↓" : "";
  return `<button type="button" class="th-sort ${active ? "is-sorted" : ""}" data-sort-col="${sortKey}">${escapeHtml(label)}${arrow}</button>`;
}

function tableHtml(videos, now, currentSort) {
  const rows = videos
    .map((video) => {
      const url = safeVideoUrl(video.url);
      const profileUrl = authorProfileUrl(video.author);
      const title = escapeHtml(video.caption || "Sem legenda");
      const link = url
        ? `<a class="table-caption" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${title}</a>`
        : `<span class="table-caption">${title}</span>`;
      const authorLink = profileUrl
        ? `<a href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer" style="color:inherit">@${escapeHtml(video.author)}</a>`
        : escapeHtml(video.author ? `@${video.author}` : "—");
      const niches = (video.niches || []).map((niche) => niche.label).join(", ");
      const tag = video.faceless ? "Sem rosto/IA" : "—";
      const saved = savedIds.has(String(video.id));
      return `<tr>
        <td>${thumbHtml(video, now)}</td>
        <td>${link}<div class="author">${escapeHtml(tag)}${niches ? ` · ${escapeHtml(niches)}` : ""}</div></td>
        <td>${authorLink}</td>
        <td>${formatCompact(video.views)}</td>
        <td class="${growthClass(video)}">${escapeHtml(formatGrowth(video))}<div>${sparkline(video.history)}</div></td>
        <td>${formatPerHour(video.viewsPerHour)}</td>
        <td title="${escapeHtml(engagementBreakdownTitle(video))}">${formatEngagement(video.engagementRate)}</td>
        <td>${escapeHtml(formatRelative(video.postedAt, now))}</td>
        <td><button type="button" class="ghost-btn" data-save="${escapeHtml(video.id)}">${saved ? "★" : "☆"}</button></td>
      </tr>`;
    })
    .join("");
  return `<p class="scroll-hint">Arraste a tabela para o lado ou clique nos títulos para ordenar.</p>
    <table>
      <caption class="sr-only">Vídeos em alta no TikTok Brasil</caption>
      <thead>
        <tr>
          <th scope="col">Capa</th>
          <th scope="col">Vídeo</th>
          <th scope="col">Autor</th>
          <th scope="col">${sortHeaderHtml("Visualizações", "views", currentSort)}</th>
          <th scope="col">${sortHeaderHtml("Crescimento", "growth", currentSort)}</th>
          <th scope="col">${sortHeaderHtml("Vis./hora", "vph", currentSort)}</th>
          <th scope="col">${sortHeaderHtml("Engajamento", "engagement", currentSort)}</th>
          <th scope="col">Publicado</th>
          <th scope="col">Ref.</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function emptyDataHtml() {
  return `<section class="empty">
    <p class="empty-kicker">Ainda sem coleta</p>
    <h2>Nada por aqui ainda</h2>
    <p>O radar espera a primeira execução do workflow <strong>Coletar TikTok</strong>. Quando ela terminar e o site publicar de novo, os vídeos que mais crescem no Brasil aparecem neste painel.</p>
  </section>`;
}

function emptyFilterHtml() {
  return `<section class="empty">
    <p class="empty-kicker">Filtro sem resultado</p>
    <h2>Nenhum vídeo com esses filtros</h2>
    <p>Experimente limpar a busca, trocar o nicho, mudar o idioma para “Todos” ou desligar “Só sem rosto/IA”.</p>
    <button type="button" class="clear" id="clear">Limpar filtros</button>
  </section>`;
}

function paintStatus() {
  updatedEl.textContent = formatWhen(catalog.updatedAt);
  const region = catalog.region || "BR";
  if (!catalog.videos.length) {
    statusSub.textContent = `Região ${region}. Nenhuma coleta concluída.`;
  } else {
    const faceless = catalog.videos.filter((video) => video.faceless).length;
    statusSub.textContent = `Região ${region} · ${catalog.videoCount} vídeos · ${faceless} na heurística sem rosto/IA`;
  }
  if (catalog.source === "fixture") {
    banner.hidden = false;
    banner.textContent =
      "Dados de exemplo, gerados neste computador. A coleta real substitui este painel pelos vídeos do TikTok no Brasil.";
  } else {
    banner.hidden = true;
    banner.textContent = "";
  }
  if (catalog.source === "live" && catalog.run && catalog.run.estimatedUsd != null) {
    const usd = Number(catalog.run.estimatedUsd).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
    const queries = Array.isArray(catalog.run.keywords) && catalog.run.keywords.length
      ? ` · buscas da rodada: ${catalog.run.keywords.join(", ")}`
      : "";
    costEl.textContent = `Última coleta: ${catalog.run.itemsReceived ?? "?"} resultados · custo estimado US$ ${usd}${queries}.`;
  } else {
    costEl.textContent = "";
  }
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.classList.contains("is-active");
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  updateSavedButton();
}

function render({ keepLimit = false } = {}) {
  if (!catalog) return;
  if (!keepLimit) visibleLimit = PAGE_SIZE;
  const now = new Date();
  const refMs = catalog.updatedAt ? Date.parse(catalog.updatedAt) || now.getTime() : now.getTime();
  paintStatus();

  if (!catalog.videos.length) {
    summaryEl.hidden = true;
    countEl.textContent = "";
    resetInlineBtn.hidden = true;
    moreWrapEl.hidden = true;
    listEl.className = "";
    listEl.innerHTML = emptyDataHtml();
    return;
  }

  const controls = readControls();
  syncUrlFromControls(controls);
  resetInlineBtn.hidden = isDefaultControls(controls);

  const filtered = sortVideos(
    catalog.videos.filter((video) => passes(video, controls, now, refMs)),
    controls.sort,
    refMs,
  );
  lastFiltered = filtered;
  paintSummary(filtered, refMs);

  countEl.textContent = `${filtered.length} de ${catalog.videoCount} vídeos · ${SORT_LABELS[controls.sort] || ""}`;
  if (!filtered.length) {
    moreWrapEl.hidden = true;
    listEl.className = "";
    listEl.innerHTML = emptyFilterHtml();
    return;
  }

  const slice = filtered.slice(0, visibleLimit);
  const hasDurations = slice.some((v) => v.durationSec != null && v.durationSec > 0);
  listEl.className = controls.view === "table" ? "table-wrap" : "grid";
  listEl.innerHTML =
    controls.view === "table"
      ? tableHtml(slice, now, controls.sort)
      : slice.map((video) => cardHtml(video, now, refMs, hasDurations)).join("");

  if (filtered.length > visibleLimit) {
    const remaining = filtered.length - visibleLimit;
    moreWrapEl.hidden = false;
    loadMoreBtn.textContent = `Mostrar mais ${Math.min(PAGE_SIZE, remaining)} vídeos (${remaining} restantes)`;
  } else {
    moreWrapEl.hidden = true;
  }
}

function resetFilters() {
  document.querySelector("#search").value = "";
  document.querySelector("#niche").value = "todos";
  document.querySelector("#lang").value = "br";
  document.querySelector("#fresh").value = "todas";
  document.querySelector("#faceless").checked = false;
  savedOnlyBtn.setAttribute("aria-pressed", "false");
  document.querySelector("#duration").value = "todas";
  document.querySelector("#posted").value = "todas";
  document.querySelector("#sort").value = "breakout";
}

function exportCsv() {
  if (!lastFiltered.length) return;
  const header = [
    "id",
    "autor",
    "url",
    "visualizacoes",
    "crescimento_views",
    "crescimento_por_hora",
    "views_por_hora",
    "engajamento_pct",
    "curtidas",
    "comentarios",
    "compartilhamentos",
    "salvamentos",
    "sem_rosto_ia",
    "idioma",
    "nichos",
    "publicado_em",
    "legenda",
  ];
  const esc = (val) => `"${String(val ?? "").replace(/"/g, '""')}"`;
  const lines = [header.join(",")];
  for (const v of lastFiltered) {
    lines.push(
      [
        esc(v.id),
        esc(v.author ? `@${v.author}` : ""),
        esc(v.url || ""),
        v.views ?? "",
        v.growthViews ?? "",
        getGrowthPerHour(v) != null ? Math.round(getGrowthPerHour(v)) : "",
        v.viewsPerHour ?? "",
        v.engagementRate != null ? (v.engagementRate * 100).toFixed(2) : "",
        v.likes ?? 0,
        v.comments ?? 0,
        v.shares ?? 0,
        v.saves ?? 0,
        v.faceless ? "sim" : "nao",
        esc(v.language || ""),
        esc((v.niches || []).map((n) => n.label).join("|")),
        esc(v.postedAt || ""),
        esc((v.caption || "").replace(/\s+/g, " ").trim()),
      ].join(","),
    );
  }
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `radar-viral-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

function bind() {
  for (const id of ["niche", "lang", "fresh", "duration", "posted", "sort"]) {
    document.querySelector(`#${id}`).addEventListener("change", () => render());
  }
  let searchTimer = null;
  document.querySelector("#search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => render(), 120);
  });
  document.querySelector("#faceless").addEventListener("change", () => render());

  savedOnlyBtn.addEventListener("click", () => {
    const active = savedOnlyBtn.getAttribute("aria-pressed") === "true";
    savedOnlyBtn.setAttribute("aria-pressed", active ? "false" : "true");
    render();
  });

  exportCsvBtn.addEventListener("click", exportCsv);

  loadMoreBtn.addEventListener("click", () => {
    visibleLimit += PAGE_SIZE;
    render({ keepLimit: true });
  });

  resetInlineBtn.addEventListener("click", () => {
    resetFilters();
    render();
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-view]").forEach((other) => {
        other.classList.toggle("is-active", other === button);
      });
      render({ keepLimit: true });
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName || "")) {
      event.preventDefault();
      document.querySelector("#search").focus();
    }
  });

  document.body.addEventListener("click", async (event) => {
    if (event.target.closest("#clear")) {
      resetFilters();
      render();
      return;
    }
    const saveBtn = event.target.closest("[data-save]");
    if (saveBtn) {
      event.preventDefault();
      const id = String(saveBtn.dataset.save);
      if (savedIds.has(id)) savedIds.delete(id);
      else savedIds.add(id);
      persistSavedIds();
      render({ keepLimit: true });
      return;
    }
    const tagBtn = event.target.closest("[data-tag]");
    if (tagBtn) {
      document.querySelector("#search").value = `#${tagBtn.dataset.tag}`;
      render();
      return;
    }
    const expandBtn = event.target.closest("[data-expand]");
    if (expandBtn) {
      const id = String(expandBtn.dataset.expand);
      if (expandedIds.has(id)) expandedIds.delete(id);
      else expandedIds.add(id);
      render({ keepLimit: true });
      return;
    }
    const sortCol = event.target.closest("[data-sort-col]");
    if (sortCol) {
      document.querySelector("#sort").value = sortCol.dataset.sortCol;
      render({ keepLimit: true });
      return;
    }
    const copyBtn = event.target.closest("[data-copy]");
    if (copyBtn && catalog?.videos) {
      const target = catalog.videos.find((v) => String(v.id) === String(copyBtn.dataset.copy));
      if (target) {
        const text = `${target.caption || ""}${target.url ? `\n${target.url}` : ""}`.trim();
        try {
          await navigator.clipboard.writeText(text);
          copyBtn.textContent = "Copiado!";
          setTimeout(() => {
            copyBtn.textContent = "Copiar gancho";
          }, 1500);
        } catch {
          // Sem permissão de clipboard no contexto atual.
        }
      }
    }
  });

  listEl.addEventListener(
    "error",
    (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement)) return;
      const art = NICHE_COVER_SVG[image.dataset.niche] || NICHE_COVER_SVG.outros;
      if (image.dataset.fallback === "thumb") {
        image.dataset.fallback = "done";
        image.src = art;
        return;
      }
      if (image.dataset.fallback !== "1") return;
      const wrapper = document.createElement("span");
      wrapper.className = "cover-art";
      wrapper.style.backgroundImage = `url('${art}')`;
      const lbl = document.createElement("span");
      lbl.className = "cover-art-label";
      lbl.textContent = image.dataset.label || "Vídeo";
      const sub = document.createElement("span");
      sub.className = "cover-art-sub";
      sub.textContent = image.dataset.handle || "TikTok BR";
      wrapper.append(lbl, sub);
      image.replaceWith(wrapper);
    },
    true,
  );
}

async function boot() {
  bind();
  applyControlsFromUrl();
  try {
    const response = await fetch(`data/videos.json?v=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    catalog = await response.json();
    if (!catalog || !Array.isArray(catalog.videos)) throw new Error("JSON sem a lista de vídeos");
    updateNicheOptionCounts();
    syncDurationAvailability();
    render();
  } catch (error) {
    updatedEl.textContent = "sem dados";
    statusSub.textContent = "Não foi possível ler data/videos.json.";
    listEl.className = "";
    listEl.innerHTML = `<section class="empty"><h2>O painel não carregou</h2><p>${escapeHtml(error.message)}</p></section>`;
  }
}

boot();
