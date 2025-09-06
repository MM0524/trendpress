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
  fetchAndParseXmlFeed("https://hnrss.org/frontpage", "Hacker News", "Technology", "us", ["Tech"]);
const fetchTheVerge = () =>
  fetchAndParseXmlFeed("https://www.theverge.com/rss/index.xml", "The Verge", "Technology", "us", ["Tech"]);
const fetchBBCtech = () =>
  fetchAndParseXmlFeed("http://feeds.bbci.co.uk/news/technology/rss.xml", "BBC Tech", "Technology", "uk", ["Tech"]);
const fetchVNExpressTech = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/khoa-hoc.rss", "VNExpress Khoa Học & Công Nghệ", "Technology", "vn", ["Vietnam", "Tech"]);

// === AI ===
const fetchVentureBeatAI = () =>
  fetchAndParseXmlFeed("https://venturebeat.com/feed/", "VentureBeat AI", "AI", "us", ["AI"]);
const fetchNatureAI = () =>
  fetchAndParseXmlFeed("https://www.nature.com/subjects/machine-learning/rss", "Nature AI", "AI", "uk", ["AI"]);
const fetchZingNewsAI = () =>
  fetchAndParseXmlFeed("https://zingnews.vn/cong-nghe.rss", "ZingNews AI", "AI", "vn", ["Vietnam", "AI"]);

// === Gaming ===
const fetchIGNGaming = () =>
  fetchAndParseXmlFeed("https://feeds.ign.com/ign/games-all", "IGN Gaming", "Gaming", "us", ["Games"]);
const fetchEurogamer = () =>
  fetchAndParseXmlFeed("https://www.eurogamer.net/?format=rss", "Eurogamer", "Gaming", "uk", ["Games"]);
const fetchGenKVN = () =>
  fetchAndParseXmlFeed("https://genk.vn/game.rss", "GenK VN", "Gaming", "vn", ["Vietnam", "Games"]);

// === Finance ===
const fetchCNBCFinance = () =>
  fetchAndParseXmlFeed("https://www.cnbc.com/id/10000664/device/rss/rss.html", "CNBC Finance", "Finance", "us", ["Markets"]);
const fetchGuardianBusiness = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/uk/business/rss", "Guardian Business", "Finance", "uk", ["Markets"]);
const fetchCafeF = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/kinh-doanh.rss", "VNExpress", "Finance", "vn", ["Vietnam", "Markets"]);

// === Science ===
const fetchScienceMagazine = () =>
  fetchAndParseXmlFeed("https://www.sciencemag.org/rss/news_current.xml", "Science Magazine", "Science", "us", ["Science"]);
const fetchNewScientist = () =>
  fetchAndParseXmlFeed("https://www.newscientist.com/feed/home/", "New Scientist", "Science", "uk", ["Science"]);
const fetchVNExpressScience = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/khoa-hoc.rss", "VNExpress Khoa Học", "Science", "vn", ["Science", "Vietnam"]);

// === Music ===
const fetchRollingStone = () =>
  fetchAndParseXmlFeed("https://www.rollingstone.com/music/music-news/feed/", "Rolling Stone", "Music", "us", ["Music"]);
const fetchNME = () =>
  fetchAndParseXmlFeed("https://www.nme.com/feed", "NME Music", "Music", "uk", ["Music"]);
const fetchAppleMusicMostPlayedVN = () =>
  fetchJsonFeed("https://rss.applemarketingtools.com/api/v2/vn/music/most-played/100/songs.json", "Apple Music VN Most Played", "Music", "vn", ["Vietnam", "Music"]);

// === Entertainment ===
const fetchVariety = () =>
  fetchAndParseXmlFeed("https://variety.com/feed/", "Variety", "Entertainment", "us", ["Hollywood"]);
const fetchGuardianCulture = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/uk/culture/rss", "Guardian Culture", "Entertainment", "uk", ["Culture"]);
const fetchZingNewsEntertainment = () =>
  fetchAndParseXmlFeed("https://zingnews.vn/rss/giai-tri.rss", "ZingNews Entertainment", "Entertainment", "vn", ["Vietnam"]);

// === Sports ===
const fetchESPN = () =>
  fetchAndParseXmlFeed("https://www.espn.com/espn/rss/news", "ESPN", "Sports", "us", ["Sports"]);
const fetchSkySportsNews = () =>
  fetchAndParseXmlFeed("https://www.skysports.com/rss/12040", "Sky Sports", "Sports", "uk", ["Sports"]);
const fetchThanhNienSports = () =>
  fetchAndParseXmlFeed("https://thanhnien.vn/rss/the-thao.rss", "Thanh Niên Thể Thao", "Sports", "vn", ["Vietnam"]);

// === Logistics ===
const fetchFreightWaves = () =>
  fetchAndParseXmlFeed("https://www.freightwaves.com/feed", "FreightWaves", "Logistics", "us", ["SupplyChain"]);
const fetchTheLoadstar = () =>
  fetchAndParseXmlFeed("https://theloadstar.com/feed/", "The Loadstar UK", "Logistics", "uk", ["Logistics"]);
const fetchVNLogistics = () =>
  fetchAndParseXmlFeed("https://vietship.net/feed/", "Vietnam Logistics", "Logistics", "vn", ["Logistics"]);

// === Cybersecurity ===
const fetchKrebsOnSecurity = () =>
  fetchAndParseXmlFeed("https://krebsonsecurity.com/feed/", "Krebs on Security", "Cybersecurity", "us", ["Security"]);
const fetchSCMagUK = () =>
  fetchAndParseXmlFeed("https://www.scmagazineuk.com/rss", "SC Magazine UK", "Cybersecurity", "uk", ["Security"]);
const fetchVNExpressCyber = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/so-hoa.rss", "VNExpress Công Nghệ (Cyber)", "Cybersecurity", "vn", ["Vietnam"]);

// === Healthcare ===
const fetchMedicalNewsToday = () =>
  fetchAndParseXmlFeed("https://www.medicalnewstoday.com/rss", "Medical News Today", "Healthcare", "us", ["Health"]);
const fetchNHSNews = () =>
  fetchAndParseXmlFeed("https://www.england.nhs.uk/news/feed/", "NHS England News", "Healthcare", "uk", ["Health"]);
const fetchSucKhoeDoiSong = () =>
  fetchAndParseXmlFeed("https://suckhoedoisong.vn/rss/home.rss", "Sức Khỏe & Đời Sống", "Healthcare", "vn", ["Vietnam", "Health"]);

// === Education ===
const fetchEdSurge = () =>
  fetchAndParseXmlFeed("https://www.edsurge.com/research.rss", "EdSurge", "Education", "us", ["Education"]);
const fetchTimesHigherEd = () =>
  fetchAndParseXmlFeed("https://www.timeshighereducation.com/rss", "Times Higher Education", "Education", "uk", ["Education"]);
const fetchTuoiTreEducation = () =>
  fetchAndParseXmlFeed("https://tuoitre.vn/rss/giao-duc.rss", "Tuổi Trẻ Giáo Dục", "Education", "vn", ["Vietnam", "Education"]);

// === Environment ===
const fetchNatGeoEnvironment = () =>
  fetchAndParseXmlFeed("https://www.nationalgeographic.com/animals/rss/", "National Geographic Environment", "Environment", "us", ["Climate"]);
const fetchGuardianEnvironment = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/uk/environment/rss", "Guardian Environment", "Environment", "uk", ["Environment"]);
const fetchVNExpressEnvironment = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/khoa-hoc.rss", "VNExpress Môi Trường", "Environment", "vn", ["Vietnam", "Environment"]);

// === Travel ===
const fetchCNTraveler = () =>
  fetchAndParseXmlFeed("https://www.cntraveler.com/feed/rss", "Condé Nast Traveler", "Travel", "us", ["Travel"]);
const fetchGuardianTravel = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/uk/travel/rss", "Guardian Travel", "Travel", "uk", ["Travel"]);
const fetchVNExpressTravel = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/du-lich.rss", "VNExpress Du Lịch", "Travel", "vn", ["Vietnam", "Travel"]);

// === Toys ===
const fetchToyNewsIntl = () =>
  fetchAndParseXmlFeed("https://toyworldmag.co.uk/feed/", "Toy World Magazine", "Toys", "uk", ["Toys"]);
const fetchToyBook = () =>
  fetchAndParseXmlFeed("https://toybook.com/feed/", "Toy Book US", "Toys", "us", ["Toys"]);
const fetchGame4V = () =>
  fetchAndParseXmlFeed("https://game4v.com/feed", "Game4V VN", "Toys", "vn", ["Vietnam", "Games", "Toys"]);

// Beauty ===
const fetchVogueUS = () =>
  fetchAndParseXmlFeed("https://www.vogue.com/feed/rss", "Vogue US", "Fashion", "us", ["Fashion"]);
const fetchGuardianFashion = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/uk/fashion/rss", "Guardian Fashion", "Fashion", "uk", ["Fashion"]);
const fetchElleVN = () =>
  fetchAndParseXmlFeed("https://www.elle.vn/feed", "Elle Vietnam", "Fashion", "vn", ["Vietnam", "Fashion"]);

// === Food ===
const fetchBonAppetit = () =>
  fetchAndParseXmlFeed("https://www.bonappetit.com/feed/rss", "Bon Appetit", "Food", "us", ["Food"]);
const fetchBBCGoodFood = () =>
  fetchAndParseXmlFeed("https://www.bbcgoodfood.com/feed/rss", "BBC Good Food", "Food", "uk", ["Food"]);
const fetchMonNgonMoiNgay = () =>
  fetchAndParseXmlFeed("https://monngonmoingay.com/feed/", "Món Ngon Mỗi Ngày", "Food", "vn", ["Vietnam", "Food"]);

// === Cars ===
const fetchCarDriver = () =>
fetchAndParseXmlFeed("https://www.caranddriver.com/rss/all.xml/", "Car and Driver", "Cars", "us", ["Cars"]);
const fetchAutoCarUK = () =>
  fetchAndParseXmlFeed("https://www.autocar.co.uk/rss", "TopGear UK", "Cars", "uk", ["Cars"]);
const fetchVNExpressCarVN = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/oto-xe-may.rss", "VNExpress oto xe may", "Cars", "vn", ["Vietnam", "Cars"]);

// === Archaeology ===
const fetchArchaeologyMagazine = () =>
  fetchAndParseXmlFeed("https://www.archaeology.org/rss.xml", "Archaeology Magazine", "Archaeology", "us", ["Archaeology"]);
const fetchCurrentArchaeology = () =>
  fetchAndParseXmlFeed("https://www.archaeology.co.uk/feed", "Current Archaeology UK", "Archaeology", "uk", ["Archaeology"]);
const fetchHeritageVN = () =>
  fetchAndParseXmlFeed("https://baodantoc.vn/rss/van-hoa", "Báo Dân Tộc & Phát Triển - Di Sản", "Archaeology", "vn", ["Vietnam", "Culture"]);

// === News ===
const fetchNYTimesWorld = () =>
  fetchAndParseXmlFeed("https://rss.nytimes.com/services/xml/rss/nyt/World.xml", "NYTimes World", "News", "us", ["USA", "World"]);
const fetchBBCWorld = () =>
  fetchAndParseXmlFeed("http://feeds.bbci.co.uk/news/world/rss.xml", "BBC World", "News", "uk", ["WorldNews", "UK"]);
const fetchGoogleNewsVN = () =>
  fetchAndParseXmlFeed("https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi", "Google News VN", "News", "vn", ["GoogleNewsVN", "Vietnam"]);

// === Military / Defense ===
const fetchDefenseNews = () =>
  fetchAndParseXmlFeed("https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml", "Defense News", "Military", "us", ["USA", "Defense"]);
const fetchUKDefenseJournal = () =>
  fetchAndParseXmlFeed("https://ukdefencejournal.org.uk/feed/", "UK Defence Journal", "Military", "uk", ["UK", "Defense"]);
const fetchBaoQuanDoiNhanDan = () =>
  fetchAndParseXmlFeed("https://www.qdnd.vn/rss/qsnd", "Báo Quân đội Nhân dân", "Military", "vn", ["Vietnam", "QuocPhong", "Defense"]);

// === Politics ===
const fetchPolitico = () =>
  fetchAndParseXmlFeed("https://www.politico.com/rss/politics.xml", "Politico", "Politics", "us", ["USA", "Politics"]);
const fetchGuardianPolitics = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/politics/rss", "The Guardian Politics", "Politics", "uk", ["UK", "Politics"]);
const fetchVNExpressPolitics = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/thoi-su.rss", "VNExpress Politics", "Politics", "vn", ["Vietnam", "Politics"]);
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
 // === Technology ===
  fetchHackerNewsFrontpage(),
  fetchTheVerge(),
  fetchBBCtech(),
  fetchVNExpressTech(),

  // === AI ===
  fetchVentureBeatAI(),
  fetchNatureAI(),
  fetchZingNewsAI(),

  // === Gaming ===
  fetchIGNGaming(),
  fetchEurogamer(),
  fetchGenKVN(),

  // === Finance ===
  fetchCNBCFinance(),
  fetchGuardianBusiness(),
  fetchCafeF(),

  // === Science ===
  fetchScienceMagazine(),
  fetchNewScientist(),
  fetchVNExpressScience(),

  // === Music ===
  fetchRollingStone(),
  fetchNME(),
  fetchAppleMusicMostPlayedVN(),

  // === Entertainment ===
  fetchVariety(),
  fetchGuardianCulture(),
  fetchZingNewsEntertainment(),

  // === Sports ===
  fetchESPN(),
  fetchSkySportsNews(),
  fetchThanhNienSports(),

  // === Logistics ===
  fetchFreightWaves(),
  fetchTheLoadstar(),
  fetchVNLogistics(),

  // === Cybersecurity ===
  fetchKrebsOnSecurity(),
 fetchSCMagUK(),
  fetchVNExpressCyber(),

  // === Healthcare ===
  fetchMedicalNewsToday(),
  fetchNHSNews(),
  fetchSucKhoeDoiSong(),

  // === Education ===
  fetchEdSurge(),
  fetchTimesHigherEd(),
  fetchTuoiTreEducation(),

  // === Environment ===
  fetchNatGeoEnvironment(),
fetchGuardianEnvironment(),
  fetchVNExpressEnvironment(),

  // === Travel ===
  fetchCNTraveler(),
  fetchGuardianTravel(),
  fetchVNExpressTravel(),

  // === Toys ===
  fetchToyBook(),
  fetchToyNewsIntl(),
  fetchGame4V(),

  // === Fashion / Beauty ===
  fetchVogueUS(),
  fetchGuardianFashion(),
  fetchElleVN(),

  // === Food ===
  fetchBonAppetit(),
  fetchBBCGoodFood(),
  fetchMonNgonMoiNgay(),

  // === Cars ===
  fetchCarDriver(),
  fetchAutoCarUK(),
  fetchVNExpressCarVN(),

  // === Archaeology ===
  fetchArchaeologyMagazine(),
  fetchCurrentArchaeology(),
  fetchHeritageVN(),

  // News
  fetchNYTimesWorld(), 
  fetchBBCWorld(),
  fetchGoogleNewsVN(),

  // Politics
  fetchPolitico(), 
  fetchGuardianPolitics(),
  fetchVNExpressPolitics(),

  // Military
  fetchDefenseNews(), 
  fetchUKDefenseJournal(), 
  fetchBaoQuanDoiNhanDan(),
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
