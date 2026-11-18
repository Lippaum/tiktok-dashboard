import { classify } from "./tag.js";
import { round } from "./util.js";

export function mergeItems(items) {
  const map = new Map();
  for (const item of items) {
    if (!item?.id || item.views == null) continue;
    const previous = map.get(item.id);
    if (!previous) {
      map.set(item.id, {
        ...item,
        saves: item.saves ?? 0,
        hashtags: [...(item.hashtags || [])],
        sources: [...(item.sources || [])],
      });
      continue;
    }
    const better = item.views >= previous.views ? item : previous;
    const hashtags = new Set([...(previous.hashtags || []), ...(item.hashtags || [])]);
    const sources = new Set([...(previous.sources || []), ...(item.sources || [])]);
    map.set(item.id, {
      ...previous,
      ...better,
      saves: Math.max(previous.saves ?? 0, item.saves ?? 0),
      caption: better.caption || previous.caption || "",
      coverUrl: item.coverUrl || previous.coverUrl || null,
      hashtags: [...hashtags],
      sources: [...sources],
      aiMeta: Boolean(previous.aiMeta || item.aiMeta),
    });
  }
  return [...map.values()];
}

function viewsPerHour(views, postedAt, referenceTime) {
  if (views == null || !postedAt) return null;
  const posted = Date.parse(postedAt);
  if (Number.isNaN(posted)) return null;
  const hours = (referenceTime.getTime() - posted) / 3_600_000;
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return round(views / Math.max(hours, 1 / 60), 1);
}

export function freshnessWeight(hoursSinceLastSeen) {
  if (hoursSinceLastSeen == null || hoursSinceLastSeen <= 12) return 1;
  return Math.pow(0.5, (hoursSinceLastSeen - 12) / 24);
}

function computeBreakoutScore({
  views,
  vph,
  growthPerHour,
  growthPercent,
  engagementRate,
  postedAt,
  hoursSinceLastSeen,
  language,
  now,
}) {
  const velocity = Math.max(0, growthPerHour != null ? growthPerHour : vph ?? 0);
  if (velocity <= 0) return 0;

  const relBoost =
    growthPercent != null && growthPercent > 0
      ? Math.min(2.4, 1 + Math.log10(1 + growthPercent / 25))
      : 1;
  const engBoost = engagementRate != null ? Math.min(1.65, 0.85 + engagementRate * 4) : 1;

  let postAgeWeight = 1;
  if (postedAt) {
    const ageHours = (now.getTime() - Date.parse(postedAt)) / 3_600_000;
    if (Number.isFinite(ageHours) && ageHours >= 0) {
      if (ageHours <= 72) postAgeWeight = 1.25;
      else if (ageHours <= 168) postAgeWeight = 1;
      else postAgeWeight = 0.45;
    }
  }

  const confirmedMod = growthPerHour != null ? 1.35 : 0.65;
  const sizeMod = views != null && views > 30_000_000 ? 0.55 : 1;
  const freshness = freshnessWeight(hoursSinceLastSeen);
  const langWeight =
    language === "pt"
      ? 1.2
      : language === "es" || language === "en" || language === "other"
        ? 0.25
        : 0.9;

  return round(
    velocity * confirmedMod * relBoost * engBoost * postAgeWeight * sizeMod * freshness * langWeight,
    1,
  );
}

function finalize(video, now, maxHistoryPoints) {
  const history = video.history.slice(-maxHistoryPoints);
  const last = history.at(-1);
  const previous = history.length >= 2 ? history.at(-2) : null;
  let growthViews = null;
  let growthHours = null;
  let growthPerHour = null;
  let growthPercent = null;
  if (previous && last && previous.views != null && last.views != null) {
    growthViews = last.views - previous.views;
    const gap = (Date.parse(last.at) - Date.parse(previous.at)) / 3_600_000;
    growthHours = Number.isFinite(gap) && gap > 0 ? round(gap, 2) : null;
    if (growthHours != null && growthHours > 0) {
      growthPerHour = round(growthViews / growthHours, 1);
    }
    if (previous.views > 0) {
      growthPercent = round((growthViews / previous.views) * 100, 1);
    }
  }
  const lastSeenAt = last?.at ?? null;
  const lastSeenDate = lastSeenAt ? new Date(lastSeenAt) : now;
  const hoursSinceLastSeen = lastSeenAt
    ? round(Math.max(0, (now.getTime() - lastSeenDate.getTime()) / 3_600_000), 1)
    : null;
  const isFresh = hoursSinceLastSeen != null ? hoursSinceLastSeen <= 36 : false;

  const views = last?.views ?? video.views;
  const likes = last?.likes ?? video.likes ?? 0;
  const comments = last?.comments ?? video.comments ?? 0;
  const shares = last?.shares ?? video.shares ?? 0;
  const saves = last?.saves ?? video.saves ?? 0;
  const engagementRate = views > 0 ? round((likes + comments + shares + saves) / views, 4) : null;
  const vph = viewsPerHour(views, video.postedAt, lastSeenDate);

  const tagged = classify({
    caption: video.caption,
    hashtags: [...video.hashtags],
    author: video.author,
    authorName: video.authorName,
    aiMeta: video.aiMeta,
  });

  const breakoutScore = computeBreakoutScore({
    views,
    vph,
    growthPerHour,
    growthPercent,
    engagementRate,
    postedAt: video.postedAt,
    hoursSinceLastSeen,
    language: tagged.language,
    now,
  });

  return {
    id: video.id,
    url: video.url,
    caption: video.caption,
    coverUrl: video.coverUrl,
    author: video.author,
    authorName: video.authorName,
    authorFollowers: video.authorFollowers,
    views,
    likes,
    comments,
    shares,
    saves,
    durationSec: video.durationSec,
    postedAt: video.postedAt,
    lastSeenAt,
    hoursSinceLastSeen,
    isFresh,
    viewsPerHour: vph,
    growthViews,
    growthHours,
    growthPerHour,
    growthPercent,
    breakoutScore,
    engagementRate,
    faceless: tagged.faceless,
    facelessScore: tagged.facelessScore,
    facelessReasons: tagged.facelessReasons,
    niches: tagged.niches,
    language: tagged.language,
    hashtags: [...video.hashtags],
    sources: [...video.sources],
    aiMeta: Boolean(video.aiMeta),
    history,
  };
}

function effectiveGrowthScore(video) {
  if (video.growthPerHour != null) {
    return video.growthPerHour * freshnessWeight(video.hoursSinceLastSeen);
  }
  if (video.growthViews != null) {
    return video.growthViews * freshnessWeight(video.hoursSinceLastSeen);
  }
  return null;
}

function compareGrowth(a, b) {
  const left = effectiveGrowthScore(a);
  const right = effectiveGrowthScore(b);
  if (left == null && right == null) {
    return (b.viewsPerHour ?? -1) - (a.viewsPerHour ?? -1);
  }
  if (left == null) return 1;
  if (right == null) return -1;
  if (right !== left) return right - left;
  return (b.viewsPerHour ?? 0) - (a.viewsPerHour ?? 0);
}

export function buildCatalog(snapshots, { now = new Date(), region = "BR", maxHistoryPoints = 48 } = {}) {
  const ordered = [...snapshots].sort((a, b) => Date.parse(a.collectedAt) - Date.parse(b.collectedAt));
  const byId = new Map();

  for (const snapshot of ordered) {
    const at = new Date(snapshot.collectedAt).toISOString();
    if (Number.isNaN(Date.parse(at))) continue;
    for (const item of mergeItems(snapshot.items || [])) {
      let video = byId.get(item.id);
      if (!video) {
        video = {
          ...item,
          saves: item.saves ?? 0,
          hashtags: new Set(item.hashtags || []),
          sources: new Set(item.sources || []),
          history: [],
        };
        byId.set(item.id, video);
      } else {
        if (item.views >= (video.views ?? -1)) {
          video.views = item.views;
          video.likes = item.likes ?? video.likes;
          video.comments = item.comments ?? video.comments;
          video.shares = item.shares ?? video.shares;
          video.saves = Math.max(video.saves ?? 0, item.saves ?? 0);
        }
        video.url = item.url || video.url;
        if (item.caption) video.caption = item.caption;
        if (item.coverUrl) video.coverUrl = item.coverUrl;
        if (item.author) video.author = item.author;
        if (item.authorName) video.authorName = item.authorName;
        if (item.authorFollowers != null) video.authorFollowers = item.authorFollowers;
        if (item.durationSec != null) video.durationSec = item.durationSec;
        if (item.postedAt) video.postedAt = item.postedAt;
        video.aiMeta = Boolean(video.aiMeta || item.aiMeta);
        for (const tag of item.hashtags || []) video.hashtags.add(tag);
        for (const source of item.sources || []) video.sources.add(source);
      }

      const point = {
        at,
        views: item.views,
        likes: item.likes ?? 0,
        comments: item.comments ?? 0,
        shares: item.shares ?? 0,
        saves: item.saves ?? 0,
      };
      const last = video.history.at(-1);
      if (last && last.at === point.at) video.history[video.history.length - 1] = point;
      else video.history.push(point);
    }
  }

  const latest = ordered.at(-1) ?? null;
  const measuredAt = latest ? new Date(latest.collectedAt) : now;
  const videos = [...byId.values()]
    .map((video) => finalize(video, measuredAt, maxHistoryPoints))
    .sort(compareGrowth);

  return {
    schemaVersion: 2,
    updatedAt: latest ? new Date(latest.collectedAt).toISOString() : null,
    region,
    source: latest?.mode ?? null,
    videoCount: videos.length,
    videos,
    run: latest
      ? {
          collectedAt: new Date(latest.collectedAt).toISOString(),
          mode: latest.mode ?? null,
          itemsReceived: latest.itemsReceived ?? null,
          estimatedUsd: latest.estimatedUsd ?? null,
          keywords: latest.keywords ?? [],
        }
      : null,
  };
}
