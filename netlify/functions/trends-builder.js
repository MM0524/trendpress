// netlify/functions/trends-builder.js
import { builder } from "@netlify/functions";
import fetch from "node-fetch";
import crypto from "crypto";
import { XMLParser } from "fast-xml-parser";

// =========================
// Helpers
// =========================
async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 10000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(resource, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    console.error("❌ Fetch error:", resource, err.message);
    throw err;
  }
}

function createStandardTrend(item, sourceName, defaultCategory, defaultRegion, extraTags = []) {
  const title = item.title || "";
  const link = item.link || item.url || "";
  const description = item.description || item.contentSnippet || item.excerpt || "";
  const pubDate = item.pubDate || item.date || new Date().toISOString();
  const id = crypto.createHash("md5").update(link + title).digest("hex");

  return {
    id,
    title,
    title_en: title,
    title_vi: title,
    description,
    link,
    pubDate,
    source: sourceName,
    category: defaultCategory,
    region: defaultRegion,
    tags: extraTags,
    votes: Math.floor(Math.random() * 1000),
    views: Math.floor(Math.random() * 5000),
    interactions: Math.floor(Math.random() * 800),
    searches: Math.floor(Math.random() * 2000),
  };
}

async function fetchAndParseXmlFeed(url, sourceName, defaultCategory, defaultRegion, extraTags = []) {
  try {
    const res = await fetchWithTimeout(url);
    const xml = await res.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      isArray: (name, jpath) => name === "item" || name === "entry",
    });
    const parsed = parser.parse(xml);

    let rawItems = [];
    if (parsed?.rss?.channel?.item) {
      rawItems = parsed.rss.channel.item;
    } else if (parsed?.feed?.entry) {
      rawItems = parsed.feed.entry;
    }

    return rawItems.map((item) =>
      createStandardTrend(item, sourceName, defaultCategory, defaultRegion, extraTags)
    );
  } catch (err) {
    console.error(`❌ XML feed error ${sourceName} (${url}):`, err.message);
    return [];
  }
}

async function fetchJsonFeed(url, sourceName, defaultCategory, defaultRegion, extraTags = []) {
  try {
    const res = await fetchWithTimeout(url);
    const json = await res.json();

    let rawItems = [];
    if (json?.articles) {
      rawItems = json.articles; // NewsAPI format
    } else if (json?.feed?.results) {
      rawItems = json.feed.results;
    } else if (json?.items) {
      rawItems = json.items;
    }

    return rawItems.map((item) =>
      createStandardTrend(item, sourceName, defaultCategory, defaultRegion, extraTags)
    );
  } catch (err) {
    console.error(`❌ JSON feed error ${sourceName} (${url}):`, err.message);
    return [];
  }
}

function calculateHotnessScore(trend, maxValues) {
  const { views, interactions, searches, votes } = trend;
  return (
    (views / (maxValues.views || 1)) * 0.4 +
    (interactions / (maxValues.interactions || 1)) * 0.3 +
    (searches / (maxValues.searches || 1)) * 0.2 +
    (votes / (maxValues.votes || 1)) * 0.1
  );
}

// =========================
// Fetchers (ví dụ giữ lại AI + thêm GoogleTrends + NewsAPI)
// =========================

const fetchers_Archaeology = [
  () => fetchAndParseXmlFeed("https://www.archaeology.org/rss.xml", "Archaeology Magazine", "Archaeology", "us", ["Archaeology"]),
  () => fetchAndParseXmlFeed("https://www.heritagedaily.com/category/archaeology/feed", "HeritageDaily", "Archaeology", "global", ["Archaeology"]), // Changed to global
  // () => fetchAndParseXmlFeed("https://www.chinahistory.net/rss", "China Heritage", "Archaeology", "cn", ["China","Archaeology"]), // Removed
];

// --- Google Trends ---
const fetchers_GoogleTrends = [
  () => fetchAndParseXmlFeed(
    "https://trends.google.com/trends/trendingsearches/daily/rss?geo=VN",
    "Google Trends VN", "Trends", "vn", ["GoogleTrends","Vietnam"]
  ),
  () => fetchAndParseXmlFeed(
    "https://trends.google.com/trends/trendingsearches/daily/rss?geo=US",
    "Google Trends US", "Trends", "us", ["GoogleTrends","USA"]
  ),
];

// --- NewsAPI ---
const fetchers_NewsAPI = [
  () => fetchJsonFeed(
    `https://newsapi.org/v2/top-headlines?country=vn&apiKey=${process.env.NEWSAPI_KEY}`,
    "NewsAPI VN", "News", "vn", ["NewsAPI","Vietnam"]
  ),
  () => fetchJsonFeed(
    `https://newsapi.org/v2/top-headlines?country=us&apiKey=${process.env.NEWSAPI_KEY}`,
    "NewsAPI US", "News", "us", ["NewsAPI","USA"]
  ),
];

// =========================
// Handler
// =========================
export const handler = builder(async () => {
  const allFetchers = [
    ...fetchers_Archaeology,
    ...fetchers_GoogleTrends,
    ...fetchers_NewsAPI,
    // 👉 bạn có thể thêm các fetchers khác ở đây
  ];

  const results = (await Promise.allSettled(allFetchers.map(fn => fn())))
    .flatMap(r => (r.status === "fulfilled" ? r.value : []));

  const maxValues = results.reduce(
    (acc, t) => {
      acc.views = Math.max(acc.views, t.views || 0);
      acc.interactions = Math.max(acc.interactions, t.interactions || 0);
      acc.searches = Math.max(acc.searches, t.searches || 0);
      acc.votes = Math.max(acc.votes, t.votes || 0);
      return acc;
    },
    { views: 0, interactions: 0, searches: 0, votes: 0 }
  );

  const withScores = results.map((t) => ({
    ...t,
    hotness: calculateHotnessScore(t, maxValues),
  }));

  return {
    statusCode: 200,
    body: JSON.stringify(
      { count: withScores.length, trends: withScores },
      null,
      2
    ),
  };
});
