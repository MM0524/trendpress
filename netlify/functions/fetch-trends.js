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
        "User-Agent": "Mozilla/5.0 (TrendsBot/1.0)", // User-Agent to mimic a browser
        "Accept": "application/xml, text/xml, application/rss+xml, application/atom+xml, application/json, text/plain, */*", // Accept headers
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
    // Handle specific network errors
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
        throw new Error(`Network error: Could not reach ${url}. Check URL or network.`);
    }
    throw new Error(`Network or processing error for ${url}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// Function to safely get string value, handling null/undefined/objects
function getSafeString(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value && typeof value === 'object' && value.hasOwnProperty('#text')) {
    return String(value['#text']).trim(); // For complex nodes like <title><#text>...</title>
  }
  if (value && typeof value === 'object' && value.hasOwnProperty('href')) {
    return String(value.href).trim(); // For Atom link objects
  }
  return String(value || "").trim(); // Fallback
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
  // Use getSafeString to extract values from parsed XML/JSON objects
  const title = getSafeString(item.title || item['media:title']) || "No Title Available";
  const description = getSafeString(item.description || item.content?.['#text'] || item.summary?.['#text'] || item.content) || "No description available"; // Atom often uses 'content' or 'summary'
  const link = getSafeString(item.link) || (item.link?.[0]?.href ? getSafeString(item.link[0].href) : "#"); // Handle Atom link objects (can be array)
  const pubDate = getSafeString(item.pubDate || item.published || item.updated) || new Date().toISOString();

  // Basic cleaning for title/description (sometimes they still contain HTML from RSS source)
  const cleanedTitle = title.replace(/<[^>]*>?/gm, '').replace(/\n/g, ' ').trim();
  const cleanedDescription = description.replace(/<[^>]*>?/gm, '').replace(/\n/g, ' ').trim();

  return {
    title_en: cleanedTitle,
    description_en: cleanedDescription,
    title_vi: cleanedTitle, // For simplicity, use original as Vietnamese. You can integrate a translation API here.
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

// ===== XML/RSS/Atom Feed Fetcher (using fetchWithTimeout) =====
async function fetchAndParseXmlFeed(url, sourceName, defaultCategory, defaultRegion, extraTags = []) {
  try {
    const res = await fetchWithTimeout(url);
    const text = await res.text();

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      // Ensure specific tags are always arrays, even if single occurrence
      isArray: (name, jpath, is  ) => {
        if (["item", "entry"].includes(name)) return true; // RSS items, Atom entries
        // You might need to add more specific tags here if they can be arrays
        return false;
      }
    });
    const parsed = parser.parse(text);

    let rawItems = [];

    // RSS structure (e.g., hnrss, theverge)
    if (parsed?.rss?.channel?.item) {
      rawItems = parsed.rss.channel.item;
    }
    // Atom structure (e.g., Google News, YouTube feeds)
    else if (parsed?.feed?.entry) {
      rawItems = parsed.feed.entry;
    } 
    // Sometimes the feed might be nested differently or have a single item
    else if (parsed?.feed?.item) { // Some feeds might just have <feed><item>
        rawItems = parsed.feed.item;
    }
    else {
        console.warn(`⁉️ ${sourceName}: Không tìm thấy items trong cấu trúc RSS/Atom chuẩn. URL: ${url}`);
        // Attempt to find items in other common RSS/Atom paths
        if (parsed?.channel?.item) { rawItems = parsed.channel.item; }
        else if (parsed?.feed) { // If it's just a <feed> root without <entry> or <item> at root level
            console.warn(`⁉️ ${sourceName}: Feed root nhưng không có entry/item trực tiếp. Có thể cần parse sâu hơn.`);
        }
        if (rawItems.length === 0) {
            console.error(`❌ ${sourceName}: Không thể tìm thấy bất kỳ item nào từ ${url}.`);
            return [];
        }
    }

    return rawItems.map(item => createStandardTrend(item, defaultCategory, defaultRegion, sourceName, extraTags));

  } catch (err) {
    console.error(`❌ Lỗi khi fetch hoặc parse XML từ ${sourceName} (${url}):`, err.message);
    return [];
  }
}

// ===== JSON Feed Fetcher (for Apple Music and potentially other JSON APIs) =====
async function fetchJsonFeed(url, sourceName, defaultCategory, defaultRegion, extraTags = []) {
    try {
        const res = await fetchWithTimeout(url);
        const json = await res.json();

        let rawItems = [];
        if (json?.feed?.results) { // Apple Music specific
            rawItems = json.feed.results;
        } else {
            console.warn(`⁉️ ${sourceName}: Không tìm thấy results trong cấu trúc JSON mong đợi. URL: ${url}`);
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
        console.error(`❌ Lỗi khi fetch hoặc parse JSON từ ${sourceName} (${url}):`, err.message);
        return [];
    }
}


// ===== Individual fetch functions (with standardized category names and correct fetcher) =====

// Technology
const fetchHackerNewsFrontpage = () =>
  fetchAndParseXmlFeed("https://hnrss.org/frontpage", "Hacker News", "Technology", "global", ["HackerNews", "Tech"]);

const fetchTheVerge = () =>
  fetchAndParseXmlFeed("https://www.theverge.com/rss/index.xml", "The Verge", "Technology", "global", ["Tech"]);

const fetchVentureBeatAI = () =>
  fetchAndParseXmlFeed("https://venturebeat.com/category/ai/feed/", "VentureBeat AI", "AI", "global", ["VentureBeat"]); 

const fetchMITTech = () =>
  fetchAndParseXmlFeed("https://www.technologyreview.com/feed/tag/artificial-intelligence/", "MIT Tech Review", "AI", "global", ["MITTechReview"]); 

// Gaming
const fetchIGNGaming = () =>
  fetchAndParseXmlFeed("https://feeds.ign.com/ign/games-all", "IGN Gaming", "Gaming", "global", ["IGN", "Games"]);

const fetchGameKVN = () =>
  fetchAndParseXmlFeed("https://gamek.vn/home.rss", "GameK VN", "Gaming", "vn", ["Vietnam"]);

// News
const fetchGoogleNewsVN = () =>
  fetchAndParseXmlFeed("https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi", "Google News VN", "News", "vn", ["GoogleNewsVN", "Vietnam"]);

const fetchBBCWorld = () =>
  fetchAndParseXmlFeed("http://feeds.bbci.co.uk/news/world/rss.xml", "BBC World", "News", "global", ["WorldNews"]);

// Finance
const fetchYahooFinance = () =>
  fetchAndParseXmlFeed("https://finance.yahoo.com/news/rss", "Yahoo Finance", "Finance", "global", ["Markets"]);

const fetchCNBCFinance = () =>
  fetchAndParseXmlFeed("https://www.cnbc.com/id/10000664/device/rss/rss.html", "CNBC Finance", "Finance", "us", ["Markets", "USA"]);

// Science
const fetchScienceMagazine = () =>
  fetchAndParseXmlFeed("https://www.sciencemag.org/rss/news_current.xml", "Science Magazine", "Science", "global", ["ScienceMag"]);

const fetchNewScientist = () =>
  fetchAndParseXmlFeed("https://www.newscientist.com/feed/home/", "New Scientist", "Science", "global", ["NewScientist"]);

// Music
const fetchAppleMusicMostPlayedVN = () =>
  fetchJsonFeed("https://rss.applemarketingtools.com/api/v2/vn/music/most-played/100/songs.json", "Apple Music Most Played VN", "Music", "vn", ["AppleMusic", "Vietnam", "MostPlayed"]);

const fetchAppleMusicNewReleasesVN = () =>
  fetchJsonFeed("https://rss.applemarketingtools.com/api/v2/vn/music/new-releases/100/albums.json", "Apple Music New Releases VN", "Music", "vn", ["AppleMusic", "Vietnam", "NewReleases"]);

// Media / Entertainment
const fetchYouTubeTrendingVN = () =>
  fetchAndParseXmlFeed("https://rsshub.app/youtube/trending/region/VN", "YouTube Trending VN", "Media", "vn", ["YouTube", "Trending", "VN"]);

const fetchVariety = () =>
  fetchAndParseXmlFeed("https://variety.com/feed/", "Variety", "Entertainment", "global", ["Hollywood"]);

const fetchDeadline = () =>
  fetchAndParseXmlFeed("https://deadline.com/feed/", "Deadline", "Entertainment", "us", ["Showbiz", "Hollywood", "USA"]);

const fetchZingNewsEntertainment = () =>
  fetchAndParseXmlFeed("https://zingnews.vn/rss/giai-tri.rss", "ZingNews Entertainment", "Entertainment", "vn", ["Vietnam"]);

// Sports
const fetchESPN = () =>
  fetchAndParseXmlFeed("https://www.espn.com/espn/rss/news", "ESPN", "Sports", "us", ["WorldSports", "USA"]);

// Logistics
const fetchLogistics = () =>
  fetchAndParseXmlFeed("https://www.supplychaindigital.com/rss", "Supply Chain Digital", "Logistics", "global", ["SupplyChain"]); // Changed source name

// Cybersecurity
const fetchCybernews = () =>
  fetchAndParseXmlFeed("https://cybernews.com/feed/", "Cybernews", "Cybersecurity", "global", ["Security"]);

// Healthcare
const fetchHealthcare = () =>
  fetchAndParseXmlFeed("https://www.healthcareitnews.com/rss.xml", "Healthcare IT News", "Healthcare", "global", ["Health"]); // Changed source name

// Education
const fetchEducation = () =>
  fetchAndParseXmlFeed("https://www.chronicle.com/section/News/6/rss", "The Chronicle of Higher Education", "Education", "us", ["USA"]);

// Environment
const fetchEnvironment = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/environment/rss", "The Guardian Environment", "Environment", "global", ["Climate"]); // Changed source name

// Politics
const fetchPolitics = () =>
  fetchAndParseXmlFeed("https://www.politico.com/rss/politics08.xml", "Politico", "Politics", "us", ["USA"]); // Changed source name

// Travel
const fetchTravel = () =>
  fetchAndParseXmlFeed("https://www.travelandleisure.com/rss", "Travel & Leisure", "Travel", "global", ["Tourism"]); // Changed source name


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

    // console.log(`Fetching trends with filters: Region=${region}, Category=${category}, Timeframe=${timeframe}, SearchTerm=${searchTerm}, Hashtag=${hashtag}`);

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
    // Hashtag filtering on backend (exact match for tags)
    if (hashtag) {
      const hashtagLower = hashtag.toLowerCase();
      filteredTrends = filteredTrends.filter(t =>
        t.tags && t.tags.some(tag => tag.toLowerCase() === hashtagLower)
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
