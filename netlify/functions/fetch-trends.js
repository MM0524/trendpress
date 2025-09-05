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

// === Technology & AI ===
const fetchHackerNewsFrontpage = () =>
  fetchAndParseXmlFeed("https://hnrss.org/frontpage", "Hacker News", "Technology", "global", ["HackerNews", "Tech"]);

const fetchTheVerge = () =>
  fetchAndParseXmlFeed("https://www.theverge.com/rss/index.xml", "The Verge", "Technology", "global", ["Tech"]);

const fetchVentureBeatAI = () =>
  fetchAndParseXmlFeed("https://venturebeat.com/feed", "VentureBeat AI", "AI", "global", ["AI", "Tech"]);

const fetchMITTech = () =>
  fetchAndParseXmlFeed("https://www.technologyreview.com/feed/", "MIT Tech Review", "AI", "global", ["AI", "Tech"]);

const fetchWired = () =>
  fetchAndParseXmlFeed("https://www.wired.com/feed/rss", "Wired", "Technology", "global", ["Tech"]);

const fetchTechCrunch = () =>
  fetchAndParseXmlFeed("https://techcrunch.com/feed/", "TechCrunch", "Technology", "global", ["Tech"]);

const fetchNatureAI = () =>
  fetchAndParseXmlFeed("https://www.nature.com/subjects/machine-learning/rss", "Nature AI", "AI", "global", ["AI", "Science"]);

const fetchArsTechnica = () =>
  fetchAndParseXmlFeed("http://feeds.arstechnica.com/arstechnica/index/", "Ars Technica", "Technology", "global", ["Tech"]);

const fetchEngadget = () =>
  fetchAndParseXmlFeed("https://www.engadget.com/rss.xml", "Engadget", "Technology", "global", ["Tech"]);

const fetchSlashdot = () =>
  fetchAndParseXmlFeed("http://rss.slashdot.org/Slashdot/slashdotMain", "Slashdot", "Technology", "global", ["Tech"]);

const fetchCNET = () =>
  fetchAndParseXmlFeed("https://www.cnet.com/rss/news/", "CNET", "Technology", "global", ["Tech"]);


// === Gaming ===
const fetchIGNGaming = () =>
  fetchAndParseXmlFeed("https://feeds.ign.com/ign/games-all", "IGN Gaming", "Gaming", "global", ["Gaming"]);

const fetchGameKVN = () =>
  fetchAndParseXmlFeed("https://gamek.vn/home.rss", "GameK VN", "Gaming", "vn", ["Vietnam"]);

const fetchKotaku = () =>
  fetchAndParseXmlFeed("https://kotaku.com/rss", "Kotaku", "Gaming", "global", ["Gaming"]);

const fetchPCGamer = () =>
  fetchAndParseXmlFeed("https://www.pcgamer.com/rss/", "PC Gamer", "Gaming", "global", ["Gaming"]);

const fetchGamespot = () =>
  fetchAndParseXmlFeed("https://www.gamespot.com/feeds/mashup/", "GameSpot", "Gaming", "global", ["Gaming"]);

const fetchEurogamer = () =>
  fetchAndParseXmlFeed("https://www.eurogamer.net/feed", "Eurogamer", "Gaming", "global", ["Gaming"]);

const fetchPolygon = () =>
  fetchAndParseXmlFeed("https://www.polygon.com/rss/index.xml", "Polygon", "Gaming", "global", ["Gaming"]);


// === News / Politics ===
const fetchGoogleNewsVN = () =>
  fetchAndParseXmlFeed("https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi", "Google News VN", "News", "vn", ["Vietnam"]);

const fetchBBCWorld = () =>
  fetchAndParseXmlFeed("http://feeds.bbci.co.uk/news/world/rss.xml", "BBC World", "News", "global", ["World"]);

const fetchPolitics = () =>
  fetchAndParseXmlFeed("https://www.politico.com/rss/politics.xml", "Politico", "Politics", "us", ["Politics"]);

const fetchGuardianWorld = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/world/rss", "The Guardian World", "News", "global", ["World"]);

const fetchNYTimesWorld = () =>
  fetchAndParseXmlFeed("https://rss.nytimes.com/services/xml/rss/nyt/World.xml", "NYTimes World", "News", "us", ["World", "USA"]);

const fetchAlJazeera = () =>
  fetchAndParseXmlFeed("https://www.aljazeera.com/xml/rss/all.xml", "Al Jazeera", "News", "global", ["World"]);

const fetchReutersWorld = () =>
  fetchAndParseXmlFeed("http://feeds.reuters.com/Reuters/worldNews", "Reuters World", "News", "global", ["World"]);

const fetchAssociatedPress = () =>
  fetchAndParseXmlFeed("https://apnews.com/apf-topnews?format=atom", "AP News", "News", "us", ["World", "USA"]);


// === Finance ===
const fetchYahooFinance = () =>
  fetchAndParseXmlFeed("https://finance.yahoo.com/news/rss", "Yahoo Finance", "Finance", "global", ["Finance"]);

const fetchCNBCFinance = () =>
  fetchAndParseXmlFeed("https://www.cnbc.com/id/10000664/device/rss/rss.html", "CNBC Finance", "Finance", "us", ["Finance"]);

const fetchCafeF = () =>
  fetchAndParseXmlFeed("https://cafef.vn/trang-chu.rss", "CafeF", "Finance", "vn", ["Vietnam"]);

const fetchBloomberg = () =>
  fetchAndParseXmlFeed("https://www.bloomberg.com/feed/podcast", "Bloomberg", "Finance", "global", ["Finance"]);

const fetchFinancialTimes = () =>
  fetchAndParseXmlFeed("https://www.ft.com/rss/home", "Financial Times", "Finance", "global", ["Finance"]);

const fetchMarketWatch = () =>
  fetchAndParseXmlFeed("https://www.marketwatch.com/rss/topstories", "MarketWatch", "Finance", "us", ["Finance"]);

const fetchWSJ = () =>
  fetchAndParseXmlFeed("https://feeds.a.dj.com/rss/RSSWorldNews.xml", "Wall Street Journal", "Finance", "us", ["Finance"]);

const fetchForbes = () =>
  fetchAndParseXmlFeed("https://www.forbes.com/most-popular/feed/", "Forbes", "Finance", "global", ["Finance"]);


// === Science ===
const fetchScienceMagazine = () =>
  fetchAndParseXmlFeed("https://www.sciencemag.org/rss/news_current.xml", "Science Magazine", "Science", "global", ["Science"]);

const fetchNewScientist = () =>
  fetchAndParseXmlFeed("https://www.newscientist.com/feed/home/", "New Scientist", "Science", "global", ["Science"]);

const fetchNature = () =>
  fetchAndParseXmlFeed("https://www.nature.com/subjects/science/rss", "Nature", "Science", "global", ["Science"]);

const fetchNationalGeographic = () =>
  fetchAndParseXmlFeed("http://feeds.nationalgeographic.com/ng/News/News_Main", "National Geographic", "Science", "global", ["Science"]);

const fetchScientificAmerican = () =>
  fetchAndParseXmlFeed("https://www.scientificamerican.com/feed/rss/", "Scientific American", "Science", "global", ["Science"]);

const fetchLiveScience = () =>
  fetchAndParseXmlFeed("https://www.livescience.com/feeds/all", "Live Science", "Science", "global", ["Science"]);

const fetchNASA = () =>
  fetchAndParseXmlFeed("https://www.nasa.gov/rss/dyn/breaking_news.rss", "NASA", "Science", "us", ["Space"]);


// === Music ===
const fetchAppleMusicMostPlayedVN = () =>
  fetchJsonFeed("https://rss.applemarketingtools.com/api/v2/vn/music/most-played/100/songs.json", "Apple Music Most Played VN", "Music", "vn", ["Music"]);

const fetchAppleMusicNewReleasesVN = () =>
  fetchJsonFeed("https://rss.applemarketingtools.com/api/v2/vn/music/new-releases/100/albums.json", "Apple Music New Releases VN", "Music", "vn", ["Music"]);

const fetchBillboard = () =>
  fetchAndParseXmlFeed("https://www.billboard.com/feed/", "Billboard", "Music", "us", ["Music"]);

const fetchPitchfork = () =>
  fetchAndParseXmlFeed("https://pitchfork.com/rss/news/", "Pitchfork", "Music", "global", ["Music"]);

const fetchRollingStoneMusic = () =>
  fetchAndParseXmlFeed("https://www.rollingstone.com/music/music-news/feed/", "Rolling Stone Music", "Music", "global", ["Music"]);

const fetchNME = () =>
  fetchAndParseXmlFeed("https://www.nme.com/feed", "NME", "Music", "global", ["Music"]);

const fetchSpin = () =>
  fetchAndParseXmlFeed("https://www.spin.com/feed/", "SPIN", "Music", "global", ["Music"]);


// === Media / Entertainment ===
const fetchYouTubeTrendingVN = () =>
  fetchAndParseXmlFeed("https://rsshub.app/youtube/trending/region/VN", "YouTube Trending VN", "Entertainment", "vn", ["YouTube", "Vietnam"]);

const fetchVariety = () =>
  fetchAndParseXmlFeed("https://variety.com/feed/", "Variety", "Entertainment", "us", ["Hollywood"]);

const fetchDeadline = () =>
  fetchAndParseXmlFeed("https://deadline.com/feed/", "Deadline", "Entertainment", "us", ["Hollywood"]);

const fetchZingNewsEntertainment = () =>
  fetchAndParseXmlFeed("https://zingnews.vn/rss/giai-tri.rss", "ZingNews Entertainment", "Entertainment", "vn", ["Vietnam"]);

const fetchHollywoodReporter = () =>
  fetchAndParseXmlFeed("https://www.hollywoodreporter.com/feed/", "Hollywood Reporter", "Entertainment", "us", ["Hollywood"]);

const fetchRollingStone = () =>
  fetchAndParseXmlFeed("https://www.rollingstone.com/culture/culture-news/feed/", "Rolling Stone Entertainment", "Entertainment", "global", ["Entertainment"]);

const fetchEntertainmentWeekly = () =>
  fetchAndParseXmlFeed("https://ew.com/feed", "Entertainment Weekly", "Entertainment", "us", ["Hollywood"]);

const fetchBuzzFeedEntertainment = () =>
  fetchAndParseXmlFeed("https://www.buzzfeed.com/entertainment.xml", "BuzzFeed Entertainment", "Entertainment", "global", ["Entertainment"]);


// === Sports ===
const fetchESPN = () =>
  fetchAndParseXmlFeed("https://www.espn.com/espn/rss/news", "ESPN", "Sports", "us", ["Sports"]);

const fetchSkySports = () =>
  fetchAndParseXmlFeed("https://www.skysports.com/rss/12040", "Sky Sports", "Sports", "global", ["Sports"]);

const fetchFifa = () =>
  fetchAndParseXmlFeed("https://www.fifa.com/rss-feeds/news", "FIFA", "Sports", "global", ["Football"]);

const fetchBBCSport = () =>
  fetchAndParseXmlFeed("http://feeds.bbci.co.uk/sport/rss.xml", "BBC Sport", "Sports", "global", ["Sports"]);

const fetchBleacherReport = () =>
  fetchAndParseXmlFeed("http://feeds.feedburner.com/bleacherreport/dpIh", "Bleacher Report", "Sports", "global", ["Sports"]);

const fetchNBA = () =>
  fetchAndParseXmlFeed("https://www.nba.com/rss/nba_rss.xml", "NBA", "Sports", "us", ["Basketball"]);

const fetchNFL = () =>
  fetchAndParseXmlFeed("http://www.nfl.com/rss/rsslanding?searchString=home", "NFL", "Sports", "us", ["Football"]);


// === Logistics / Business ===
const fetchLogistics = () =>
  fetchAndParseXmlFeed("https://www.supplychaindigital.com/rss", "Supply Chain Digital", "Logistics", "global", ["Business"]);

const fetchWSJBusiness = () =>
  fetchAndParseXmlFeed("https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml", "Wall Street Journal Business", "Business", "us", ["Business"]);

const fetchReutersBusiness = () =>
  fetchAndParseXmlFeed("http://feeds.reuters.com/reuters/businessNews", "Reuters Business", "Business", "global", ["Business"]);

const fetchSupplyChainDive = () =>
  fetchAndParseXmlFeed("https://www.supplychaindive.com/feeds/news/", "Supply Chain Dive", "Logistics", "global", ["Business"]);

const fetchTransportTopics = () =>
  fetchAndParseXmlFeed("https://www.ttnews.com/rss", "Transport Topics", "Logistics", "us", ["Business"]);


// === Cybersecurity ===
const fetchCybernews = () =>
  fetchAndParseXmlFeed("https://cybernews.com/feed/", "Cybernews", "Cybersecurity", "global", ["Security"]);

const fetchKrebsSecurity = () =>
  fetchAndParseXmlFeed("https://krebsonsecurity.com/feed/", "Krebs on Security", "Cybersecurity", "global", ["Security"]);

const fetchDarkReading = () =>
  fetchAndParseXmlFeed("https://www.darkreading.com/rss.xml", "Dark Reading", "Cybersecurity", "global", ["Security"]);

const fetchThreatPost = () =>
  fetchAndParseXmlFeed("https://threatpost.com/feed/", "ThreatPost", "Cybersecurity", "global", ["Security"]);

const fetchSecurityWeek = () =>
  fetchAndParseXmlFeed("https://feeds.feedburner.com/securityweek", "SecurityWeek", "Cybersecurity", "global", ["Security"]);


// === Healthcare ===
const fetchHealthcare = () =>
  fetchAndParseXmlFeed("https://www.medicalnewstoday.com/rss", "Medical News Today", "Healthcare", "global", ["Health"]);

const fetchWHO = () =>
  fetchAndParseXmlFeed("https://www.who.int/feeds/entity/mediacentre/news/en/rss.xml", "World Health Organization", "Healthcare", "global", ["Health"]);

const fetchHealthline = () =>
  fetchAndParseXmlFeed("https://www.healthline.com/rss", "Healthline", "Healthcare", "global", ["Health"]);

const fetchWebMD = () =>
  fetchAndParseXmlFeed("https://rssfeeds.webmd.com/rss/rss.aspx?rssSource=RSS_PUBLIC", "WebMD", "Healthcare", "global", ["Health"]);

const fetchMayoClinic = () =>
  fetchAndParseXmlFeed("https://newsnetwork.mayoclinic.org/feed/", "Mayo Clinic", "Healthcare", "us", ["Health"]);


// === Education ===
const fetchEducation = () =>
  fetchAndParseXmlFeed("https://www.chronicle.com/feed", "The Chronicle of Higher Education", "Education", "us", ["Education"]);

const fetchEdWeek = () =>
  fetchAndParseXmlFeed("https://feeds.edweek.org/edweek/educationweek", "Education Week", "Education", "us", ["Education"]);

const fetchTimesHigherEducation = () =>
  fetchAndParseXmlFeed("https://www.timeshighereducation.com/rss", "Times Higher Education", "Education", "global", ["Education"]);

const fetchInsideHigherEd = () =>
  fetchAndParseXmlFeed("https://www.insidehighered.com/rss", "Inside Higher Ed", "Education", "us", ["Education"]);


// === Environment ===
const fetchEnvironment = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/environment/rss", "The Guardian Environment", "Environment", "global", ["Environment"]);

const fetchUNEnvironment = () =>
  fetchAndParseXmlFeed("https://www.unep.org/rss.xml", "UN Environment", "Environment", "global", ["Environment"]);

const fetchNatGeoEnvironment = () =>
  fetchAndParseXmlFeed("http://feeds.nationalgeographic.com/ng/environment", "National Geographic Environment", "Environment", "global", ["Environment"]);

const fetchMongabay = () =>
  fetchAndParseXmlFeed("https://news.mongabay.com/feed/", "Mongabay", "Environment", "global", ["Environment"]);

const fetchYaleEnvironment360 = () =>
  fetchAndParseXmlFeed("https://e360.yale.edu/feed", "Yale Environment 360", "Environment", "global", ["Environment"]);


// === Travel ===
const fetchTravel = () =>
  fetchAndParseXmlFeed("https://www.lonelyplanet.com/news/rss", "Lonely Planet", "Travel", "global", ["Travel"]);

const fetchCNTraveler = () =>
  fetchAndParseXmlFeed("https://www.cntraveler.com/feed/rss", "Condé Nast Traveler", "Travel", "global", ["Travel"]);

const fetchTravelWeekly = () =>
  fetchAndParseXmlFeed("https://www.travelweekly.com/rss", "Travel Weekly", "Travel", "global", ["Travel"]);

const fetchNationalGeographicTravel = () =>
  fetchAndParseXmlFeed("http://feeds.nationalgeographic.com/ng/travel", "National Geographic Travel", "Travel", "global", ["Travel"]);

const fetchLonelyPlanetTravelTips = () =>
  fetchAndParseXmlFeed("https://www.lonelyplanet.com/feed", "Lonely Planet Travel Tips", "Travel", "global", ["Travel"]);


// === Toys ===
const fetchToyNews = () =>
  fetchAndParseXmlFeed("https://toynewsi.com/rss.php", "Toy News International", "Toys", "global", ["Toys"]);

const fetchToyWorldMag = () =>
  fetchAndParseXmlFeed("https://www.toyworldmag.co.uk/feed/", "Toy World Magazine", "Toys", "global", ["Toys"]);

const fetchKidscreen = () =>
  fetchAndParseXmlFeed("https://kidscreen.com/feed/", "Kidscreen", "Toys", "global", ["Toys"]);

const fetchLicensingSource = () =>
  fetchAndParseXmlFeed("https://www.licensingsource.net/feed/", "Licensing Source", "Toys", "global", ["Toys"]);


// === Fashion / Beauty ===
const fetchSneakerNews = () =>
  fetchAndParseXmlFeed("https://sneakernews.com/feed/", "Sneaker News", "Fashion", "global", ["Fashion"]);

const fetchAllureBeauty = () =>
  fetchAndParseXmlFeed("https://www.allure.com/feed/all", "Allure Beauty", "Beauty", "global", ["Beauty"]);

const fetchVogueBeauty = () =>
  fetchAndParseXmlFeed("https://www.vogue.com/rss/beauty", "Vogue Beauty", "Beauty", "global", ["Beauty"]);

const fetchElle = () =>
  fetchAndParseXmlFeed("https://www.elle.com/rss/all.xml", "Elle", "Fashion", "global", ["Fashion"]);

const fetchElleVN = () =>
  fetchAndParseXmlFeed("https://www.elle.vn/feed", "Elle Vietnam", "Fashion", "vn", ["Fashion"]);

const fetchGQ = () =>
  fetchAndParseXmlFeed("https://www.gq.com/rss", "GQ", "Fashion", "global", ["Fashion"]);

const fetchHypebeast = () =>
  fetchAndParseXmlFeed("https://hypebeast.com/feed", "Hypebeast", "Fashion", "global", ["Fashion"]);

const fetchHighsnobiety = () =>
  fetchAndParseXmlFeed("https://www.highsnobiety.com/feed", "Highsnobiety", "Fashion", "global", ["Fashion"]);

const fetchRefinery29 = () =>
  fetchAndParseXmlFeed("https://www.refinery29.com/rss.xml", "Refinery29", "Fashion", "global", ["Fashion"]);

const fetchCosmopolitan = () =>
  fetchAndParseXmlFeed("https://www.cosmopolitan.com/rss/all.xml", "Cosmopolitan", "Fashion", "global", ["Fashion"]);

const fetchHarperBazaar = () =>
  fetchAndParseXmlFeed("https://www.harpersbazaar.com/rss/all.xml", "Harper's Bazaar", "Fashion", "global", ["Fashion"]);

const fetchWMagazine = () =>
  fetchAndParseXmlFeed("https://www.wmagazine.com/feed/rss", "W Magazine", "Fashion", "global", ["Fashion"]);


// === Lifestyle / Family ===
const fetchAfamily = () =>
  fetchAndParseXmlFeed("https://afamily.vn/home.rss", "Afamily", "Lifestyle", "vn", ["Vietnam"]);

const fetchParents = () =>
  fetchAndParseXmlFeed("https://www.parents.com/rss", "Parents", "Lifestyle", "us", ["Family"]);

const fetchGoodHousekeeping = () =>
  fetchAndParseXmlFeed("https://www.goodhousekeeping.com/rss/all.xml", "Good Housekeeping", "Lifestyle", "global", ["Lifestyle"]);

const fetchOprahMag = () =>
  fetchAndParseXmlFeed("https://www.oprahdaily.com/rss/all.xml", "Oprah Magazine", "Lifestyle", "us", ["Lifestyle"]);


// === Food & Drink ===
const fetchFoodWine = () =>
  fetchAndParseXmlFeed("https://www.foodandwine.com/rss/all.xml", "Food & Wine", "Food", "global", ["Food"]);

const fetchEater = () =>
  fetchAndParseXmlFeed("https://www.eater.com/rss/index.xml", "Eater", "Food", "us", ["Food"]);

const fetchSeriousEats = () =>
  fetchAndParseXmlFeed("https://www.seriouseats.com/rss", "Serious Eats", "Food", "global", ["Food"]);

const fetchBonAppetit = () =>
  fetchAndParseXmlFeed("https://www.bonappetit.com/feed/rss", "Bon Appetit", "Food", "us", ["Food"]);

const fetchSaveur = () =>
  fetchAndParseXmlFeed("https://www.saveur.com/feed/", "Saveur", "Food", "global", ["Food"]);

const fetchDelish = () =>
  fetchAndParseXmlFeed("https://www.delish.com/rss/all.xml", "Delish", "Food", "us", ["Food"]);

const fetchTheKitchn = () =>
  fetchAndParseXmlFeed("https://www.thekitchn.com/rss", "The Kitchn", "Food", "global", ["Food"]);


// === Cars ===
const fetchCarDriver = () =>
  fetchAndParseXmlFeed("https://www.caranddriver.com/rss/all.xml", "Car and Driver", "Cars", "us", ["Cars"]);

const fetchTopGear = () =>
  fetchAndParseXmlFeed("https://www.topgear.com/feeds/news", "Top Gear", "Cars", "global", ["Cars"]);

const fetchMotorTrend = () =>
  fetchAndParseXmlFeed("https://www.motortrend.com/feed/", "MotorTrend", "Cars", "us", ["Cars"]);

const fetchAutoExpress = () =>
  fetchAndParseXmlFeed("https://www.autoexpress.co.uk/rss.xml", "AutoExpress", "Cars", "uk", ["Cars"]);

const fetchRoadAndTrack = () =>
  fetchAndParseXmlFeed("https://www.roadandtrack.com/rss/all.xml", "Road & Track", "Cars", "us", ["Cars"]);


// === Archaeology / History ===
const fetchArchaeologyMagazine = () =>
  fetchAndParseXmlFeed("https://www.archaeology.org/rss", "Archaeology Magazine", "History", "global", ["Archaeology"]);

const fetchHeritageDaily = () =>
  fetchAndParseXmlFeed("https://www.heritagedaily.com/feed", "Heritage Daily", "History", "global", ["History"]);

const fetchSmithsonianArchaeology = () =>
  fetchAndParseXmlFeed("https://www.smithsonianmag.com/rss/history/", "Smithsonian Archaeology", "History", "us", ["History"]);

const fetchAncientOrigins = () =>
  fetchAndParseXmlFeed("https://www.ancient-origins.net/rss.xml", "Ancient Origins", "History", "global", ["Archaeology"]);

const fetchPastHorizons = () =>
  fetchAndParseXmlFeed("http://www.pasthorizonspr.com/index.php/feed", "Past Horizons", "History", "global", ["History"]);

const fetchHistoryExtra = () =>
  fetchAndParseXmlFeed("https://www.historyextra.com/feed/", "History Extra", "History", "uk", ["History"]);

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
  // === Technology & AI ===
  fetchHackerNewsFrontpage(),
  fetchTheVerge(),
  fetchVentureBeatAI(),
  fetchMITTech(),
  fetchWired(),
  fetchTechCrunch(),
  fetchNatureAI(),
  fetchArsTechnica(),
  fetchEngadget(),
  fetchSlashdot(),
  fetchCNET(),

  // === Gaming ===
  fetchIGNGaming(),
  fetchGameKVN(),
  fetchKotaku(),
  fetchPCGamer(),
  fetchGamespot(),
  fetchEurogamer(),
  fetchPolygon(),

  // === News / Politics ===
  fetchGoogleNewsVN(),
  fetchBBCWorld(),
  fetchPolitics(),
  fetchGuardianWorld(),
  fetchNYTimesWorld(),
  fetchAlJazeera(),
  fetchReutersWorld(),
  fetchAssociatedPress(),

  // === Finance ===
  fetchYahooFinance(),
  fetchCNBCFinance(),
  fetchCafeF(),
  fetchBloomberg(),
  fetchFinancialTimes(),
  fetchMarketWatch(),
  fetchWSJ(),
  fetchForbes(),

  // === Science ===
  fetchScienceMagazine(),
  fetchNewScientist(),
  fetchNature(),
  fetchNationalGeographic(),
  fetchScientificAmerican(),
  fetchLiveScience(),
  fetchNASA(),

  // === Music ===
  fetchAppleMusicMostPlayedVN(),
  fetchAppleMusicNewReleasesVN(),
  fetchBillboard(),
  fetchPitchfork(),
  fetchRollingStoneMusic(),
  fetchNME(),
  fetchSpin(),

  // === Media / Entertainment ===
  fetchYouTubeTrendingVN(),
  fetchVariety(),
  fetchDeadline(),
  fetchZingNewsEntertainment(),
  fetchHollywoodReporter(),
  fetchRollingStone(),
  fetchEntertainmentWeekly(),
  fetchBuzzFeedEntertainment(),

  // === Sports ===
  fetchESPN(),
  fetchSkySports(),
  fetchFifa(),
  fetchBBCSport(),
  fetchBleacherReport(),
  fetchNBA(),
  fetchNFL(),

  // === Logistics / Business ===
  fetchLogistics(),
  fetchWSJBusiness(),
  fetchReutersBusiness(),
  fetchSupplyChainDive(),
  fetchTransportTopics(),

  // === Cybersecurity ===
  fetchCybernews(),
  fetchKrebsSecurity(),
  fetchDarkReading(),
  fetchThreatPost(),
  fetchSecurityWeek(),

  // === Healthcare ===
  fetchHealthcare(),
  fetchWHO(),
  fetchHealthline(),
  fetchWebMD(),
  fetchMayoClinic(),

  // === Education ===
  fetchEducation(),
  fetchEdWeek(),
  fetchTimesHigherEducation(),
  fetchInsideHigherEd(),

  // === Environment ===
  fetchEnvironment(),
  fetchUNEnvironment(),
  fetchNatGeoEnvironment(),
  fetchMongabay(),
  fetchYaleEnvironment360(),

  // === Travel ===
  fetchTravel(),
  fetchCNTraveler(),
  fetchTravelWeekly(),
  fetchNationalGeographicTravel(),
  fetchLonelyPlanetTravelTips(),

  // === Toys ===
  fetchToyNews(),
  fetchToyWorldMag(),
  fetchKidscreen(),
  fetchLicensingSource(),

  // === Fashion / Beauty ===
  fetchSneakerNews(),
  fetchAllureBeauty(),
  fetchVogueBeauty(),
  fetchElle(),
  fetchElleVN(),
  fetchGQ(),
  fetchHypebeast(),
  fetchHighsnobiety(),
  fetchRefinery29(),
  fetchCosmopolitan(),
  fetchHarperBazaar(),
  fetchWMagazine(),

  // === Lifestyle / Family ===
  fetchAfamily(),
  fetchParents(),
  fetchGoodHousekeeping(),
  fetchOprahMag(),

  // === Food & Drink ===
  fetchFoodWine(),
  fetchEater(),
  fetchSeriousEats(),
  fetchBonAppetit(),
  fetchSaveur(),
  fetchDelish(),
  fetchTheKitchn(),

  // === Cars ===
  fetchCarDriver(),
  fetchTopGear(),
  fetchMotorTrend(),
  fetchAutoExpress(),
  fetchRoadAndTrack(),

  // === Archaeology / History ===
  fetchArchaeologyMagazine(),
  fetchHeritageDaily(),
  fetchSmithsonianArchaeology(),
  fetchAncientOrigins(),
  fetchPastHorizons(),
  fetchHistoryExtra(),
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
