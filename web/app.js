const SORT_LABELS = {
  growth: "ordenados por crescimento",
  vph: "ordenados por visualizações/hora",
  views: "ordenados por visualizações",
  engagement: "ordenados por engajamento",
};

const updatedEl = document.querySelector("#updated");
const statusSub = document.querySelector("#status-sub");
const banner = document.querySelector("#banner");
const countEl = document.querySelector("#count");
const listEl = document.querySelector("#lista");
const costEl = document.querySelector("#cost");

let catalog = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
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
  if (seconds == null || !Number.isFinite(seconds)) return "—";
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

function formatGrowth(video) {
  if (video.growthViews == null) return "primeira coleta";
  const sign = video.growthViews > 0 ? "+" : "";
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

function safeCover(url) {
  if (typeof url !== "string") return "";
  if (/^covers\/[\w.\-]+\.svg$/.test(url)) return url;
  if (/^https:\/\//i.test(url)) return url;
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

function sparkline(history) {
  if (!Array.isArray(history) || history.length < 2) {
    return `<span class="spark-empty">sem série</span>`;
  }
  const values = history.map((point) => point.views);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 128;
  const height = 36;
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

function coverHtml(video, className) {
  const cover = safeCover(video.coverUrl);
  const label = video.niches?.[0]?.label || "vídeo";
  if (!cover) return `<span class="${className} fallback">${escapeHtml(label)}</span>`;
  return `<img class="${className}" src="${escapeHtml(cover)}" alt="" data-fallback="1" data-label="${escapeHtml(label)}">`;
}

function badgesHtml(video) {
  const niches = (video.niches || [])
    .map((niche) => `<span class="badge">${escapeHtml(niche.label)}</span>`)
    .join("");
  const faceless = video.faceless
    ? `<span class="badge faceless" title="Heurística pela legenda, hashtags e metadados. Não confirma que o vídeo é sem rosto ou feito por IA.">Sem rosto/IA</span>`
    : "";
  return `${faceless}${niches}`;
}

function readControls() {
  return {
    niche: document.querySelector("#niche").value,
    faceless: document.querySelector("#faceless").checked,
    duration: document.querySelector("#duration").value,
    posted: document.querySelector("#posted").value,
    sort: document.querySelector("#sort").value,
    view: document.querySelector("[data-view].is-active")?.dataset.view || "cards",
  };
}

function passes(video, controls, now) {
  if (controls.niche !== "todos" && !(video.niches || []).some((niche) => niche.id === controls.niche)) {
    return false;
  }
  if (controls.faceless && !video.faceless) return false;
  const seconds = video.durationSec;
  if (controls.duration !== "todas") {
    if (seconds == null) return false;
    if (controls.duration === "short" && seconds > 30) return false;
    if (controls.duration === "mid" && (seconds <= 30 || seconds >= 60)) return false;
    if (controls.duration === "long" && seconds < 60) return false;
  }
  if (controls.posted !== "todas") {
    const posted = Date.parse(video.postedAt || "");
    if (Number.isNaN(posted)) return false;
    const age = now.getTime() - posted;
    const days = controls.posted === "7" ? 7 : 30;
    if (age < 0 || age > days * 86_400_000) return false;
  }
  return true;
}

function sortVideos(videos, sort) {
  const pick = {
    growth: (video) => video.growthViews,
    vph: (video) => video.viewsPerHour,
    views: (video) => video.views,
    engagement: (video) => video.engagementRate,
  }[sort];
  return videos.slice().sort((a, b) => {
    const left = pick(a);
    const right = pick(b);
    if (left == null && right == null) return (b.views ?? 0) - (a.views ?? 0);
    if (left == null) return 1;
    if (right == null) return -1;
    if (right !== left) return right - left;
    return (b.views ?? 0) - (a.views ?? 0);
  });
}

function cardHtml(video, now) {
  const url = safeVideoUrl(video.url);
  const author = video.author ? `@${video.author}` : "autor desconhecido";
  const followers = video.authorFollowers != null ? ` · ${formatCompact(video.authorFollowers)} seguidores` : "";
  const reasons = video.faceless && video.facelessReasons?.length
    ? `<p class="reasons">Sinais: ${escapeHtml(video.facelessReasons.join(" · "))}</p>`
    : "";
  const open = url
    ? `<a class="open" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Abrir no TikTok</a>`
    : "";
  const cover = url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir vídeo de ${escapeHtml(author)} no TikTok">${coverHtml(video, "cover")}</a>`
    : coverHtml(video, "cover");
  return `<article class="card">
    ${cover}
    <div class="card-body">
      <div class="badges">${badgesHtml(video)}</div>
      <h2 class="caption">${escapeHtml(video.caption || "Sem legenda")}</h2>
      <p class="author">${escapeHtml(author)}${escapeHtml(followers)}</p>
      <dl class="metrics">
        <div><dt>Visualizações</dt><dd>${formatCompact(video.views)}</dd></div>
        <div><dt>Curtidas</dt><dd>${formatCompact(video.likes)}</dd></div>
        <div><dt>Crescimento</dt><dd class="${growthClass(video)}">${escapeHtml(formatGrowth(video))}</dd></div>
        <div><dt>Vis./hora</dt><dd>${formatPerHour(video.viewsPerHour)}</dd></div>
        <div><dt>Duração</dt><dd>${formatDuration(video.durationSec)}</dd></div>
        <div><dt>Publicado</dt><dd>${escapeHtml(formatRelative(video.postedAt, now))}</dd></div>
      </dl>
      <div class="spark-row"><span class="spark-label">Histórico</span>${sparkline(video.history)}</div>
      ${reasons}
      ${open}
    </div>
  </article>`;
}

function tableHtml(videos, now) {
  const rows = videos.map((video) => {
    const url = safeVideoUrl(video.url);
    const title = escapeHtml(video.caption || "Sem legenda");
    const link = url
      ? `<a class="table-caption" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${title}</a>`
      : `<span class="table-caption">${title}</span>`;
    const niches = (video.niches || []).map((niche) => niche.label).join(", ");
    const tag = video.faceless ? "Sem rosto/IA" : "—";
    return `<tr>
      <td>${coverHtml(video, "thumb")}</td>
      <td>${link}<div class="author">${escapeHtml(tag)}${niches ? ` · ${escapeHtml(niches)}` : ""}</div></td>
      <td>${escapeHtml(video.author ? `@${video.author}` : "—")}</td>
      <td>${formatCompact(video.views)}</td>
      <td>${formatCompact(video.likes)}</td>
      <td class="${growthClass(video)}">${escapeHtml(formatGrowth(video))}<div>${sparkline(video.history)}</div></td>
      <td>${formatPerHour(video.viewsPerHour)}</td>
      <td>${formatEngagement(video.engagementRate)}</td>
      <td>${formatDuration(video.durationSec)}</td>
      <td>${escapeHtml(formatRelative(video.postedAt, now))}</td>
    </tr>`;
  }).join("");
  return `<p class="scroll-hint">Arraste a tabela para o lado.</p>
    <table>
      <caption class="sr-only">Vídeos em alta no TikTok Brasil</caption>
      <thead>
        <tr>
          <th scope="col">Capa</th>
          <th scope="col">Vídeo</th>
          <th scope="col">Autor</th>
          <th scope="col">Visualizações</th>
          <th scope="col">Curtidas</th>
          <th scope="col">Crescimento</th>
          <th scope="col">Vis./hora</th>
          <th scope="col">Engajamento</th>
          <th scope="col">Duração</th>
          <th scope="col">Publicado</th>
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
    <p>Troque o nicho, a duração ou desligue “só sem rosto/IA”.</p>
    <button type="button" class="clear" id="clear">Limpar filtros</button>
  </section>`;
}

function paintStatus(now) {
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
    banner.textContent = "Dados de exemplo, gerados neste computador. A coleta real substitui este painel pelos vídeos do TikTok no Brasil.";
  } else {
    banner.hidden = true;
    banner.textContent = "";
  }
  if (catalog.source === "live" && catalog.run && catalog.run.estimatedUsd != null) {
    const usd = Number(catalog.run.estimatedUsd).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
    costEl.textContent = `Última coleta: ${catalog.run.itemsReceived ?? "?"} resultados · custo estimado US$ ${usd}.`;
  } else {
    costEl.textContent = "";
  }
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.classList.contains("is-active");
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  void now;
}

function render() {
  const now = new Date();
  paintStatus(now);
  if (!catalog.videos.length) {
    countEl.textContent = "";
    listEl.className = "";
    listEl.innerHTML = emptyDataHtml();
    return;
  }
  const controls = readControls();
  const shown = sortVideos(catalog.videos.filter((video) => passes(video, controls, now)), controls.sort);
  countEl.textContent = `${shown.length} de ${catalog.videoCount} vídeos · ${SORT_LABELS[controls.sort]}`;
  if (!shown.length) {
    listEl.className = "";
    listEl.innerHTML = emptyFilterHtml();
    return;
  }
  listEl.className = controls.view === "table" ? "table-wrap" : "grid";
  listEl.innerHTML = controls.view === "table"
    ? tableHtml(shown, now)
    : shown.map((video) => cardHtml(video, now)).join("");
}

function resetFilters() {
  document.querySelector("#niche").value = "todos";
  document.querySelector("#faceless").checked = false;
  document.querySelector("#duration").value = "todas";
  document.querySelector("#posted").value = "todas";
  document.querySelector("#sort").value = "growth";
}

function bind() {
  for (const id of ["niche", "duration", "posted", "sort"]) {
    document.querySelector(`#${id}`).addEventListener("change", render);
  }
  document.querySelector("#faceless").addEventListener("change", render);
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-view]").forEach((other) => {
        other.classList.toggle("is-active", other === button);
      });
      render();
    });
  });
  document.body.addEventListener("click", (event) => {
    if (event.target.closest("#clear")) {
      resetFilters();
      render();
    }
  });
  listEl.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || image.dataset.fallback !== "1") return;
    const fallback = document.createElement("span");
    fallback.className = `${image.className} fallback`;
    fallback.textContent = image.dataset.label || "vídeo";
    image.replaceWith(fallback);
  }, true);
}

async function boot() {
  bind();
  try {
    const response = await fetch(`data/videos.json?v=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    catalog = await response.json();
    if (!catalog || !Array.isArray(catalog.videos)) throw new Error("JSON sem a lista de vídeos");
    render();
  } catch (error) {
    updatedEl.textContent = "sem dados";
    statusSub.textContent = "Não foi possível ler data/videos.json.";
    listEl.className = "";
    listEl.innerHTML = `<section class="empty"><h2>O painel não carregou</h2><p>${escapeHtml(error.message)}</p></section>`;
  }
}

boot();
