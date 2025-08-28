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
  // Regex to match <tag>content</tag> or <prefix:tag>content</prefix:tag>
  const regex = new RegExp(`<(${tag}|[a-zA-Z0-9]+:${tag})[^>]*?>([\\s\\S]*?)<\\/\\1>`, "i");
  
  let m = block.match(regex);
  let content = m && m[2] ? m[2].trim() : ""; // Use m[2] for content (group 2)

  if (tag === "description" || tag === "title") {
    content = content.replace(/<[^>]*>?/gm, ""); // Remove any HTML tags within title/description
  }
  return decodeHtmlEntities(content) || ""; // Ensure it's always a string
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
    ? new Date().toISOString().split("T")[0] // Fallback to current date if invalid
    : dt.toISOString().split("T")[0]; // YYYY-MM-DD
}

function toSortValue(d) {
  const dt = d ? new Date(d) : null;
  // Return 0 if date is invalid, so it sorts to the end (oldest) when sorting descending
  return dt && !isNaN(dt.getTime()) ? dt.getTime() : 0;
}

// ===== Trend Factory =====
function createTrendFromRssItem(block, defaultCategory = "General", defaultRegion = "global", submitter = "Unknown", extraTags = []) {
  const pub = getTag(block, "pubDate") || new Date().toISOString();
  const title = getTag(block, "title") || "No Title Available"; // Stronger fallback
  const description = getTag(block, "description") || "No description available"; // Stronger fallback
  const link = getTag(block, "link") || "#"; // Fallback to '#' for valid href

  return {
    title_en: title,
    description_en: description,
    title_vi: title, // For simplicity, use original as Vietnamese.
    description_vi: description,
    category: defaultCategory,
    tags: [...new Set([...extraTags, submitter.replace(/\s/g, "") || "Unknown", defaultRegion || "global"].filter(Boolean))],
    votes: Math.floor(Math.random() * 500) + 100,
    source: link,
    date: toDateStr(pub),
    sortKey: toSortValue(pub),
    submitter: submitter || "Unknown",
    region: defaultRegion || "global",
  };
}

// ===== Sources (Updated categories for consistency with frontend) =====

async function fetchHackerNewsFrontpage() {
  const res = await fetchWithTimeout("https://hnrss.org/frontpage");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Technology", "global", "Hacker News", ["HackerNews", "Tech"]));
}

async function fetchTheVerge() {
  const res = await fetchWithTimeout("https://www.theverge.com/rss/index.xml");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Technology", "global", "The Verge", ["Tech"]));
}

async function fetchIGNGaming() {
  const res = await fetchWithTimeout("https://feeds.ign.com/ign/games-all");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Gaming", "global", "IGN", ["IGN", "Games"]));
}

async function fetchVentureBeatAI() {
  const res = await fetchWithTimeout("https://venturebeat.com/category/ai/feed/");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "AI", "global", "VentureBeat", ["VentureBeat", "AI"]));
}

async function fetchMITTech() {
  const res = await fetchWithTimeout("https://www.technologyreview.com/feed/tag/artificial-intelligence/");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "AI", "global", "MIT Tech Review", ["MITTechReview", "AI"]));
}

async function fetchGoogleNewsVN() {
  const res = await fetchWithTimeout("https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "News", "vn", "Google News VN", ["GoogleNewsVN", "Vietnam"]));
}

async function fetchBBCWorld() {
  const res = await fetchWithTimeout("https://feeds.bbci.co.uk/news/world/rss.xml");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "News", "global", "BBC World News", ["BBC", "WorldNews"]));
}

async function fetchYahooFinance() {
  const res = await fetchWithTimeout("https://finance.yahoo.com/rss/topstories");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Finance", "global", "Yahoo Finance", ["YahooFinance"]));
}

async function fetchCNBCFinance() {
  const res = await fetchWithTimeout("https://www.cnbc.com/id/10000664/device/rss/rss.html");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Finance", "us", "CNBC", ["CNBC", "Markets", "USA"]));
}

async function fetchScienceMagazine() {
  const res = await fetchWithTimeout("https://www.science.org/rss/news_current.xml");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Science", "global", "Science Magazine", ["ScienceMag"]));
}

async function fetchNewScientist() {
  const res = await fetchWithTimeout("https://www.newscientist.com/feed/home/");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Science", "global", "New Scientist", ["NewScientist"]));
}

async function fetchAppleMusicMostPlayedVN() {
  const res = await fetchWithTimeout("https://rss.applemarketingtools.com/api/v2/vn/music/most-played/100/songs.json");
  const json = await res.json();
  return (json.feed.results || []).map(item => {
    const pub = item.releaseDate || new Date().toISOString();
    return {
      title_en: item.name || "Untitled",
      description_en: item.artistName || "Unknown Artist",
      title_vi: item.name || "Untitled", // Placeholder
      description_vi: item.artistName || "Unknown Artist", // Placeholder
      category: "Music",
      tags: ["AppleMusic", "Vietnam", "MostPlayed"],
      votes: Math.floor(Math.random() * 500) + 100,
      source: item.url || "#",
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "Apple Music",
      region: "vn",
    };
  });
}

async function fetchAppleMusicNewReleasesVN() {
  const res = await fetchWithTimeout("https://rss.applemarketingtools.com/api/v2/vn/music/new-releases/100/songs.json");
  const json = await res.json();
  return (json.feed.results || []).map(item => {
    const pub = item.releaseDate || new Date().toISOString();
    return {
      title_en: item.name || "Untitled",
      description_en: item.artistName || "Unknown Artist",
      title_vi: item.name || "Untitled", // Placeholder
      description_vi: item.artistName || "Unknown Artist", // Placeholder
      category: "Music",
      tags: ["AppleMusic", "Vietnam", "NewReleases"],
      votes: Math.floor(Math.random() * 500) + 100,
      source: item.url || "#",
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "Apple Music",
      region: "vn",
    };
  });
}

async function fetchYouTubeTrendingVN() {
  const res = await fetchWithTimeout("https://rsshub.app/youtube/trending/region/VN");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Media", "vn", "YouTube Trending VN", ["YouTube", "Trending", "VN"]));
}

async function fetchVariety() {
  const res = await fetchWithTimeout("https://variety.com/feed/");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Entertainment", "global", "Variety", ["Hollywood"]));
}

async function fetchDeadline() {
  const res = await fetchWithTimeout("https://deadline.com/feed/");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Entertainment", "us", "Deadline", ["Showbiz", "Hollywood"]));
}

async function fetchKenh14() {
  const res = await fetchWithTimeout("https://kenh14.vn/giai-tri.rss");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Entertainment", "vn", "Kênh14", ["Vietnam"]));
}

async function fetchZingNewsEntertainment() {
  const res = await fetchWithTimeout("https://zingnews.vn/rss/giai-tri.rss");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Entertainment", "vn", "Zing News", ["Vietnam"]));
}

async function fetchESPN() {
  const res = await fetchWithTimeout("https://www.espn.com/espn/rss/news");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Sports", "us", "ESPN", ["WorldSports", "USA"]));
}

async function fetchLogistics() {
  const res = await fetchWithTimeout("https://www.freightwaves.com/feed");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Logistics", "global", "FreightWaves", ["SupplyChain"]));
}

async function fetchCybernews() {
  const res = await fetchWithTimeout("https://cybernews.com/feed/");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Cybersecurity", "global", "Cybernews", ["Security"]));
}

async function fetchHealthcare() {
  const res = await fetchWithTimeout("https://www.medicalnewstoday.com/rss");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Healthcare", "global", "Medical News Today", ["Health"]));
}

async function fetchEducation() {
  const res = await fetchWithTimeout("https://www.chronicle.com/section/News/6/feed");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Education", "us", "The Chronicle of Higher Education", ["USA"]));
}

async function fetchEnvironment() {
  const res = await fetchWithTimeout("https://www.nationalgeographic.com/environment/rss");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Environment", "global", "National Geographic", ["Climate"]));
}

async function fetchPolitics() {
  const res = await fetchWithTimeout("https://feeds.reuters.com/Reuters/worldNews");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Politics", "global", "Reuters World News", ["GlobalNews"]));
}

async function fetchTravel() {
  const res = await fetchWithTimeout("https://www.lonelyplanet.com/news/rss");
  const xml = await res.text();
  return rssItems(xml).map(block => createTrendFromRssItem(block, "Travel", "global", "Lonely Planet", ["Tourism"]));
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
    const { region, category, timeframe, searchTerm, hashtag } = event.queryStringParameters || {};

    // console.log(`Fetching trends with filters: Region=${region}, Category=${category}, Timeframe=${timeframe}, SearchTerm=${searchTerm}, Hashtag=${hashtag}`);

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

    // Apply filters
    let filteredTrends = allFetchedTrends;

    if (region && region !== "global") {
      filteredTrends = filteredTrends.filter(t => t.region && t.region.toLowerCase() === region.toLowerCase());
    }
    if (category && category !== "All") {
      filteredTrends = filteredTrends.filter(t => t.category && t.category.toLowerCase() === category.toLowerCase());
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
    // NEW: Hashtag filtering on backend
    if (hashtag) {
      const hashtagLower = hashtag.toLowerCase();
      filteredTrends = filteredTrends.filter(t =>
        t.tags && t.tags.some(tag => tag.toLowerCase() === hashtagLower) // Exact match for hashtags
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
    console.error("fetch-trends handler error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: "Failed to fetch trends", message: err.message }),
    };
  }
};
