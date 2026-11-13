import { firstDefined, readPath, toNumber } from "./util.js";

const WATCH_PATH = /tiktok\.com\/@[^/?#]+\/(?:video|photo)\/(\d{8,})/i;

function asUrl(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const entry of value) {
      const url = asUrl(entry);
      if (url) return url;
    }
    return null;
  }
  if (value && typeof value === "object") {
    return asUrl(value.url || value.url_list || value.urlList);
  }
  return null;
}

function cleanAuthor(value) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/^@/, "");
  if (!name || name.length > 80) return null;
  if (!/^[\w.\-]+$/u.test(name)) return null;
  return name;
}

function cleanId(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return /^\d{8,}$/.test(text) ? text : null;
}

function hashtagsFrom(raw, caption) {
  const found = [];
  const seen = new Set();
  const push = (name) => {
    if (typeof name !== "string") return;
    const tag = name.replace(/^#/, "").trim().toLowerCase();
    if (!tag || seen.has(tag)) return;
    seen.add(tag);
    found.push(tag);
  };
  const lists = [raw.hashtags, raw.challenges, raw.cha_list, raw.textExtra, raw.text_extra];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item === "string") push(item);
      else if (item && typeof item === "object") {
        push(item.name || item.hashtagName || item.hashtag_name || item.title);
      }
    }
  }
  if (caption) {
    const pattern = /#([\p{L}\p{N}_]+)/gu;
    let match;
    while ((match = pattern.exec(caption))) push(match[1]);
  }
  return found;
}

function aiMetaFrom(raw) {
  const flags = [raw.isAigc, raw.is_aigc, raw.aigc, raw.aiGenerated, raw.ai_generated, raw.isAiGenerated];
  for (const flag of flags) {
    if (flag === true || flag === 1 || flag === "true" || flag === "1") return true;
  }
  const label = raw.aigcLabel ?? raw.aigc_label ?? raw.aigc_label_type ?? raw.aigcLabelType;
  if (typeof label === "number") return label > 0;
  if (typeof label === "string" && label.trim() && !/^(0|none|false)$/i.test(label.trim())) return true;
  return false;
}

function durationSeconds(raw) {
  const meta = toNumber(readPath(raw, ["videoMeta", "duration"]));
  if (meta != null && meta >= 0 && meta < 1000) return Math.round(meta);
  if (meta != null && meta >= 1000) return Math.round(meta / 1000);

  const explicitMs = toNumber(firstDefined([raw.durationMs, readPath(raw, ["video", "durationMs"])]));
  if (explicitMs != null) return Math.round(explicitMs / 1000);

  const rawVideo = toNumber(readPath(raw, ["video", "duration"]));
  if (rawVideo != null) return rawVideo >= 1000 ? Math.round(rawVideo / 1000) : Math.round(rawVideo);

  const top = toNumber(firstDefined([raw.duration, raw.durationSec, raw.videoDuration]));
  if (top == null) return null;
  if (top >= 1000) return Math.round(top / 1000);
  return Math.round(top);
}

function postedAtFrom(raw) {
  const iso = firstDefined([
    raw.createTimeISO,
    raw.create_time_iso,
    raw.postedAt,
    raw.uploadedAt,
    raw.createdAt,
  ]);
  if (typeof iso === "string" && !Number.isNaN(Date.parse(iso))) {
    return new Date(iso).toISOString();
  }
  const unix = toNumber(firstDefined([raw.createTime, raw.create_time, raw.postedAtTimestamp]));
  if (unix == null) return null;
  const ms = unix < 1e12 ? unix * 1000 : unix;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function coverFrom(raw) {
  const candidates = [
    readPath(raw, ["videoMeta", "coverUrl"]),
    readPath(raw, ["videoMeta", "cover"]),
    readPath(raw, ["videoMeta", "originalCoverUrl"]),
    raw.coverUrl,
    raw.cover,
    raw.thumbnail,
    raw.dynamicCover,
    raw.originCover,
    readPath(raw, ["video", "cover"]),
    readPath(raw, ["video", "origin_cover"]),
    readPath(raw, ["video", "dynamic_cover"]),
    readPath(raw, ["video", "coverUrl"]),
  ];
  for (const candidate of candidates) {
    const url = asUrl(candidate);
    if (!url) continue;
    if (/^https:\/\//i.test(url)) return url;
    if (/^covers\/[\w.\-]+\.svg$/.test(url)) return url;
  }
  return null;
}

function watchUrl(raw, author, id) {
  const candidates = [raw.webVideoUrl, raw.videoUrl, raw.url, raw.shareUrl, raw.link, raw.webUrl];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    if (WATCH_PATH.test(candidate)) return candidate.split("?")[0];
  }
  if (author && id) return `https://www.tiktok.com/@${author}/video/${id}`;
  return null;
}

function idFromAnywhere(raw) {
  const direct = cleanId(firstDefined([
    raw.id,
    raw.videoId,
    raw.aweme_id,
    raw.awemeId,
    raw.id_str,
    readPath(raw, ["aweme", "aweme_id"]),
  ]));
  if (direct) return direct;
  const candidates = [raw.webVideoUrl, raw.videoUrl, raw.url, raw.shareUrl, raw.link, raw.webUrl];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const match = candidate.match(WATCH_PATH);
    if (match) return match[1];
  }
  return null;
}

/**
 * Aceita o formato descrito pela Kaito (playCount, authorMeta, videoMeta,
 * videoUrlNoWatermark), o formato achatado do clockworks e o JSON cru do TikTok.
 * Devolve null quando não há id ou visualizações — a coleta falha se nada sobrar.
 */
export function normalizeItem(raw, source) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const id = idFromAnywhere(raw);
  const author = cleanAuthor(firstDefined([
    readPath(raw, ["authorMeta", "name"]),
    readPath(raw, ["authorMeta", "uniqueId"]),
    readPath(raw, ["author", "uniqueId"]),
    readPath(raw, ["author", "unique_id"]),
    raw.authorUsername,
    raw.uniqueId,
    typeof raw.author === "string" ? raw.author : undefined,
  ]));
  const views = toNumber(firstDefined([
    raw.playCount,
    readPath(raw, ["stats", "playCount"]),
    readPath(raw, ["statistics", "playCount"]),
    readPath(raw, ["statistics", "play_count"]),
    readPath(raw, ["videoMeta", "playCount"]),
    raw.viewCount,
    raw.views,
  ]));
  if (!id || views == null) return null;

  const caption = firstDefined([raw.text, raw.desc, raw.description, raw.caption, raw.title]);
  const captionText = typeof caption === "string" ? caption.trim() : "";
  const url = watchUrl(raw, author, id);
  const authorNameRaw = firstDefined([
    readPath(raw, ["authorMeta", "nickName"]),
    readPath(raw, ["authorMeta", "nickname"]),
    readPath(raw, ["author", "nickname"]),
    readPath(raw, ["author", "nickName"]),
    raw.authorNickname,
    raw.nickname,
  ]);

  return {
    id,
    url,
    caption: captionText,
    coverUrl: coverFrom(raw),
    author,
    authorName: typeof authorNameRaw === "string" ? authorNameRaw.trim() : null,
    authorFollowers: toNumber(firstDefined([
      readPath(raw, ["authorMeta", "fans"]),
      readPath(raw, ["authorStats", "followerCount"]),
      readPath(raw, ["author", "followerCount"]),
      readPath(raw, ["author", "follower_count"]),
      raw.followerCount,
      raw.fans,
      raw.authorFollowers,
    ])),
    views,
    likes: toNumber(firstDefined([
      raw.diggCount,
      readPath(raw, ["stats", "diggCount"]),
      readPath(raw, ["statistics", "digg_count"]),
      readPath(raw, ["statistics", "diggCount"]),
      raw.likeCount,
      raw.likes,
    ])) ?? 0,
    comments: toNumber(firstDefined([
      raw.commentCount,
      readPath(raw, ["stats", "commentCount"]),
      readPath(raw, ["statistics", "comment_count"]),
      readPath(raw, ["statistics", "commentCount"]),
      raw.comments,
    ])) ?? 0,
    shares: toNumber(firstDefined([
      raw.shareCount,
      readPath(raw, ["stats", "shareCount"]),
      readPath(raw, ["statistics", "share_count"]),
      readPath(raw, ["statistics", "shareCount"]),
      raw.shares,
    ])) ?? 0,
    durationSec: durationSeconds(raw),
    postedAt: postedAtFrom(raw),
    hashtags: hashtagsFrom(raw, captionText),
    sources: source ? [source] : [],
    aiMeta: aiMetaFrom(raw),
  };
}
