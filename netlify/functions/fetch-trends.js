// File: netlify/functions/fetch-trends.js
const fetch = require("node-fetch");

// ===== Helpers =====
async function fetchWithTimeout(url, options = {}, ms = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      // Một số site cần UA
      headers: { "User-Agent": "Mozilla/5.0 (TrendsBot/1.0)" , ...(options.headers || {}) },
    });
    return res;
  } catch (err) {
    throw new Error(`Timeout or network error for ${url}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtmlEntities(str = "") {
  return str
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function getTag(block, tag) {
  const cdata = new RegExp(
    `<${tag}><!\\[CDATA\\[(.*?)\\]\\]><\\/${tag}>`,
    "is"
  );
  const plain = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(cdata) || block.match(plain);
  return m ? decodeHtmlEntities(m[1].trim()) : "";
}

function rssItems(xml) {
  const items = [];
  const reg = /<item[\s\S]*?>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = reg.exec(xml))) {
    items.push(m[1]);
  }
  return items;
}

function toDateStr(d) {
  const dt = d ? new Date(d) : new Date();
  return isNaN(dt.getTime())
    ? new Date().toISOString().split("T")[0]
    : dt.toISOString().split("T")[0];
}

// ===== Sources =====

// Hacker News
async function fetchHackerNewsFrontpage() {
  const res = await fetchWithTimeout("https://hnrss.org/frontpage");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Tech",
    tags: ["HackerNews"],
    votes: 500 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "Hacker News",
  }));
}

// The Verge
async function fetchTheVerge() {
  const res = await fetchWithTimeout("https://www.theverge.com/rss/index.xml");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Tech",
    tags: ["TheVerge"],
    votes: 450 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "The Verge",
  }));
}

// IGN Gaming
async function fetchIGNGaming() {
  const res = await fetchWithTimeout("https://feeds.ign.com/ign/games-all");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Gaming",
    tags: ["IGN", "Games"],
    votes: 430 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "IGN",
  }));
}

// VentureBeat AI
async function fetchVentureBeatAI() {
  const res = await fetchWithTimeout("https://venturebeat.com/category/ai/feed/");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "AI",
    tags: ["VentureBeat", "AI"],
    votes: 420 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "VentureBeat",
  }));
}

// MIT Technology Review (AI tag)
async function fetchMITTech() {
  const res = await fetchWithTimeout(
    "https://www.technologyreview.com/feed/tag/artificial-intelligence/"
  );
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "AI",
    tags: ["MITTechReview", "AI"],
    votes: 415 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "MIT Tech Review",
  }));
}

// Google News VIETNAM (thay VnExpress)
async function fetchGoogleNewsVN() {
  const res = await fetchWithTimeout(
    "https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi"
  );
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "News",
    tags: ["GoogleNewsVN", "Vietnam"],
    votes: 405 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "Google News VN",
  }));
}

// BBC World News
async function fetchBBCWorld() {
  const res = await fetchWithTimeout("http://feeds.bbci.co.uk/news/world/rss.xml");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "News",
    tags: ["BBC", "WorldNews"],
    votes: 360 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "BBC World News",
  }));
}

// Yahoo Finance
async function fetchYahooFinance() {
  const res = await fetchWithTimeout("https://finance.yahoo.com/rss/topstories");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Finance",
    tags: ["YahooFinance"],
    votes: 395 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "Yahoo Finance",
  }));
}

// CNBC Finance
async function fetchCNBCFinance() {
  const res = await fetchWithTimeout(
    "https://www.cnbc.com/id/10000664/device/rss/rss.html"
  );
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Finance",
    tags: ["CNBC", "Markets"],
    votes: 390 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "CNBC",
  }));
}

// Science Magazine (AAAS) – News
async function fetchScienceMagazine() {
  const res = await fetchWithTimeout("https://www.science.org/rss/news_current.xml");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Science",
    tags: ["ScienceMag"],
    votes: 370 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "Science Magazine",
  }));
}

// New Scientist
async function fetchNewScientist() {
  const res = await fetchWithTimeout("https://www.newscientist.com/feed/home/");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Science",
    tags: ["NewScientist"],
    votes: 365 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "New Scientist",
  }));
}

// Apple Music VN – Most Played
async function fetchAppleMusicMostPlayedVN() {
  const res = await fetchWithTimeout(
    "https://rss.applemarketingtools.com/api/v2/vn/music/most-played/100/songs.json"
  );
  if (!res.ok) return [];
  const json = await res.json();
  return json.feed.results.map((item, i) => ({
    title: item.name,
    description: item.artistName,
    category: "Music",
    tags: ["AppleMusic", "Vietnam", "MostPlayed"],
    votes: 500 - i,
    source: item.url,
    date: toDateStr(item.releaseDate || new Date().toISOString()),
    submitter: "Apple Music",
  }));
}

// Apple Music VN – New Releases
async function fetchAppleMusicNewReleasesVN() {
  const res = await fetchWithTimeout(
    "https://rss.applemarketingtools.com/api/v2/vn/music/new-releases/100/songs.json"
  );
  if (!res.ok) return [];
  const json = await res.json();
  return json.feed.results.map((item, i) => ({
    title: item.name,
    description: item.artistName,
    category: "Music",
    tags: ["AppleMusic", "Vietnam", "NewReleases"],
    votes: 480 - i,
    source: item.url,
    date: toDateStr(item.releaseDate || new Date().toISOString()),
    submitter: "Apple Music",
  }));
}

// ================== Entertainment Sources ==================

// Variety (Entertainment Global)
async function fetchVariety() {
  const res = await fetchWithTimeout("https://variety.com/feed/");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Entertainment",
    tags: ["Variety", "Global"],
    votes: 360 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "Variety",
  }));
}

// Deadline (Hollywood Entertainment)
async function fetchDeadline() {
  const res = await fetchWithTimeout("https://deadline.com/feed/");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Entertainment",
    tags: ["Deadline", "Showbiz", "Hollywood"],
    votes: 340 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "Deadline",
  }));
}
// Kênh14 (Vietnam Entertainment)
async function fetchKenh14() {
  const res = await fetchWithTimeout("https://kenh14.vn/giai-tri.rss");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Entertainment",
    tags: ["Kenh14", "Vietnam"],
    votes: 350 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "Kênh14",
  }));
}

// Zing News (Vietnam Entertainment)
async function fetchZingNewsEntertainment() {
  const res = await fetchWithTimeout("https://zingnews.vn/rss/giai-tri.rss");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Entertainment",
    tags: ["ZingNews", "Vietnam"],
    votes: 340 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "Zing News",
  }));
}

// ESPN World Sports
async function fetchESPN() {
  const res = await fetchWithTimeout("https://www.espn.com/espn/rss/news");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Sports",
    tags: ["ESPN", "WorldSports"],
    votes: 320 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "ESPN",
  }));
}

// ===== Netlify Function Handler =====
exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        ...headers,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    };
  }

  try {
    const sources = [
      fetchHackerNewsFrontpage(),
      fetchTheVerge(),
      fetchIGNGaming(),
      fetchVentureBeatAI(),
      fetchMITTech(),
      fetchGoogleNewsVN(), 
      fetchYahooFinance(),
      fetchCNBCFinance(),  
      fetchScienceMagazine(),
      fetchNewScientist(),
      fetchAppleMusicMostPlayedVN(),
      fetchAppleMusicNewReleasesVN(),
      fetchVariety(),
      fetchDeadline(),
      fetchKenh14(),
      fetchZingNewsEntertainment(),
      fetchBBCWorld(),
      fetchESPN(),
    ];

    const results = await Promise.allSettled(sources);

    let trends = [];
    for (const r of results) {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        trends.push(...r.value);
      } else if (r.status === "rejected") {
        console.warn("A source failed to fetch:", r.reason?.message || r.reason);
      }
    }

    if (trends.length === 0) {
      throw new Error("All data sources failed to respond in time.");
    }

    trends = trends
      .filter(Boolean)
      .sort((a, b) => (b.votes || 0) - (a.votes || 0))
      .map((t, i) => ({ ...t, id: i + 1 }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, trends }),
    };
  } catch (err) {
    console.error("fetch-trends handler error", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: "Failed to fetch live trends",
        message: err.message,
      }),
    };
  }
};
