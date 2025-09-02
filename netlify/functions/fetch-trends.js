// File: netlify/functions/fetch-trends.js
const fetch = require("node-fetch");
const { XMLParser } = require("fast-xml-parser");

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
  return dt && !isNaN(dt.getTime()) ? dt.getTime() : 0; // <<<<<<<<<<<<<<<<< SỬA LỖI Ở ĐÂY
}

// ===== Trend Factory (Standardizes item data from various feed types) =====
function createStandardTrend(item, sourceName, defaultCategory = "General", defaultRegion = "global", extraTags = []) {
  // Use getSafeString for all fields to handle different XML/JSON structures and ensure string output
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

  return {
    title_en: cleanedTitle,
    description_en: cleanedDescription,
    title_vi: cleanedTitle,
    description_vi: cleanedDescription,
    category: defaultCategory,
    tags: [...new Set([...extraTags, sourceName.replace(/\s/g, "") || "Unknown", defaultRegion || "global"].filter(Boolean))],
    votes: Math.floor(Math.random() * 1000) + 500, // <<<<<<<<<<<<<<<<< TĂNG PHẠM VI VOTES (500-1499)
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

        return rawItems.map(item => createStandardTrend(item, sourceName, defaultCategory, defaultRegion, extraTags)); // Use createStandardTrend for JSON too
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

// AI
const fetchVentureBeatAI = () =>
  fetchAndParseXmlFeed("https://venturebeat.com/feed", "VentureBeat AI", "AI", "global", ["VentureBeat"]); 

const fetchMITTech = () =>
  fetchAndParseXmlFeed("https://www.technologyreview.com/feed/tag/artificial-intelligence/", "MIT Tech Review", "AI", "global", ["MITTechReview"]); // Use specific AI tag feed

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

// Politics
const fetchPolitics = () =>
  fetchAndParseXmlFeed("https://www.politico.com/rss/politics.xml", "Politico", "Politics", "us", ["USA"]); 

// Finance
const fetchYahooFinance = () =>
  fetchAndParseXmlFeed("https://finance.yahoo.com/news/rss", "Yahoo Finance", "Finance", "global", ["Markets"]);

const fetchCNBCFinance = () =>
  fetchAndParseXmlFeed("https://www.cnbc.com/id/10000664/device/rss/rss.html", "CNBC Finance", "Finance", "us", ["Markets", "USA"]);

const fetchCafeF = () => 
  fetchAndParseXmlFeed("https://cafef.vn/trang-chu.rss", "CafeF", "Finance", "vn");

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
  fetchAndParseXmlFeed("https://www.supplychaindigital.com/rss", "Supply Chain Digital", "Logistics", "global", ["SupplyChain"]); // Using the general RSS if specific /rss-feeds/all doesn't work well

// Cybersecurity
const fetchCybernews = () =>
  fetchAndParseXmlFeed("https://cybernews.com/feed/", "Cybernews", "Cybersecurity", "global", ["Security"]); // Using the site's own feed

// Healthcare
const fetchHealthcare = () =>
  fetchAndParseXmlFeed("https://www.medicalnewstoday.com/rss", "Medical News Today", "Healthcare", "global", ["Health"]); // Using the general site RSS feed

// Education
const fetchEducation = () =>
  fetchAndParseXmlFeed("https://www.chronicle.com/feed", "The Chronicle of Higher Education", "Education", "us", ["USA"]);

// Environment
const fetchEnvironment = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/environment/rss", "The Guardian Environment", "Environment", "global", ["Climate"]); 

// Travel
const fetchTravel = () =>
  fetchAndParseXmlFeed("https://www.lonelyplanet.com/news/rss", "Lonely Planet", "Travel", "global", ["Tourism"]); 

const fetchToyNews = () =>
  fetchAndParseXmlFeed("https://toynewsi.com/rss.php", "Toy News International", "Toys", "global", ["Toys"]);

const fetchSneakerNews = () =>
  fetchAndParseXmlFeed("https://sneakernews.com/feed/", "Sneaker News", "Sneakers", "global", ["Shoes", "Fashion"]);

const fetchAllureBeauty = () =>
  fetchAndParseXmlFeed("https://www.allure.com/feed/all", "Allure Beauty", "Beauty", "global", ["Beauty", "Cosmetics"]);

//Beauty
const fetchVogueBeauty = () =>
  fetchAndParseXmlFeed("https://www.vogue.com/rss/beauty", "Vogue Beauty", "Beauty", "global", ["Beauty", "Cosmetics"]);

const fetchElle = () => 
  fetchAndParseXmlFeed("https://www.elle.com/rss/all.xml", "Elle", "Fashion", "global");

function fetchElleVN = () => fetchAndParseXmlFeed("https://www.elle.vn/feed", "ELLE Vietnam Fashion", "Fashion", "vn"); }

const fetchGQ = () => 
  fetchAndParseXmlFeed("https://www.gq.com/feed/rss", "GQ", "Fashion", "global");

const fetchHypebeast = () => 
  fetchAndParseXmlFeed("https://hypebeast.com/feed", "Hypebeast", "Fashion", "global");

const fetchHighsnobiety = () => 
  fetchAndParseXmlFeed("https://www.highsnobiety.com/feed", "Highsnobiety", "Fashion", "global");


const fetchRefinery29 = () =>
  fetchAndParseXmlFeed("https://www.refinery29.com/en-us/feed", "Refinery29", "Lifestyle", "global", ["Lifestyle"]);

const fetchParents = () =>
  fetchAndParseXmlFeed("https://www.parents.com/rss/", "Parents.com", "Family", "global", ["Parenting", "Family"]);

const fetchAfamily = () => fetchAndParseXmlFeed("https://afamily.vn/rss/home.rss", "Afamily", "Lifestyle", "vn");

// Food & Drink
const fetchFoodWine = () => fetchAndParseXmlFeed("https://www.foodandwine.com/rss", "Food & Wine", "Food", "global");
const fetchEater = () => fetchAndParseXmlFeed("https://www.eater.com/rss/index.xml", "Eater", "Food", "global");
const fetchSeriousEats = () => fetchAndParseXmlFeed("https://www.seriouseats.com/rss", "Serious Eats", "Food", "global");

// Cars
const fetchCarDriver = () => fetchAndParseXmlFeed("https://www.caranddriver.com/rss/all.xml/", "Car and Driver", "Cars", "global");
const fetchTopGear = () => fetchAndParseXmlFeed("https://www.topgear.com/feeds/all/rss.xml", "Top Gear", "Cars", "global");

//Archaeology
const fetchArchaeologyMagazine = () => fetchAndParseXmlFeed("https://www.archaeology.org/rss.xml", "Archaeology Magazine", "Archaeology", "global", ["History", "Archaeology"]);
const fetchHeritageDaily = () => fetchAndParseXmlFeed("https://www.heritagedaily.com/category/archaeology/feed", "Heritage Daily Archaeology", "Archaeology", "global", ["History", "Archaeology"]);
const fetchSmithsonianArchaeology = () => fetchAndParseXmlFeed("https://www.smithsonianmag.com/rss/archaeology/", "Smithsonian Archaeology", "Archaeology", "global", ["History", "Archaeology"]);

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
      fetchYahooFinance(), fetchCNBCFinance(), fetchCafeF(), fetchScienceMagazine(),
      fetchNewScientist(), fetchAppleMusicMostPlayedVN(), fetchAppleMusicNewReleasesVN(),
      fetchYouTubeTrendingVN(), fetchVariety(), fetchDeadline(),
      fetchGameKVN(), fetchZingNewsEntertainment(), fetchBBCWorld(),
      fetchESPN(), fetchLogistics(), fetchCybernews(),
      fetchHealthcare(), fetchEducation(), fetchEnvironment(),
      fetchPolitics(), fetchTravel(),
      fetchToyNews(),
      fetchSneakerNews(),
      fetchAllureBeauty(),
      fetchVogueBeauty(), fetchElle(), fetchElleVN(), fetchGQ(), fetchHypebeast(), fetchHighsnobiety(),
      fetchRefinery29(), fetchAfamily(),
      fetchParents(),
      fetchFoodWine(), fetchEater(), fetchSeriousEats(),
      fetchCarDriver(), fetchTopGear(),
      fetchArchaeologyMagazine(), fetchHeritageDaily(), fetchSmithsonianArchaeology(),
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
