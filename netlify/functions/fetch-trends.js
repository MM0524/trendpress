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
      headers: {
        "User-Agent": "Mozilla/5.0 (TrendsBot/1.0)",
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP error! Status: ${res.status} from ${url}`);
    }
    return res;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${ms}ms.`);
    }
    throw new Error(`Network or processing error for ${url}: ${err.message}`);
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
  const regex = new RegExp(`<${tag}[^>]*?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const nsRegex = new RegExp(`<[a-zA-Z0-9]+:${tag}[^>]*?>([\\s\\S]*?)<\\/[a-zA-Z0-9]+:${tag}>`, "i");

  let m = block.match(regex) || block.match(nsRegex);
  let content = m ? m[1].trim() : "";

  if (tag === "description" || tag === "title") {
    content = content.replace(/<[^>]*>?/gm, "");
  }
  return decodeHtmlEntities(content) || "";
}

function rssItems(xml) {
  const items = [];
  const reg = /<item[\s\S]*?>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = reg.exec(xml))) items.push(m[1]);
  return items;
}

// ---- Date helpers ----
function toDateStr(d) {
  const dt = d ? new Date(d) : new Date();
  return isNaN(dt.getTime())
    ? new Date().toISOString().split("T")[0]
    : dt.toISOString().split("T")[0];
}

function toSortValue(d) {
  const dt = d ? new Date(d) : null;
  return dt && !isNaN(dt.getTime()) ? dt.getTime() : Date.now();
}

// ===== Trend Factory =====
function createTrendFromRssItem(block, defaultCategory = "General", defaultRegion = "global", submitter = "Unknown") {
  const pub = getTag(block, "pubDate") || new Date().toISOString();
  const title = getTag(block, "title") || "Untitled";
  const description = getTag(block, "description") || "No description available";
  const link = getTag(block, "link") || "";

  return {
    title_en: title,
    description_en: description,
    title_vi: title,
    description_vi: description,
    category: defaultCategory,
    tags: [submitter.replace(/\s/g, "") || "Unknown", defaultRegion || "global"],
    votes: Math.floor(Math.random() * 500) + 100,
    source: link,
    date: toDateStr(pub),
    sortKey: toSortValue(pub),
    submitter: submitter || "Unknown",
    region: defaultRegion || "global",
  };
}

// ===== Sources =====

// Hacker News
async function fetchHackerNewsFrontpage() {
  const res = await fetchWithTimeout("https://hnrss.org/frontpage");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Tech", "global", "Hacker News"));
}

// The Verge
async function fetchTheVerge() {
  const res = await fetchWithTimeout("https://www.theverge.com/rss/index.xml");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Tech", "global", "The Verge"));
}

// IGN Gaming
async function fetchIGNGaming() {
  const res = await fetchWithTimeout("https://feeds.ign.com/ign/games-all");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Gaming", "global", "IGN"));
}

// VentureBeat AI
async function fetchVentureBeatAI() {
  const res = await fetchWithTimeout("https://venturebeat.com/category/ai/feed/");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "AI", "global", "VentureBeat"));
}

// MIT Tech Review
async function fetchMITTech() {
  const res = await fetchWithTimeout("https://www.technologyreview.com/feed/tag/artificial-intelligence/");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "AI", "global", "MIT Tech Review"));
}

// Google News VN
async function fetchGoogleNewsVN() {
  const res = await fetchWithTimeout("https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi");
  const xml = await res.text();
  return rssItems(xml).map(block => {
    const trend = createTrendFromRssItem(block, "News", "vn", "Google News VN");
    trend.tags.push("Vietnam");
    return trend;
  });
}

// BBC World
async function fetchBBCWorld() {
  const res = await fetchWithTimeout("https://feeds.bbci.co.uk/news/world/rss.xml");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "News", "global", "BBC World News"));
}

// Yahoo Finance
async function fetchYahooFinance() {
  const res = await fetchWithTimeout("https://finance.yahoo.com/rss/topstories");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Finance", "global", "Yahoo Finance"));
}

// CNBC Finance
async function fetchCNBCFinance() {
  const res = await fetchWithTimeout("https://www.cnbc.com/id/10000664/device/rss/rss.html");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Finance", "us", "CNBC"));
}

// Science Magazine
async function fetchScienceMagazine() {
  const res = await fetchWithTimeout("https://www.science.org/rss/news_current.xml");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Science", "global", "Science Magazine"));
}

// New Scientist
async function fetchNewScientist() {
  const res = await fetchWithTimeout("https://www.newscientist.com/feed/home/");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Science", "global", "New Scientist"));
}

// Apple Music VN – Most Played
async function fetchAppleMusicMostPlayedVN() {
  const res = await fetchWithTimeout("https://rss.applemarketingtools.com/api/v2/vn/music/most-played/100/songs.json");
  const json = await res.json();
  return (json.feed.results || []).map(item => {
    const pub = item.releaseDate || new Date().toISOString();
    return {
      title_en: item.name || "Untitled",
      description_en: item.artistName || "Unknown Artist",
      title_vi: item.name || "Untitled",
      description_vi: item.artistName || "Unknown Artist",
      category: "Music",
      tags: ["AppleMusic", "Vietnam", "MostPlayed"],
      votes: Math.floor(Math.random() * 500) + 100,
      source: item.url || "",
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "Apple Music",
      region: "vn",
    };
  });
}

// Apple Music VN – New Releases
async function fetchAppleMusicNewReleasesVN() {
  const res = await fetchWithTimeout("https://rss.applemarketingtools.com/api/v2/vn/music/new-releases/100/songs.json");
  const json = await res.json();
  return (json.feed.results || []).map(item => {
    const pub = item.releaseDate || new Date().toISOString();
    return {
      title_en: item.name || "Untitled",
      description_en: item.artistName || "Unknown Artist",
      title_vi: item.name || "Untitled",
      description_vi: item.artistName || "Unknown Artist",
      category: "Music",
      tags: ["AppleMusic", "Vietnam", "NewReleases"],
      votes: Math.floor(Math.random() * 500) + 100,
      source: item.url || "",
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "Apple Music",
      region: "vn",
    };
  });
}

// YouTube Trending VN (RSSHub)
async function fetchYouTubeTrendingVN() {
  const res = await fetchWithTimeout("https://rsshub.app/youtube/trending/region/VN");
  const xml = await res.text();
  return rssItems(xml).map(block => {
    const trend = createTrendFromRssItem(block, "Media", "vn", "YouTube Trending VN");
    trend.tags.push("YouTube", "Trending");
    return trend;
  });
}

// Variety
async function fetchVariety() {
  const res = await fetchWithTimeout("https://variety.com/feed/");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Entertainment", "global", "Variety"));
}

// Deadline
async function fetchDeadline() {
  const res = await fetchWithTimeout("https://deadline.com/feed/");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Entertainment", "us", "Deadline"));
}

// Kênh14
async function fetchKenh14() {
  const res = await fetchWithTimeout("https://kenh14.vn/giai-tri.rss");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Entertainment", "vn", "Kênh14"));
}

// Zing News
async function fetchZingNewsEntertainment() {
  const res = await fetchWithTimeout("https://zingnews.vn/rss/giai-tri.rss");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Entertainment", "vn", "Zing News"));
}

// ESPN
async function fetchESPN() {
  const res = await fetchWithTimeout("https://www.espn.com/espn/rss/news");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Sports", "us", "ESPN"));
}

// Logistics
async function fetchLogistics() {
  const res = await fetchWithTimeout("https://www.freightwaves.com/feed");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Logistics", "global", "FreightWaves"));
}

// Cybernews
async function fetchCybernews() {
  const res = await fetchWithTimeout("https://cybernews.com/feed/");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Cybersecurity", "global", "Cybernews"));
}

// Healthcare
async function fetchHealthcare() {
  const res = await fetchWithTimeout("https://www.medicalnewstoday.com/rss");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Healthcare", "global", "Medical News Today"));
}

// Education
async function fetchEducation() {
  const res = await fetchWithTimeout("https://www.chronicle.com/section/News/6/feed");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Education", "us", "The Chronicle of Higher Education"));
}

// Environment
async function fetchEnvironment() {
  const res = await fetchWithTimeout("https://www.nationalgeographic.com/environment/rss");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Environment", "global", "National Geographic"));
}

// Politics
async function fetchPolitics() {
  const res = await fetchWithTimeout("https://feeds.reuters.com/Reuters/worldNews");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Politics", "global", "Reuters World News"));
}

// Travel
async function fetchTravel() {
  const res = await fetchWithTimeout("https://www.lonelyplanet.com/news/rss");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Travel", "global", "Lonely Planet"));
}

// ===== Handler =====
exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  try {
    const { region, category, timeframe, searchTerm } = event.queryStringParameters || {};

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
      fetchYouTubeTrendingVN(),
      fetchVariety(),
      fetchDeadline(),
      fetchKenh14(),
      fetchZingNewsEntertainment(),
      fetchBBCWorld(),
      fetchESPN(),
      fetchLogistics(),
      fetchCybernews(),
      fetchHealthcare(),
      fetchEducation(),
      fetchEnvironment(),
      fetchPolitics(),
      fetchTravel(),
    ];

    const results = await Promise.allSettled(sources);

    let allFetchedTrends = [];
    for (const r of results) {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        allFetchedTrends.push(...r.value);
      } else if (r.status === "rejected") {
        console.warn("A source failed:", r.reason?.message || r.reason);
      }
    }

    if (allFetchedTrends.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, trends: [], message: "No trends found." }),
      };
    }

    // filters
    let filteredTrends = allFetchedTrends;

    if (region && region !== "global") {
      filteredTrends = filteredTrends.filter(t => t.region === region);
    }
    if (category && category !== "All") {
      filteredTrends = filteredTrends.filter(t => t.category === category);
    }
    if (timeframe && timeframe !== "all") {
      const now = new Date();
      let cutoffDate = new Date(now);
      switch (timeframe) {
        case "7d": cutoffDate.setDate(now.getDate() - 7); break;
        case "1m": cutoffDate.setDate(now.getDate() - 30); break;
        case "12m": cutoffDate.setFullYear(now.getFullYear() - 1); break;
      }
      cutoffDate.setHours(0, 0, 0, 0);
      filteredTrends = filteredTrends.filter(t => {
        const trendDate = new Date(t.date);
        trendDate.setHours(0, 0, 0, 0);
        return trendDate >= cutoffDate;
      });
    }
    if (searchTerm) {
      const termLower = searchTerm.toLowerCase();
      filteredTrends = filteredTrends.filter(t =>
        (t.title_en && t.title_en.toLowerCase().includes(termLower)) ||
        (t.description_en && t.description_en.toLowerCase().includes(termLower)) ||
        (t.title_vi && t.title_vi.toLowerCase().includes(termLower)) ||
        (t.description_vi && t.description_vi.toLowerCase().includes(termLower))
      );
    }

    filteredTrends = filteredTrends
      .filter(Boolean)
      .sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0))
      .map((t, i) => {
        const { sortKey, ...rest } = t;
        return { ...rest, id: i + 1 };
      });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, trends: filteredTrends }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: "Failed to fetch trends", message: err.message }),
    };
  }
};
