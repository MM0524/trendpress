// ===============================
// fetch-trends.js (FULL)
// ===============================

// ---- BACKEND PART (Node/Serverless) ----
const RAPIDAPI_KEY = typeof process !== "undefined" ? process.env.RAPIDAPI_KEY : null;
const GEMINI_KEY = typeof process !== "undefined" ? process.env.GEMINI_KEY : null;

// Helper functions
const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const safeDateStr = (input) => {
  const d = new Date(input);
  return isNaN(d.getTime())
    ? new Date().toLocaleDateString("en-US")
    : d.toLocaleDateString("en-US");
};

const withTimeout = async (promise, ms = 15000) => {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`Request timed out after ${ms}ms`)), ms);
  });
  try {
    const res = await Promise.race([promise, timeout]);
    return res;
  } finally {
    clearTimeout(t);
  }
};

const defaultFetch =
  typeof fetch !== "undefined"
    ? (url, opts = {}) =>
        withTimeout(
          fetch(url, {
            headers: { "User-Agent": "trend-collector/1.0", ...(opts.headers || {}) },
            ...opts,
          })
        )
    : () => Promise.reject(new Error("fetch not available"));

// -------------------- Data Sources --------------------

// Hacker News
async function fetchHackerNewsFrontpage() {
  try {
    const res = await defaultFetch("https://hacker-news.firebaseio.com/v0/topstories.json");
    const ids = (await res.json()).slice(0, 10);
    const items = await Promise.all(
      ids.map(async (id) => {
        const r = await defaultFetch(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`
        );
        return r.json();
      })
    );

    return items.map((it, i) => ({
      id: `hn-${it.id || i}`,
      title: it.title || "Untitled",
      url: it.url || `https://news.ycombinator.com/item?id=${it.id}`,
      description: "",
      source: it.url || `https://news.ycombinator.com/item?id=${it.id}`,
      date: safeDateStr(it.time ? it.time * 1000 : Date.now()),
      platform: "Hacker News",
      category: "Technology",
      tags: ["Technology"],
      votes: num(it.score),
      comments: num(it.descendants),
    }));
  } catch (e) {
    console.error("fetchHackerNewsFrontpage failed:", e);
    return [];
  }
}

// BBC
async function fetchBBCWorld() {
  try {
    const res = await defaultFetch("https://feeds.bbci.co.uk/news/world/rss.xml");
    const text = await res.text();
    const items = Array.from(text.matchAll(/<item>([\s\S]*?)<\/item>/g));

    return items.slice(0, 10).map((m, i) => {
      const block = m[1];
      const title = /<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block)?.[1] || "";
      const link = /<link>(.*?)<\/link>/.exec(block)?.[1] || "";
      const desc =
        /<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(block)?.[1] || "";

      return {
        id: `bbc-${i}`,
        title,
        url: link,
        description: desc,
        source: link,
        date: safeDateStr(),
        platform: "BBC News",
        category: "World",
        tags: ["World"],
        views: num(Math.random() * 10000),
      };
    });
  } catch (e) {
    console.error("fetchBBCWorld failed:", e);
    return [];
  }
}

// VNExpress
async function fetchVnExpressInternational() {
  try {
    const res = await defaultFetch("https://e.vnexpress.net/rss/world.rss");
    const text = await res.text();
    const items = Array.from(text.matchAll(/<item>([\s\S]*?)<\/item>/g));

    return items.slice(0, 10).map((m, i) => {
      const block = m[1];
      const title = /<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block)?.[1] || "";
      const link = /<link>(.*?)<\/link>/.exec(block)?.[1] || "";
      const desc =
        /<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(block)?.[1] || "";

      return {
        id: `vnexp-${i}`,
        title,
        url: link,
        description: desc,
        source: link,
        date: safeDateStr(),
        platform: "VNExpress",
        category: "World",
        tags: ["Vietnam", "World"],
        views: num(Math.random() * 5000),
      };
    });
  } catch (e) {
    console.error("fetchVnExpressInternational failed:", e);
    return [];
  }
}

// Nasdaq
async function fetchNasdaqNews() {
  try {
    const res = await defaultFetch("https://www.nasdaq.com/feed/rssoutbound?category=Business");
    const text = await res.text();
    const items = Array.from(text.matchAll(/<item>([\s\S]*?)<\/item>/g));

    return items.slice(0, 10).map((m, i) => {
      const block = m[1];
      const title = /<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block)?.[1] || "";
      const link = /<link>(.*?)<\/link>/.exec(block)?.[1] || "";
      const desc =
        /<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(block)?.[1] || "";

      return {
        id: `nasdaq-${i}`,
        title,
        url: link,
        description: desc,
        source: link,
        date: safeDateStr(),
        platform: "Nasdaq",
        category: "Business",
        tags: ["Business"],
        views: num(Math.random() * 20000),
      };
    });
  } catch (e) {
    console.error("fetchNasdaqNews failed:", e);
    return [];
  }
}

// TikTok
async function fetchTikTokTrends() {
  if (!RAPIDAPI_KEY) return [];
  try {
    const res = await defaultFetch("https://tiktok-all-in-one.p.rapidapi.com/feed", {
      headers: {
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": "tiktok-all-in-one.p.rapidapi.com",
      },
    });
    const data = await res.json();
    const items = data?.data || [];

    return items.slice(0, 10).map((it, i) => ({
      id: `tiktok-${i}`,
      title: it.title || "TikTok trend",
      url: it.play || "",
      description: it.desc || "",
      source: it.shareUrl || "",
      date: safeDateStr(),
      platform: "TikTok",
      category: "Entertainment",
      tags: ["TikTok"],
      views: num(it.playCount),
      engagement: num(it.diggCount),
    }));
  } catch (e) {
    console.error("fetchTikTokTrends failed:", e);
    return [];
  }
}

// Instagram
async function fetchInstagramTrends() {
  if (!RAPIDAPI_KEY) return [];
  try {
    const res = await defaultFetch(
      "https://instagram-scraper-api2.p.rapidapi.com/v1.2/top_reels",
      {
        headers: {
          "X-RapidAPI-Key": RAPIDAPI_KEY,
          "X-RapidAPI-Host": "instagram-scraper-api2.p.rapidapi.com",
        },
      }
    );
    const data = await res.json();
    const items = data?.data || [];

    return items.slice(0, 10).map((it, i) => ({
      id: `ig-${i}`,
      title: it.caption || "Instagram reel",
      url: it.video_url || "",
      description: it.caption || "",
      source: it.permalink || "",
      date: safeDateStr(),
      platform: "Instagram",
      category: "Entertainment",
      tags: ["Instagram"],
      views: num(it.play_count),
      engagement: num(it.like_count),
    }));
  } catch (e) {
    console.error("fetchInstagramTrends failed:", e);
    return [];
  }
}

// -------------------- Serverless Handler --------------------
if (typeof exports !== "undefined") {
  exports.handler = async (event) => {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Content-Type": "application/json",
    };

    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers, body: "" };
    }

    // === Gemini API handler ===
    if (event.path.endsWith("/analyze") && event.httpMethod === "POST") {
      try {
        if (!GEMINI_KEY) throw new Error("Missing GEMINI_KEY");
        const body = JSON.parse(event.body || "{}");
        const text = body.text || "";
        if (!text) throw new Error("No text provided for analysis");

        const geminiRes = await defaultFetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=" +
            GEMINI_KEY,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text }] }],
            }),
          }
        );
        const data = await geminiRes.json();

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, analysis: data }),
        };
      } catch (err) {
        console.error("Gemini analyze error", err);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ success: false, error: err.message }),
        };
      }
    }

    // === Fetch trends handler ===
    try {
      const [hackerNews, bbcWorld, vnexpressIntl, nasdaqNews, tiktok, instagram] =
        await Promise.all([
          fetchHackerNewsFrontpage(),
          fetchBBCWorld(),
          fetchVnExpressInternational(),
          fetchNasdaqNews(),
          fetchTikTokTrends(),
          fetchInstagramTrends(),
        ]);

      let trends = [
        ...(hackerNews || []),
        ...(bbcWorld || []),
        ...(vnexpressIntl || []),
        ...(nasdaqNews || []),
        ...(tiktok || []),
        ...(instagram || []),
      ]
        .filter(Boolean)
        .map((t) => ({
          ...t,
          views: Number.isFinite(Number(t.views)) ? Number(t.views) : undefined,
          engagement: Number.isFinite(Number(t.engagement))
            ? Number(t.engagement)
            : undefined,
          votes: Number.isFinite(Number(t.votes)) ? Number(t.votes) : 0,
        }))
        .sort(
          (a, b) =>
            (Number(b.views) || Number(b.engagement) || Number(b.votes) || 0) -
            (Number(a.views) || Number(a.engagement) || Number(a.votes) || 0)
        )
        .map((t, i) => ({ ...t, rank: i + 1 }));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, trends }),
      };
    } catch (error) {
      console.error("fetch-trends error", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: "Failed to fetch live trends",
          message: error.message,
        }),
      };
    }
  };
}

// ===============================
// FRONTEND PART (Browser)
// ===============================
if (typeof window !== "undefined") {
  const API_URL = "/.netlify/functions/fetch-trends";
  const trendContainer = document.getElementById("trendContainer");

  async function loadTrends() {
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      if (!json.success) throw new Error(json.error || "API failed");
      displayTrends(json.trends || []);
    } catch (err) {
      console.error("Load trends failed:", err);
      if (trendContainer) {
        trendContainer.innerHTML = `<p class="error">Failed to load trends</p>`;
      }
    }
  }

  function displayTrends(trends) {
    if (!Array.isArray(trends) || !trendContainer) return;
    trendContainer.innerHTML = "";
    trends.forEach((trend) => {
      if (!trend) return;
      const card = createTrendCard(trend);
      trendContainer.insertAdjacentHTML("beforeend", card);
    });
  }

  function createTrendCard(trend) {
    if (!trend) return "";
    const title = trend.title || "Untitled";
    const description = trend.description || "";
    const source = trend.source || trend.url || "#";
    const platform = trend.platform || (trend.tags ? trend.tags[0] : "General");
    const date = trend.date || "";
    const views = trend.views ?? trend.votes ?? 0;
    const engagement = trend.engagement ?? 0;
    const category = trend.category || "General";

    const tags = (trend.tags || [])
      .map((tag) => `<span class="tag">${tag}</span>`)
      .join(" ");

    return `
      <div class="trend-card" data-id="${trend.id}" data-title="${title}">
        <h3 class="trend-title" style="cursor:pointer">${trend.rank}. ${title}</h3>
        <p class="trend-desc">${description}</p>
        <div class="trend-meta">
          <span>Category: ${category}</span> | 
          <span>${platform}</span> | 
          <span>${date}</span>
        </div>
        <div class="trend-stats">
          👁 ${views} | ❤️ ${engagement}
        </div>
        <div class="trend-tags">${tags}</div>
        <a href="${source}" target="_blank">Source</a>
        <button class="analyze-btn">Analyze</button>
      </div>
    `;
  }

  async function handleTrendListInteraction(event) {
    const card = event.target.closest(".trend-card");
    if (!card) return;
    const title = card.dataset.title || "Untitled";

    if (event.target.classList.contains("trend-title")) {
      alert(`You clicked: ${title}`);
    }

    if (event.target.classList.contains("analyze-btn")) {
      try {
        const res = await fetch(API_URL + "/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: title }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        alert("Gemini Analysis:\n" + JSON.stringify(json.analysis, null, 2));
      } catch (err) {
        console.error("Analyze failed", err);
        alert("Analyze failed: " + err.message);
      }
    }
  }

  if (trendContainer) {
    trendContainer.addEventListener("click", handleTrendListInteraction);
  }
  document.addEventListener("DOMContentLoaded", loadTrends);
}
