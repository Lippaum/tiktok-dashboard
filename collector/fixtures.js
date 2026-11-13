import fs from "node:fs";

import { normalizeItem } from "./normalize.js";

function postedAt(now, hoursAgo) {
  return new Date(now.getTime() - hoursAgo * 3_600_000);
}

function toActorShape(video, run, now) {
  const posted = postedAt(now, video.postedHoursAgo);
  const pageUrl = `https://www.tiktok.com/@${video.author}/video/${video.id}`;
  if (video.shape === "clockworks") {
    return {
      "authorMeta.name": video.author,
      "authorMeta.nickName": video.authorName,
      "authorMeta.fans": video.authorFollowers,
      text: video.caption,
      playCount: run.views,
      diggCount: run.likes,
      commentCount: run.comments,
      shareCount: run.shares,
      "videoMeta.duration": video.durationSec,
      "videoMeta.coverUrl": video.cover,
      createTimeISO: posted.toISOString(),
      webVideoUrl: pageUrl,
      hashtags: video.hashtags,
    };
  }
  if (video.shape === "aweme") {
    return {
      aweme_id: video.id,
      desc: video.caption,
      create_time: Math.floor(posted.getTime() / 1000),
      is_aigc: Boolean(video.aiMeta),
      author: {
        unique_id: video.author,
        nickname: video.authorName,
        follower_count: video.authorFollowers,
      },
      statistics: {
        play_count: run.views,
        digg_count: run.likes,
        comment_count: run.comments,
        share_count: run.shares,
      },
      video: {
        duration: video.durationSec * 1000,
        cover: { url_list: [video.cover] },
      },
      text_extra: (video.hashtags || []).map((name) => ({ hashtag_name: name })),
    };
  }
  return {
    id: video.id,
    text: video.caption,
    playCount: run.views,
    diggCount: run.likes,
    commentCount: run.comments,
    shareCount: run.shares,
    createTimeISO: posted.toISOString(),
    isAigc: Boolean(video.aiMeta),
    authorMeta: {
      name: video.author,
      nickName: video.authorName,
      fans: video.authorFollowers,
    },
    videoMeta: {
      duration: video.durationSec,
      coverUrl: video.cover,
    },
    webVideoUrl: pageUrl,
    hashtags: (video.hashtags || []).map((name) => ({ name })),
    videoUrlNoWatermark: `https://example.invalid/video/${video.id}.mp4`,
  };
}

export function loadFixtureSnapshots(file, now = new Date()) {
  const scenario = JSON.parse(fs.readFileSync(file, "utf8"));
  const groups = new Map();
  for (const video of scenario.videos) {
    const sources = Array.isArray(video.sources) ? video.sources : [video.sources || "search"];
    for (const run of video.runs) {
      if (!groups.has(run.hoursAgo)) groups.set(run.hoursAgo, []);
      for (const source of sources) {
        groups.get(run.hoursAgo).push({
          raw: toActorShape(video, run, now),
          source,
        });
      }
    }
  }

  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([hoursAgo, entries]) => {
      const items = [];
      for (const entry of entries) {
        const normalized = normalizeItem(entry.raw, entry.source);
        if (normalized) items.push(normalized);
      }
      return {
        collectedAt: postedAt(now, hoursAgo).toISOString(),
        region: "BR",
        mode: "fixture",
        itemsReceived: items.length,
        estimatedUsd: 0,
        keywords: [],
        items,
      };
    });
}
