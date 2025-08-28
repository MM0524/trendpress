// File: netlify/functions/fetch-trends.js
const fetch = require("node-fetch");
const { XMLParser } = require("fast-xml-parser");

// ===== Helpers =====

// Use the robust fetchWithTimeout from previous versions
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

function getSafeString(value) {
  return typeof value === 'string' ? value.trim() : (value?.toString().trim() || "");
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

// ===== Trend Factory (Enhanced to integrate with fast-xml-parser output) =====
function createStandardTrend(item, defaultCategory = "General", defaultRegion = "global", submitter = "Unknown", extraTags = []) {
  const title = getSafeString(item.title) || "No Title Available";
  const description = getSafeString(item.description || item.content) || "No description available"; // Atom often uses 'content'
  const link = getSafeString(item.link) || (item.link?.href ? getSafeString(item.link.href) : "#"); // Handle Atom link objects
  const pubDate = getSafeString(item.pubDate || item.published || item.updated) || new Date().toISOString();

  // Basic cleaning for title/description (sometimes they still contain HTML from RSS source)
  const cleanedTitle = title.replace(/<[^>]*>?/gm, '').replace(/\n/g, ' ').trim();
  const cleanedDescription = description.replace(/<[^>]*>?/gm, '').replace(/\n/g, ' ').trim();

  return {
    title_en: cleanedTitle,
    description_en: cleanedDescription,
    title_vi: cleanedTitle, // For simplicity, use original as Vietnamese.
    description_vi: cleanedDescription,
    category: defaultCategory,
    tags: [...new Set([...extraTags, submitter.replace(/\s/g, "") || "Unknown", defaultRegion || "global"].filter(Boolean))],
    votes: Math.floor(Math.random() * 500) + 100, // Random votes for demo purposes
    source: link,
    date: toDateStr(pubDate),
    sortKey: toSortValue(pubDate),
    submitter: submitter || "Unknown",
    region: defaultRegion || "global",
  };
}

// ===== RSS/Atom Fetcher (using fetchWithTimeout) =====
async function fetchAndParseFeed(url, sourceName, defaultCategory, defaultRegion, extraTags = []) {
  try {
    const res = await fetchWithTimeout(url);
    const text = await res.text();

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      // Ensure specific tags are always arrays, even if single occurrence
      isArray: (name, jpath, is  ) => {
        if (["item", "entry"].includes(name)) return true;
        return false;
      }
    });
    const parsed = parser.parse(text);

    let rawItems = [];

    // RSS structure
    if (parsed?.rss?.channel?.item) {
      rawItems = parsed.rss.channel.item;
    }
    // Atom structure
    else if (parsed?.feed?.entry) {
      rawItems = parsed.feed.entry;
    } else {
        console.warn(`⁉️ ${sourceName}: Không tìm thấy items trong cấu trúc RSS/Atom. URL: ${url}`);
        return [];
    }

    return rawItems.map(item => createStandardTrend(item, defaultCategory, defaultRegion, sourceName, extraTags));

  } catch (err) {
    console.error(`❌ Lỗi khi fetch hoặc parse ${sourceName} từ ${url}:`, err.message);
    return [];
  }
}

// ===== JSON Feed Fetcher (for Apple Music) =====
async function fetchJsonFeed(url, sourceName, defaultCategory, defaultRegion, extraTags = []) {
    try {
        const res = await fetchWithTimeout(url);
        const json = await res.json();

        let rawItems = [];
        if (json?.feed?.results) {
            rawItems = json.feed.results;
        } else {
            console.warn(`⁉️ ${sourceName}: Không tìm thấy results trong cấu trúc JSON. URL: ${url}`);
            return [];
        }

        return rawItems.map(item => ({
            title_en: getSafeString(item.name) || "No Title Available",
            description_en: getSafeString(item.artistName) || "No description available",
            title_vi: getSafeString(item.name) || "No Title Available", // For simplicity
            description_vi: getSafeString(item.artistName) || "No description available", // For simplicity
            category: defaultCategory,
            tags: [...new Set([...extraTags, sourceName.replace(/\s/g, "") || "Unknown", defaultRegion || "global"].filter(Boolean))],
            votes: Math.floor(Math.random() * 500) + 100,
            source: getSafeString(item.url) || "#",
            date: toDateStr(getSafeString(item.releaseDate) || new Date().toISOString()),
            sortKey: toSortValue(getSafeString(item.releaseDate) || new Date().toISOString()),
            submitter: sourceName,
            region: defaultRegion,
        }));
    } catch (err) {
        console.error(`❌ Lỗi khi fetch hoặc parse JSON từ ${sourceName} từ ${url}:`, err.message);
        return [];
    }
}


// ===== Individual fetch functions (with standardized category names) =====

// Technology
const fetchHackerNewsFrontpage = () =>
  fetchAndParseFeed("https://hnrss.org/frontpage", "Hacker News", "Technology", "global", ["HackerNews", "Tech"]);

const fetchTheVerge = () =>
  fetchAndParseFeed("https://www.theverge.com/rss/index.xml", "The Verge", "Technology", "global", ["Tech"]);

const fetchVentureBeatAI = () =>
  fetchAndParseFeed("https://venturebeat.com/category/ai/feed/", "VentureBeat AI", "AI", "global", ["VentureBeat"]); // AI is its own category

const fetchMITTech = () =>
  fetchAndParseFeed("https://www.technologyreview.com/feed/tag/artificial-intelligence/", "MIT Tech Review", "AI", "global", ["MITTechReview"]); // AI is its own category

const fetchIGNGaming = () =>
  fetchAndParseFeed("https://feeds.ign.com/ign/games-all", "IGN Gaming", "Gaming", "global", ["IGN", "Games"]);

// News
const fetchGoogleNewsVN = () =>
  fetchAndParseFeed("https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi", "Google News VN", "News", "vn", ["GoogleNewsVN", "Vietnam"]);

const fetchBBCWorld = () =>
  fetchAndParseFeed("http://feeds.bbci.co.uk/news/world/rss.xml", "BBC World", "News", "global", ["WorldNews"]);

const fetchPolitics = () =>
  fetchAndParseFeed("https://www.politico.com/rss/politics08.xml", "Politics", "Politics", "us", ["USA"]); // Specific to US politics

// Finance
const fetchYahooFinance = () =>
  fetchAndParseFeed("https://finance.yahoo.com/news/rss", "Yahoo Finance", "Finance", "global", ["Markets"]);

const fetchCNBCFinance = () =>
  fetchAndParseFeed("https://www.cnbc.com/id/10000664/device/rss/rss.html", "CNBC Finance", "Finance", "us", ["Markets", "USA"]);

// Science
const fetchScienceMagazine = () =>
  fetchAndParseFeed("https://www.sciencemag.org/rss/news_current.xml", "Science Magazine", "Science", "global", ["ScienceMag"]);

const fetchNewScientist = () =>
  fetchAndParseFeed("https://www.newscientist.com/feed/home/", "New Scientist", "Science", "global", ["NewScientist"]);

// Music (Using JSON fetcher for Apple Music)
const fetchAppleMusicMostPlayedVN = () =>
  fetchJsonFeed("https://rss.applemarketingtools.com/api/v2/vn/music/most-played/100/songs.json", "Apple Music Most Played VN", "Music", "vn", ["AppleMusic", "Vietnam", "MostPlayed"]);

const fetchAppleMusicNewReleasesVN = () =>
  fetchJsonFeed("https://rss.applemarketingtools.com/api/v2/vn/music/new-releases/100/albums.json", "Apple Music New Releases VN", "Music", "vn", ["AppleMusic", "Vietnam", "NewReleases"]);

// Media / Entertainment
const fetchYouTubeTrendingVN = () =>
  fetchAndParseFeed("https://rsshub.app/youtube/trending/region/VN", "YouTube Trending VN", "Media", "vn", ["YouTube", "Trending", "VN"]);

const fetchVariety = () =>
  fetchAndParseFeed("https://variety.com/feed/", "Variety", "Entertainment", "global", ["Hollywood"]);

const fetchDeadline = () =>
  fetchAndParseFeed("https://deadline.com/feed/", "Deadline", "Entertainment", "us", ["Showbiz", "Hollywood", "USA"]);

const fetchGameKVN = () =>
  fetchAndParseFeed("https://gamek.vn/home.rss", "GameK VN", "Gaming", "vn", ["Vietnam"]); // Categorized as Gaming

const fetchZingNewsEntertainment = () =>
  fetchAndParseFeed("https://zingnews.vn/rss/giai-tri.rss", "ZingNews Entertainment", "Entertainment", "vn", ["Vietnam"]);

// Sports
const fetchESPN = () =>
  fetchAndParseFeed("https://www.espn.com/espn/rss/news", "ESPN", "Sports", "us", ["WorldSports", "USA"]);

// Logistics
const fetchLogistics = () =>
  fetchAndParseFeed("https://www.supplychaindigital.com/rss", "Logistics", "Logistics", "global", ["SupplyChain"]);

// Cybersecurity
const fetchCybernews = () =>
  fetchAndParseFeed("https://cybernews.com/feed/", "Cybernews", "Cybersecurity", "global", ["Security"]);

// Healthcare
const fetchHealthcare = () =>
  fetchAndParseFeed("https://www.healthcareitnews.com/rss.xml", "Healthcare IT News", "Healthcare", "global", ["Health"]);

// Education
const fetchEducation = () =>
  fetchAndParseFeed("https://www.chronicle.com/section/News/6/rss", "The Chronicle of Higher Education", "Education", "us", ["USA"]);

// Environment
const fetchEnvironment = () =>
  fetchAndParseFeed("https://www.theguardian.com/environment/rss", "The Guardian Environment", "Environment", "global", ["Climate"]);

// Travel
const fetchTravel = () =>
  fetchAndParseFeed("https://www.travelandleisure.com/rss", "Travel & Leisure", "Travel", "global", ["Tourism"]);


// ===== Main handler =====
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

    const sources = [
      fetchHackerNewsFrontpage(), fetchTheVerge(), fetchIGNGaming(),
      fetchVentureBeatAI(), fetchMITTech(), fetchGoogleNewsVN(),
      fetchYahooFinance(), fetchCNBCFinance(), fetchScienceMagazine(),
      fetchNewScientist(), fetchAppleMusicMostPlayedVN(), fetchAppleMusicNewReleasesVN(),
      fetchYouTubeTrendingVN(), fetchVariety(), fetchDeadline(),
      fetchGameKVN(), fetchZingNewsEntertainment(), fetchBBCWorld(),
      fetchESPN(), fetchLogistics(), fetchCybernews(),
      fetchHealthcare(), fetchEducation(), fetchEnvironment(),
      fetchPolitics(), fetchTravel(),
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
    if (category && category !== "All") { // "All" is a frontend concept, filter if specific category is requested
      filteredTrends = filteredTrends.filter(t => t.category && t.category.toLowerCase() === category.toLowerCase());
    }
    if (timeframe && timeframe !== "all") { // "all" is a frontend concept for no timeframe filter
      const now = new Date();
      let cutoffDate = new Date(now);
      switch (timeframe) {
        case "7d": cutoffDate.setDate(now.getDate() - 7); break;
        case "1m": cutoffDate.setDate(now.getDate() - 30); break;
        case "12m": cutoffDate.setFullYear(now.getFullYear() - 1); break;
      }
      cutoffDate.setHours(0, 0, 0, 0); // Normalize to start of day
      filteredTrends = filteredTrends.filter(t => {
        const trendDate = new Date(t.date);
        trendDate.setHours(0, 0, 0, 0); // Normalize to start of day
        return trendDate >= cutoffDate;
      });
    }
    if (searchTerm) {
      const termLower = searchTerm.toLowerCase();
      filteredTrends = filteredTrends.filter(t =>
        (t.title_en && t.title_en.toLowerCase().includes(termLower)) ||
        (t.description_en && t.description_en.toLowerCase().includes(termLower)) ||
        (t.title_vi && t.title_vi.toLowerCase().includes(termLower)) ||
        (t.description_vi && t.description_vi.toLowerCase().includes(termLower)) ||
        (t.tags && t.tags.some(tag => tag.toLowerCase().includes(termLower))) // Search terms can match tags too
      );
    }
    // NEW: Hashtag filtering on backend
    if (hashtag) {
      const hashtagLower = hashtag.toLowerCase();
      filteredTrends = filteredTrends.filter(t =>
        t.tags && t.tags.some(tag => tag.toLowerCase() === hashtagLower) // Exact match for hashtags
      );
    }

    // Sort by newest first (descending sortKey) and then map to final format with IDs
    filteredTrends = filteredTrends
      .filter(Boolean) // Ensure no null/undefined items sneak through
      .sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0))
      .map((t, i) => {
        const { sortKey, ...rest } = t; // Exclude sortKey from final output
        return { ...rest, id: i + 1 }; // Ensure each trend has a unique ID
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
