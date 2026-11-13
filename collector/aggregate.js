import { classify } from "./tag.js";
import { round } from "./util.js";

function mergeItems(items) {
  const map = new Map();
  for (const item of items) {
    if (!item?.id || item.views == null) continue;
    const previous = map.get(item.id);
    if (!previous) {
      map.set(item.id, {
        ...item,
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
      caption: better.caption || previous.caption || "",
      hashtags: [...hashtags],
      sources: [...sources],
      aiMeta: Boolean(previous.aiMeta || item.aiMeta),
    });
  }
  return [...map.values()];
}

function viewsPerHour(views, postedAt, now) {
  if (views == null || !postedAt) return null;
  const posted = Date.parse(postedAt);
  if (Number.isNaN(posted)) return null;
  const hours = (now.getTime() - posted) / 3_600_000;
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return round(views / Math.max(hours, 1 / 60), 1);
}

function finalize(video, now, maxHistoryPoints) {
  const history = video.history.slice(-maxHistoryPoints);
  const last = history.at(-1);
  const previous = history.length >= 2 ? history.at(-2) : null;
  let growthViews = null;
  let growthHours = null;
  if (previous && last && previous.views != null && last.views != null) {
    growthViews = last.views - previous.views;
    const gap = (Date.parse(last.at) - Date.parse(previous.at)) / 3_600_000;
    growthHours = Number.isFinite(gap) && gap > 0 ? round(gap, 2) : null;
  }
  const views = last?.views ?? video.views;
  const likes = last?.likes ?? video.likes ?? 0;
  const comments = last?.comments ?? video.comments ?? 0;
  const shares = last?.shares ?? video.shares ?? 0;
  const engagementRate = views > 0 ? round((likes + comments + shares) / views, 4) : null;
  const tagged = classify({
    caption: video.caption,
    hashtags: [...video.hashtags],
    aiMeta: video.aiMeta,
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
    durationSec: video.durationSec,
    postedAt: video.postedAt,
    viewsPerHour: viewsPerHour(views, video.postedAt, now),
    growthViews,
    growthHours,
    engagementRate,
    faceless: tagged.faceless,
    facelessScore: tagged.facelessScore,
    facelessReasons: tagged.facelessReasons,
    niches: tagged.niches,
    hashtags: [...video.hashtags],
    sources: [...video.sources],
    aiMeta: Boolean(video.aiMeta),
    history,
  };
}

function compareGrowth(a, b) {
  if (a.growthViews == null && b.growthViews == null) {
    return (b.viewsPerHour ?? -1) - (a.viewsPerHour ?? -1);
  }
  if (a.growthViews == null) return 1;
  if (b.growthViews == null) return -1;
  if (b.growthViews !== a.growthViews) return b.growthViews - a.growthViews;
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
    schemaVersion: 1,
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
