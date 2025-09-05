// File: netlify/functions/fetch-trends.js
const fetch = require("node-fetch");
const { XMLParser } = require("fast-xml-parser");
const crypto = require('crypto'); // Import crypto for hashing

// ===== Helpers =====

async function fetchWithTimeout(url, options = {}, ms = 20000) { // Increased timeout to 20 seconds
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        // More robust User-Agent to mimic a real browser
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
        "Accept": "application/xml, text/xml, application/rss+xml, application/atom+xml, application/json, text/plain, */*",
        "Referer": new URL(url).origin, // Add Referer header
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
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.name === 'FetchError') {
        throw new Error(`Network error: Could not reach ${url}. Message: ${err.message}`);
    }
    throw new Error(`Processing error for ${url}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// Function to safely get string value, handling null/undefined/objects
function getSafeString(value) {
  if (value === null || value === undefined) {
    return "";
  }
  let strValue = "";
  if (typeof value === 'string') {
    strValue = value;
  }
  else if (typeof value === 'object' && value.hasOwnProperty('#text')) { // For XML text nodes
    strValue = String(value['#text']);
  }
  else if (typeof value === 'object' && value.hasOwnProperty('href')) { // For Atom link objects
    strValue = String(value.href);
  }
  else if (Array.isArray(value)) { // Sometimes a field might be an array, take the first one or join
      strValue = String(value[0]); 
  }
  else {
    strValue = String(value);
  }
  return decodeHtmlEntities(strValue).trim();
}

// ---- HTML Entity Decoder (defined globally) ----
function decodeHtmlEntities(str = "") {
  return str
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
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
  // Fallback to 0 so invalid dates sort to the end (oldest) when sorting descending
  return dt && !isNaN(dt.getTime()) ? dt.getTime() : 0; 
}

// ===== Trend Factory (Standardizes item data from various feed types) =====
function createStandardTrend(item, sourceName, defaultCategory = "General", defaultRegion = "global", extraTags = []) {
  const title = getSafeString(item.title || item['media:title'] || item.name) || "No Title Available"; 
  const description = getSafeString(item.description || item.content?.['#text'] || item.summary?.['#text'] || item.content || item.artistName) || "No description available";
  
  let link = getSafeString(item.link);
  if (Array.isArray(item.link)) { // Handle array of links (common in Atom)
      const firstLink = item.link.find(l => l.rel === 'alternate' || !l.rel); // Prefer alternate or non-rel link
      if (firstLink && firstLink.href) {
          link = getSafeString(firstLink.href);
      } else if (item.link.length > 0) { // Fallback to first link if no better match
          link = getSafeString(item.link[0]);
      }
  } else if (typeof item.link === 'object' && item.link.href) { // Handle Atom link objects { href: "..." }
      link = getSafeString(item.link.href);
  }
  link = link || "#"; // Final fallback for link

  const pubDate = getSafeString(item.pubDate || item.published || item.updated || item.releaseDate) || new Date().toISOString();

  // Basic cleaning for title/description (sometimes they still contain HTML from RSS source)
  const cleanedTitle = title.replace(/<[^>]*>?/gm, '').replace(/\n{2,}/g, '\n').trim();
  const cleanedDescription = description.replace(/<[^>]*>?/gm, '').replace(/\n{2,}/g, '\n').trim();

  const baseVotes = Math.floor(Math.random() * 2000) + 1000; // Phạm vi votes (1000-2999)
  const baseMultiplier = (Math.random() * 1.5) + 0.5; // (0.5 - 2.0)

  // NEW: Create a stable ID using a hash of the source URL + title
  // This ensures ID is consistent across fetches and unique for each real trend
  const stableId = crypto.createHash('md5').update(`${link}-${cleanedTitle}`).digest('hex');


  return {
    id: stableId, // <<<<<<<<<<<<<<<<< ID ỔN ĐỊNH TỪ HASH
    title_en: cleanedTitle,
    description_en: cleanedDescription,
    title_vi: cleanedTitle,
    description_vi: cleanedDescription,
    category: defaultCategory,
    tags: [...new Set([...extraTags, sourceName.replace(/\s/g, "") || "Unknown", defaultRegion || "global"].filter(Boolean))],
    votes: baseVotes,
    views: Math.floor(baseVotes * (baseMultiplier * (Math.random() * 10 + 15))), // ~15-25x votes
    interactions: Math.floor(baseVotes * (baseMultiplier * (Math.random() * 3 + 4))), // ~4-7x votes
    searches: Math.floor(baseVotes * (baseMultiplier * (Math.random() * 1 + 1.5))), // ~1.5-2.5x votes
    source: link,
    date: toDateStr(pubDate),
    sortKey: toSortValue(pubDate),
    submitter: sourceName || "Unknown",
    region: defaultRegion || "global",
  };
}

// ===== XML/RSS/Atom Feed Fetcher (robust) =====
async function fetchAndParseXmlFeed(url, sourceName, defaultCategory, defaultRegion, extraTags = []) {
  try {
    const res = await fetchWithTimeout(url);
    const text = await res.text();

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      trimValues: true,
      textNodeName: "#text",
      removeNSPrefix: true, // NEW: Remove namespace prefixes (e.g., 'media:title' -> 'title')
      isArray: (name, jpath, is  ) => {
        if (["item", "entry"].includes(name)) return true; // RSS items, Atom entries
        // Handle common cases where links/categories might be arrays
        if (["link", "category"].includes(name) && (jpath.includes("entry") || jpath.includes("item"))) return true;
        return false;
      }
    });
    const parsed = parser.parse(text);

    let rawItems = [];

    // Prioritized search for items in common structures
    if (parsed?.rss?.channel?.item) {
      rawItems = parsed.rss.channel.item;
    } else if (parsed?.feed?.entry) { // Atom standard
      rawItems = parsed.feed.entry;
    } else if (parsed?.channel?.item) { // Older RSS (e.g., some non-standard feeds)
        rawItems = parsed.channel.item;
    } else if (parsed?.feed?.item) { // Non-standard Atom-like (e.g., some Feedburner)
        rawItems = parsed.feed.item;
    } else if (parsed?.RDF?.item) { // For RDF feeds (like some Science Magazine)
        rawItems = parsed.RDF.item; // Removed 'rdf:' prefix due to removeNSPrefix
    } else if (parsed?.RDF?.li) { // For RDF feeds with li (after removeNSPrefix)
        rawItems = parsed.RDF.li;
    }
    
    // Fallback: Check if any top-level array looks like items (heuristic)
    if (rawItems.length === 0) {
        for (const key in parsed) {
            const potentialItems = parsed[key];
            if (Array.isArray(potentialItems) && potentialItems.length > 0 && typeof potentialItems[0] === 'object' && (potentialItems[0].title || potentialItems[0].name)) {
                rawItems = potentialItems;
                console.warn(`⚠️ ${sourceName}: Tìm thấy items ở đường dẫn không chuẩn: parsed.${key} từ ${url}.`);
                break;
            }
        }
    }
    
    if (rawItems.length === 0) {
        console.error(`❌ ${sourceName}: Không thể tìm thấy bất kỳ item nào từ ${url} sau khi parse. Cấu trúc gốc: ${JSON.stringify(Object.keys(parsed || {}))}`);
        return [];
    }

    return rawItems.map(item => createStandardTrend(item, sourceName, defaultCategory, defaultRegion, extraTags));

  } catch (err) {
    console.error(`❌ Lỗi khi fetch hoặc parse XML từ ${sourceName} (${url}):`, err.message);
    return [];
  }
}

// ===== JSON Feed Fetcher =====
async function fetchJsonFeed(url, sourceName, defaultCategory, defaultRegion, extraTags = []) {
    try {
        const res = await fetchWithTimeout(url);
        const json = await res.json();

        let rawItems = [];
        if (json?.feed?.results) { // Apple Music specific structure
            rawItems = json.feed.results;
        } else {
            console.warn(`⁉️ ${sourceName}: Không tìm thấy results trong cấu trúc JSON mong đợi. URL: ${url}`);
            return [];
        }

        // CẬP NHẬT: Đảm bảo JSON feed cũng sử dụng createStandardTrend để có metrics nhất quán
        return rawItems.map(item => createStandardTrend(item, sourceName, defaultCategory, defaultRegion, extraTags));
    } catch (err) {
        console.error(`❌ Lỗi khi fetch hoặc parse JSON từ ${sourceName} (${url}):`, err.message);
        return [];
    }
}


// ===== Individual fetch functions (with standardized category names and correct fetcher) =====

// === Technology ===
const fetchHackerNewsFrontpage = () =>
  fetchAndParseXmlFeed("https://hnrss.org/frontpage", "Hacker News", "Technology", "global", ["HackerNews", "Tech"]);

const fetchTheVerge = () =>
  fetchAndParseXmlFeed("https://www.theverge.com/rss/index.xml", "The Verge", "Technology", "global", ["Tech"]);

const fetchWired = () =>
  fetchAndParseXmlFeed("https://www.wired.com/feed/rss", "Wired", "Technology", "global", ["Tech"]);

const fetchTechCrunch = () =>
  fetchAndParseXmlFeed("https://techcrunch.com/feed/", "TechCrunch", "Technology", "global", ["Tech"]);

// === AI ===
const fetchVentureBeatAI = () =>
  fetchAndParseXmlFeed("https://venturebeat.com/category/ai/feed", "VentureBeat AI", "AI", "global", ["AI"]);


// === Gaming ===
const fetchIGNGaming = () =>
  fetchAndParseXmlFeed("https://feeds.ign.com/ign/games-all", "IGN Gaming", "Gaming", "global", ["Games"]);

const fetchGameKVN = () =>
  fetchAndParseXmlFeed("https://gamek.vn/home.rss", "GameK VN", "Gaming", "vn", ["Vietnam"]);

// === Science ===
const fetchScienceMagazine = () =>
  fetchAndParseXmlFeed("https://www.sciencemag.org/rss/news_current.xml", "Science Magazine", "Science", "global", ["Science"]);

const fetchNewScientist = () =>
  fetchAndParseXmlFeed("https://www.newscientist.com/feed/home/", "New Scientist", "Science", "global", ["Science"]);

const fetchNatureNews = () =>
  fetchAndParseXmlFeed("https://www.nature.com/nature/articles?type=news-and-comment&format=rss", "Nature News", "Science", "global", ["Nature", "Science"]);

// === Finance ===
const fetchYahooFinance = () =>
  fetchAndParseXmlFeed("https://finance.yahoo.com/news/rss", "Yahoo Finance", "Finance", "global", ["Markets"]);

const fetchCNBCFinance = () =>
  fetchAndParseXmlFeed("https://www.cnbc.com/id/10000664/device/rss/rss.html", "CNBC Finance", "Finance", "us", ["Markets", "USA"]);

const fetchBloombergMarkets = () =>
  fetchAndParseXmlFeed("https://www.bloomberg.com/feeds/bview/", "Bloomberg Markets", "Finance", "global", ["Markets"]);

const fetchCafeF = () =>
  fetchAndParseXmlFeed("https://cafef.vn/trang-chu.rss", "CafeF", "Finance", "vn", ["Vietnam"]);

// === Music ===
const fetchAppleMusicMostPlayedVN = () =>
  fetchJsonFeed("https://rss.applemarketingtools.com/api/v2/vn/music/most-played/100/songs.json", "Apple Music Most Played VN", "Music", "vn", ["AppleMusic", "Vietnam"]);

const fetchAppleMusicTopAlbumsVN = () =>
  fetchJsonFeed("https://rss.applemarketingtools.com/api/v2/vn/music/top-albums/100/albums.json", "Apple Music Top Albums VN", "Music", "vn", ["AppleMusic", "Vietnam"]);

const fetchPitchforkMusicNews = () =>
  fetchAndParseXmlFeed("https://pitchfork.com/feed/feed-news/rss", "Pitchfork Music News", "Music", "global", ["Music"]);

const fetchRollingStone = () =>
  fetchAndParseXmlFeed("https://www.rollingstone.com/music/music-news/feed/", "Rolling Stone Music", "Music", "global", ["Music", "Entertainment"]);

// === Entertainment ===
const fetchVariety = () =>
  fetchAndParseXmlFeed("https://variety.com/feed/", "Variety", "Entertainment", "global", ["Hollywood"]);

const fetchDeadline = () =>
  fetchAndParseXmlFeed("https://deadline.com/feed/", "Deadline", "Entertainment", "us", ["Hollywood", "USA"]);

const fetchZingNewsEntertainment = () =>
  fetchAndParseXmlFeed("https://zingnews.vn/rss/giai-tri.rss", "ZingNews Entertainment", "Entertainment", "vn", ["Vietnam"]);

// === Sports ===
const fetchESPN = () =>
  fetchAndParseXmlFeed("https://www.espn.com/espn/rss/news", "ESPN", "Sports", "us", ["WorldSports", "USA"]);

const fetchSkySportsNews = () =>
  fetchAndParseXmlFeed("https://www.skysports.com/rss/12040", "Sky Sports News", "Sports", "global", ["Sports"]);

// === Logistics ===
const fetchTransportTopics = () =>
  fetchAndParseXmlFeed("https://www.freightwaves.com/feed", "FreightWaves Logistics", "Logistics", "global", ["SupplyChain"]);

// === Cybersecurity ===
const fetchKrebsOnSecurity = () =>
  fetchAndParseXmlFeed("https://krebsonsecurity.com/feed/", "Krebs on Security", "Cybersecurity", "global", ["Security"]);

// === Healthcare ===
const fetchMedicalNewsToday = () =>
  fetchAndParseXmlFeed("https://www.medicalnewstoday.com/rss", "Medical News Today", "Healthcare", "global", ["Health"]);

const fetchWebMDNews = () =>
  fetchAndParseXmlFeed("https://rssfeeds.webmd.com/rss/rss.aspx?rssSource=RSS_PUBLIC", "WebMD News", "Healthcare", "global", ["Health"]);

// === Education ===
const fetchEdSurge = () =>
  fetchAndParseXmlFeed("https://www.edsurge.com/research.rss", "EdSurge", "Education", "us", ["Education", "USA"]);

// === Environment ===
const fetchNatGeoEnvironment = () =>
  fetchAndParseXmlFeed("https://www.nationalgeographic.com/environment/rss/", "National Geographic Environment", "Environment", "global", ["Climate"]);

// === Travel ===
const fetchCondeNastTraveler = () =>
  fetchAndParseXmlFeed("https://www.cntraveler.com/feed/rss", "Conde Nast Traveler", "Travel", "global", ["Tourism"]);

// === Toys ===
const fetchToyNews = () =>
  fetchAndParseXmlFeed("https://toyworldmag.co.uk/feed/", "Toy World Magazine", "Toys", "global", ["Toys"]);

// === Fashion / Beauty ===
const fetchSneakerNews = () =>
  fetchAndParseXmlFeed("https://sneakernews.com/feed/", "Sneaker News", "Fashion", "global", ["Shoes", "Fashion"]);

const fetchAllureRSSHub = () =>
  fetchAndParseXmlFeed("https://rsshub.app/allure/all", "Allure Beauty (via RSSHub)", "Beauty", "global", ["Beauty"]);

const fetchVogueWorld = () =>
  fetchAndParseXmlFeed("https://www.vogue.com/feed/rss", "Vogue World", "Fashion/Beauty", "global", ["Vogue"]);

const fetchElle = () =>
  fetchAndParseXmlFeed("https://www.elle.com/rss/all.xml", "Elle", "Fashion", "global", ["Fashion"]);

const fetchElleVN = () =>
  fetchAndParseXmlFeed("https://www.elle.vn/feed", "Elle Vietnam", "Fashion", "vn", ["Fashion", "Vietnam"]);

const fetchGQGlobal = () =>
  fetchAndParseXmlFeed("https://www.gq-magazine.co.uk/rss", "GQ Global", "Fashion", "global", ["Fashion"]);

const fetchHypebeast = () =>
  fetchAndParseXmlFeed("https://hypebeast.com/feed", "Hypebeast", "Fashion", "global", ["Fashion", "Streetwear"]);

const fetchHighsnobiety = () =>
  fetchAndParseXmlFeed("https://www.highsnobiety.com/feed", "Highsnobiety", "Fashion", "global", ["Fashion", "Streetwear"]);

const fetchRefinery29Global = () =>
  fetchAndParseXmlFeed("https://www.refinery29.com/en-us/feed", "Refinery29", "Lifestyle", "global", ["Lifestyle"]);

const fetchAfamily = () =>
  fetchAndParseXmlFeed("https://afamily.vn/rss/home.rss", "Afamily", "Lifestyle", "vn", ["Vietnam"]);

const fetchWMagazine = () =>
  fetchAndParseXmlFeed("https://www.wmagazine.com/feed/rss", "W Magazine", "Fashion", "global", ["Fashion"]);

// === Parenting ===
const fetchMotherly = () =>
  fetchAndParseXmlFeed("https://www.mother.ly/feed/", "Motherly", "Parenting", "global", ["Family", "Parenting"]);

// === Food ===
const fetchBonAppetit = () =>
  fetchAndParseXmlFeed("https://www.bonappetit.com/feed/rss", "Bon Appetit", "Food", "global", ["Food"]);

const fetchEater = () =>
  fetchAndParseXmlFeed("https://www.eater.com/rss/index.xml", "Eater", "Food", "global", ["Food"]);

// === Cars ===
const fetchCarDriver = () =>
  fetchAndParseXmlFeed("https://www.caranddriver.com/rss/all.xml/", "Car and Driver", "Cars", "global", ["Cars"]);

const fetchAutoBlog = () =>
  fetchAndParseXmlFeed("https://www.autoblog.com/rss.xml", "Autoblog", "Cars", "global", ["Cars"]);

// === Archaeology ===
const fetchArchaeologyMagazine = () =>
  fetchAndParseXmlFeed("https://www.archaeology.org/rss.xml", "Archaeology Magazine", "Archaeology", "global", ["Archaeology"]);

const fetchAncientOrigins = () =>
  fetchAndParseXmlFeed("https://www.ancient-origins.net/rss.xml", "Ancient Origins", "Archaeology", "global", ["History", "Archaeology"]);

const fetchSmithsonianArchaeology = () =>
  fetchAndParseXmlFeed("https://www.smithsonianmag.com/rss/archaeology/", "Smithsonian Archaeology", "Archaeology", "global", ["Archaeology"]);

// === News / Politics ===
const fetchGoogleNewsVN = () =>
  fetchAndParseXmlFeed("https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi", "Google News VN", "News", "vn", ["Vietnam"]);

const fetchBBCWorld = () =>
  fetchAndParseXmlFeed("http://feeds.bbci.co.uk/news/world/rss.xml", "BBC World", "News", "global", ["WorldNews"]);

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
  fetchHackerNewsFrontpage(), fetchTheVerge(), fetchWired(), fetchTechCrunch(),
  fetchVentureBeatAI(), fetchIGNGaming(), fetchGameKVN(),
  fetchScienceMagazine(), fetchNewScientist(), fetchNatureNews(),
  fetchYahooFinance(), fetchCNBCFinance(), fetchBloombergMarkets(), fetchCafeF(),
  fetchAppleMusicMostPlayedVN(), fetchAppleMusicTopAlbumsVN(),
  fetchPitchforkMusicNews(), fetchRollingStone(),
  fetchVariety(), fetchDeadline(), fetchZingNewsEntertainment(),
  fetchESPN(), fetchSkySportsNews(),
  fetchTransportTopics(),
  fetchKrebsOnSecurity(),
  fetchMedicalNewsToday(), fetchWebMDNews(),
  fetchEdSurge(),
  fetchNatGeoEnvironment(),
  fetchCondeNastTraveler(),
  fetchToyNews(),
  fetchSneakerNews(), fetchAllureRSSHub(), fetchVogueWorld(),
  fetchElle(), fetchElleVN(), fetchGQGlobal(), fetchHypebeast(), fetchHighsnobiety(),
  fetchRefinery29Global(), fetchAfamily(), fetchWMagazine(),
  fetchMotherly(),
  fetchBonAppetit(), fetchEater(),
  fetchCarDriver(), fetchAutoBlog(),
  fetchArchaeologyMagazine(), fetchAncientOrigins(), fetchSmithsonianArchaeology(),
  fetchGoogleNewsVN(), fetchBBCWorld()
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

    // Đảm bảo id là duy nhất và loại bỏ các trend trùng lặp dựa trên id
    const uniqueTrendsMap = new Map();
    for (const trend of allFetchedTrends) {
        if (trend.id) {
            uniqueTrendsMap.set(trend.id, trend);
        }
    }
    allFetchedTrends = Array.from(uniqueTrendsMap.values());


    if (allFetchedTrends.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, trends: [], message: "No trends found from any source." }),
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
        (t.tags && t.tags.some(tag => tag.toLowerCase().includes(termLower)))
      );
    }
    if (hashtag) {
      const hashtagLower = hashtag.toLowerCase();
      filteredTrends = filteredTrends.filter(t =>
        t.tags && t.tags.some(tag => tag.toLowerCase() === hashtagLower)
      );
    }

    // Sort by newest first (descending sortKey) and then map to final format with IDs
    filteredTrends = filteredTrends
      .filter(Boolean) // Ensure no null/undefined items sneak through
      .sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0)); // No longer mapping to assign i+1 as ID

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
