// ===============================
// fetch-trends.js (FULL)
// ===============================

// ---- BACKEND PART (Node/Serverless) ----
const RAPIDAPI_KEY = typeof process !== "undefined" ? process.env.RAPIDAPI_KEY : null;
import { GEMINI_KEY } from "./analyze-trend.js"; 
import fetch from "node-fetch";
import { XMLParser } from "fast-xml-parser";

// Safe fetch wrapper
async function defaultFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return res;
}

// Helper: safe text from RSS
function safeText(obj, field = "title") {
  if (!obj) return "";
  if (typeof obj[field] === "string") return obj[field];
  if (typeof obj[field] === "object" && "#text" in obj[field]) return obj[field]["#text"];
  return "";
}

// Helper: parse date
function safeDateStr(d) {
  try {
    return new Date(d).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

const parser = new XMLParser();

// ---------------------- FETCHERS ----------------------

// Hacker News
async function fetchHackerNewsFrontpage() {
  try {
    const res = await defaultFetch("https://hacker-news.firebaseio.com/v0/topstories.json");
    const ids = (await res.json()).slice(0, 10);

    const items = await Promise.all(
      ids.map(async (id) => {
        const r = await defaultFetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        return await r.json();
      })
    );

    return items.map((it, i) => ({
      id: `hn-${it.id}`,
      rank: i + 1,
      title: it.title || "(No Title)",
      description: it.text || "",
      url: it.url || `https://news.ycombinator.com/item?id=${it.id}`,
      source: "Hacker News",
      platform: "tech",
      category: "Technology",
      date: safeDateStr(it.time * 1000),
      tags: ["Tech"],
    }));
  } catch (e) {
    console.error("fetchHackerNewsFrontpage failed", e);
    return [];
  }
}

// BBC
async function fetchBBCWorld() {
  try {
    const res = await defaultFetch("https://feeds.bbci.co.uk/news/world/rss.xml");
    const text = await res.text();
    const data = parser.parse(text);

    const items = data.rss.channel.item.slice(0, 10);
    return items.map((it, i) => ({
      id: `bbc-${i}`,
      rank: i + 1,
      title: safeText(it, "title"),
      description: safeText(it, "description"),
      url: it.link,
      source: "BBC World",
      platform: "news",
      category: "World News",
      date: safeDateStr(it.pubDate),
      tags: ["World"],
    }));
  } catch (e) {
    console.error("fetchBBCWorld failed", e);
    return [];
  }
}

// VNExpress
async function fetchVnExpressInternational() {
  try {
    const res = await defaultFetch("https://e.vnexpress.net/rss/world.rss");
    const text = await res.text();
    const data = parser.parse(text);

    const items = data.rss.channel.item.slice(0, 10);
    return items.map((it, i) => ({
      id: `vnexp-${i}`,
      rank: i + 1,
      title: safeText(it, "title"),
      description: safeText(it, "description"),
      url: it.link,
      source: "VNExpress",
      platform: "news",
      category: "World News",
      date: safeDateStr(it.pubDate),
      tags: ["Vietnam", "World"],
    }));
  } catch (e) {
    console.error("fetchVnExpressInternational failed", e);
    return [];
  }
}

// Nasdaq
async function fetchNasdaqNews() {
  try {
    const res = await defaultFetch("https://www.nasdaq.com/feed/rssoutbound?category=Markets");
    const text = await res.text();
    const data = parser.parse(text);

    const items = data.rss.channel.item.slice(0, 10);
    return items.map((it, i) => ({
      id: `nasdaq-${i}`,
      rank: i + 1,
      title: safeText(it, "title"),
      description: safeText(it, "description"),
      url: it.link,
      source: "Nasdaq",
      platform: "finance",
      category: "Finance",
      date: safeDateStr(it.pubDate),
      tags: ["Finance"],
    }));
  } catch (e) {
    console.error("fetchNasdaqNews failed", e);
    return [];
  }
}

// TikTok (RapidAPI)
async function fetchTikTokTrends() {
  if (!RAPIDAPI_KEY) return [];
  try {
    const res = await defaultFetch("https://tiktok-api23.p.rapidapi.com/api/trending/feed?count=10", {
      headers: {
        "x-rapidapi-host": "tiktok-api23.p.rapidapi.com",
        "x-rapidapi-key": RAPIDAPI_KEY,
      },
    });
    const data = await res.json();
    const items = data.aweme_list || [];
    return items.map((it, i) => ({
      id: `tiktok-${it.aweme_id}`,
      rank: i + 1,
      title: it.desc || "(No Title)",
      description: it.desc,
      url: `https://www.tiktok.com/@${it.author?.unique_id}/video/${it.aweme_id}`,
      source: "TikTok",
      platform: "social",
      category: "Entertainment",
      date: safeDateStr(it.create_time * 1000),
      tags: ["TikTok"],
    }));
  } catch (e) {
    console.error("fetchTikTokTrends failed", e);
    return [];
  }
}

// Instagram (RapidAPI)
async function fetchInstagramTrends() {
  if (!RAPIDAPI_KEY) return [];
  try {
    const res = await defaultFetch("https://instagram-scraper-api2.p.rapidapi.com/v1/trending", {
      headers: {
        "x-rapidapi-host": "instagram-scraper-api2.p.rapidapi.com",
        "x-rapidapi-key": RAPIDAPI_KEY,
      },
    });
    const data = await res.json();
    const items = data.data || [];
    return items.map((it, i) => ({
      id: `ig-${it.id || i}`,
      rank: i + 1,
      title: it.caption || "(No Title)",
      description: it.caption || "",
      url: `https://www.instagram.com/p/${it.code}/`,
      source: "Instagram",
      platform: "social",
      category: "Entertainment",
      date: safeDateStr(it.taken_at_timestamp * 1000),
      tags: ["Instagram"],
    }));
  } catch (e) {
    console.error("fetchInstagramTrends failed", e);
    return [];
  }
}

// ---------------------- GEMINI ----------------------
async function analyzeWithGemini(text) {
  if (!GEMINI_KEY) return "⚠️ No Gemini API key.";
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text }] }] }),
      }
    );
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "No analysis result.";
  } catch (e) {
    console.error("Gemini error", e);
    return "⚠️ Gemini analysis failed.";
  }
}

// ---------------------- FRONTEND RENDER ----------------------
function createTrendCard(trend) {
  const card = document.createElement("div");
  card.className = "trend-card";

  // Title (click → alert)
  const titleEl = document.createElement("h3");
  titleEl.textContent = trend.title || "(No Title)";
  titleEl.className = "trend-title";
  titleEl.addEventListener("click", () => {
    alert(`Trend: ${trend.title}\nSource: ${trend.source}`);
  });

  // Description
  const descEl = document.createElement("p");
  descEl.textContent = trend.description || "";

  // Source link
  const srcEl = document.createElement("a");
  srcEl.href = trend.url;
  srcEl.target = "_blank";
  srcEl.rel = "noopener noreferrer";
  srcEl.textContent = `Source: ${trend.source}`;

  // Analyze button
  const analyzeBtn = document.createElement("button");
  analyzeBtn.textContent = "Analyze";
  analyzeBtn.addEventListener("click", async () => {
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = "Analyzing...";
    const result = await analyzeWithGemini(trend.title + "\n" + trend.description);
    alert(`Gemini Analysis:\n\n${result}`);
    analyzeBtn.textContent = "Analyze";
    analyzeBtn.disabled = false;
  });

  card.appendChild(titleEl);
  card.appendChild(descEl);
  card.appendChild(srcEl);
  card.appendChild(analyzeBtn);
  return card;
}

export {
  fetchHackerNewsFrontpage,
  fetchBBCWorld,
  fetchVnExpressInternational,
  fetchNasdaqNews,
  fetchTikTokTrends,
  fetchInstagramTrends,
  createTrendCard,
};
