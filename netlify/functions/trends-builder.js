// netlify/functions/trends-builder.js
const { builder } = require("@netlify/functions");
const fetch = require("node-fetch");
const { XMLParser } = require("fast-xml-parser");
const crypto = require('crypto');

// ===== Helpers (giữ nguyên từ fetch-trends.js) =====

async function fetchWithTimeout(url, options = {}, ms = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
        "Accept": "application/xml, text/xml, application/rss+xml, application/atom+xml, application/json, text/plain, */*",
        "Referer": new URL(url).origin,
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

function getSafeString(value) {
  if (value === null || value === undefined) {
    return "";
  }
  let strValue = "";
  if (typeof value === 'string') {
    strValue = value;
  }
  else if (typeof value === 'object' && value.hasOwnProperty('#text')) {
    strValue = String(value['#text']);
  }
  else if (typeof value === 'object' && value.hasOwnProperty('href')) {
    strValue = String(value.href);
  }
  else if (Array.isArray(value)) {
      strValue = String(value[0]); 
  }
  else {
    strValue = String(value);
  }
  return decodeHtmlEntities(strValue).trim();
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

function toDateStr(d) {
  const dt = d ? new Date(d) : new Date();
  return isNaN(dt.getTime())
    ? new Date().toISOString().split("T")[0]
    : dt.toISOString().split("T")[0];
}

function toSortValue(d) {
  const dt = d ? new Date(d) : null;
  return dt && !isNaN(dt.getTime()) ? dt.getTime() : 0; 
}

function createStandardTrend(item, sourceName, defaultCategory = "General", defaultRegion = "global", extraTags = []) {
  const title = getSafeString(item.title || item['media:title'] || item.name) || "No Title Available"; 
  const description = getSafeString(item.description || item.content?.['#text'] || item.summary?.['#text'] || item.content || item.artistName) || "No description available";
  
  let link = getSafeString(item.link);
  if (Array.isArray(item.link)) {
      const firstLink = item.link.find(l => l.rel === 'alternate' || !l.rel);
      if (firstLink && firstLink.href) {
          link = getSafeString(firstLink.href);
      } else if (item.link.length > 0) {
          link = getSafeString(item.link[0]);
      }
  } else if (typeof item.link === 'object' && item.link.href) {
      link = getSafeString(item.link.href);
  }
  link = link || "#";

  const pubDate = getSafeString(item.pubDate || item.published || item.updated || item.releaseDate) || new Date().toISOString();

  const cleanedTitle = title.replace(/<[^>]*>?/gm, '').replace(/\n{2,}/g, '\n').trim();
  const cleanedDescription = description.replace(/<[^>]*>?/gm, '').replace(/\n{2,}/g, '\n').trim();

  const baseVotes = Math.floor(Math.random() * 2000) + 1000;
  const baseMultiplier = (Math.random() * 1.5) + 0.5;

  const stableId = crypto.createHash('md5').update(`${link}-${cleanedTitle}`).digest('hex');

  return {
    id: stableId,
    title_en: cleanedTitle,
    description_en: cleanedDescription,
    title_vi: cleanedTitle,
    description_vi: cleanedDescription,
    category: defaultCategory,
    tags: [...new Set([...extraTags, sourceName.replace(/\s/g, "") || "Unknown", defaultRegion || "global"].filter(Boolean))],
    votes: baseVotes,
    views: Math.floor(baseVotes * (baseMultiplier * (Math.random() * 10 + 15))),
    interactions: Math.floor(baseVotes * (baseMultiplier * (Math.random() * 3 + 4))),
    searches: Math.floor(baseVotes * (baseMultiplier * (Math.random() * 1 + 1.5))),
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
      removeNSPrefix: true,
      isArray: (name, jpath, is  ) => {
        if (["item", "entry"].includes(name)) return true;
        if (["link", "category"].includes(name) && (jpath.includes("entry") || jpath.includes("item"))) return true;
        return false;
      }
    });
    const parsed = parser.parse(text);

    let rawItems = [];

    if (parsed?.rss?.channel?.item) {
      rawItems = parsed.rss.channel.item;
    } else if (parsed?.feed?.entry) {
      rawItems = parsed.feed.entry;
    } else if (parsed?.channel?.item) {
        rawItems = parsed.channel.item;
    } else if (parsed?.feed?.item) {
        rawItems = parsed.feed.item;
    } else if (parsed?.RDF?.item) {
        rawItems = parsed.RDF.item;
    } else if (parsed?.RDF?.li) {
        rawItems = parsed.RDF.li;
    }
    
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
        if (json?.feed?.results) {
            rawItems = json.feed.results;
        } else if (json?.items) { // Generic JSONFeed spec
             rawItems = json.items;
        }
        else {
            console.warn(`⁉️ ${sourceName}: Không tìm thấy results hoặc items trong cấu trúc JSON mong đợi. URL: ${url}`);
            return [];
        }

        return rawItems.map(item => createStandardTrend(item, sourceName, defaultCategory, defaultRegion, extraTags));
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

const fetchWired = () =>
  fetchAndParseXmlFeed("https://www.wired.com/feed/rss", "Wired", "Technology", "us", ["Tech", "Innovation"]);

const fetchTechCrunch = () =>
  fetchAndParseXmlFeed("https://techcrunch.com/feed/", "TechCrunch", "Technology", "us", ["Startups", "Tech"]);

const fetchNatureAI = () =>
  fetchAndParseXmlFeed("https://www.nature.com/subjects/machine-learning/rss", "Nature AI", "AI", "global", ["AI", "Research"]);

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
  fetchAndParseXmlFeed("https://cafef.vn/trang-chu.rss", "CafeF", "Finance", "vn", ["Vietnam"]);

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
  fetchAndParseXmlFeed("https://www.supplychaindigital.com/rss", "Supply Chain Digital", "Logistics", "global", ["SupplyChain"]); 

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

const fetchElleVN = () =>
  fetchAndParseXmlFeed("https://www.elle.vn/feed", "ELLE Vietnam Fashion", "Fashion", "vn");

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

// === International Gaming ===
const fetchKotaku = () =>
  fetchAndParseXmlFeed("https://kotaku.com/rss", "Kotaku", "Gaming", "us", ["Games"]);

const fetchPCGamer = () =>
  fetchAndParseXmlFeed("https://www.pcgamer.com/rss/", "PC Gamer", "Gaming", "global", ["PCGames"]);

// === International Finance ===
const fetchBloomberg = () =>
  fetchAndParseXmlFeed("https://www.bloomberg.com/feed/podcast/etf-report.xml", "Bloomberg", "Finance", "global", ["Markets"]);

const fetchFinancialTimes = () =>
  fetchAndParseXmlFeed("https://www.ft.com/?format=rss", "Financial Times", "Finance", "uk", ["Finance", "Markets"]);

// === International Science ===
const fetchNature = () =>
  fetchAndParseXmlFeed("https://www.nature.com/nature.rss", "Nature", "Science", "global", ["Research"]);

const fetchNationalGeographic = () =>
  fetchAndParseXmlFeed("https://www.nationalgeographic.com/content/natgeo/en_us/rss/index.rss", "National Geographic", "Science", "global", ["Wildlife", "Planet"]);

// === International Music ===
const fetchBillboard = () =>
  fetchAndParseXmlFeed("https://www.billboard.com/feed/", "Billboard", "Music", "us", ["Charts", "Music"]);

const fetchPitchfork = () =>
  fetchAndParseXmlFeed("https://pitchfork.com/feed/feed-news/rss", "Pitchfork", "Music", "us", ["IndieMusic"]);

// === International Entertainment ===
const fetchHollywoodReporter = () =>
  fetchAndParseXmlFeed("https://www.hollywoodreporter.com/t/feed/", "Hollywood Reporter", "Entertainment", "us", ["Hollywood"]);

const fetchRollingStone = () =>
  fetchAndParseXmlFeed("https://www.rollingstone.com/music/music-news/feed/", "Rolling Stone", "Entertainment", "us", ["Music", "Culture"]);

// === International Sports ===
const fetchSkySports = () =>
  fetchAndParseXmlFeed("https://www.skysports.com/rss/12040", "Sky Sports", "Sports", "uk", ["Sports"]);

const fetchFifa = () =>
  fetchAndParseXmlFeed("https://www.fifa.com/rss-feeds/news", "FIFA", "Sports", "global", ["Football", "Soccer"]);

// === International Logistics / Business ===
const fetchWSJ = () =>
  fetchAndParseXmlFeed("https://feeds.a.dj.com/rss/RSSWorldNews.xml", "Wall Street Journal", "Logistics", "us", ["WSJ", "Business"]);

const fetchReutersBusiness = () =>
  fetchAndParseXmlFeed("https://feeds.reuters.com/reuters/businessNews", "Reuters Business", "Logistics", "global", ["Business"]);

// === International Cybersecurity ===
const fetchKrebsSecurity = () =>
  fetchAndParseXmlFeed("https://krebsonsecurity.com/feed/", "Krebs on Security", "Cybersecurity", "us", ["Security"]);

const fetchDarkReading = () =>
  fetchAndParseXmlFeed("https://www.darkreading.com/rss.xml", "Dark Reading", "Cybersecurity", "us", ["Security"]);

// === International Healthcare ===
const fetchWHO = () =>
  fetchAndParseXmlFeed("https://www.who.int/feeds/entity/mediacentre/news/en/rss.xml", "WHO", "Healthcare", "global", ["Health"]);

const fetchHealthline = () =>
  fetchAndParseXmlFeed("https://www.healthline.com/rss", "Healthline", "Healthcare", "us", ["Wellness"]);

// === International Education ===
const fetchEdWeek = () =>
  fetchAndParseXmlFeed("https://feeds.feedburner.com/EducationWeekNews", "Education Week", "Education", "us", ["Education"]);

const fetchTimesHigherEducation = () =>
  fetchAndParseXmlFeed("https://www.timeshighereducation.com/rss", "Times Higher Education", "Education", "uk", ["University"]);

// === International Environment ===
const fetchUNEnvironment = () =>
  fetchAndParseXmlFeed("https://www.unep.org/rss.xml", "UN Environment", "Environment", "global", ["Climate"]);

const fetchNatGeoEnvironment = () =>
  fetchAndParseXmlFeed("https://www.nationalgeographic.com/environment/rss", "NatGeo Environment", "Environment", "global", ["Climate", "Nature"]);

// === International Travel ===
const fetchCNTraveler = () =>
  fetchAndParseXmlFeed("https://www.cntraveler.com/feed/rss", "Condé Nast Traveler", "Travel", "us", ["Travel"]);

const fetchTravelWeekly = () =>
  fetchAndParseXmlFeed("https://www.travelweekly.com/rss/top-headlines", "Travel Weekly", "Travel", "us", ["Tourism"]);

// === International Toys ===
const fetchToyWorldMag = () =>
  fetchAndParseXmlFeed("https://toyworldmag.co.uk/feed/", "Toy World Magazine", "Toys", "uk", ["Toys"]);

const fetchKidscreen = () =>
  fetchAndParseXmlFeed("https://kidscreen.com/feed/", "Kidscreen", "Toys", "global", ["Kids", "Entertainment"]);

// === International Fashion / Beauty ===
const fetchCosmopolitan = () =>
  fetchAndParseXmlFeed("https://www.cosmopolitan.com/rss/all.xml/", "Cosmopolitan", "Beauty", "us", ["Beauty", "Lifestyle"]);

const fetchHarperBazaar = () =>
  fetchAndParseXmlFeed("https://www.harpersbazaar.com/rss/all.xml", "Harper's Bazaar", "Fashion", "us", ["Fashion", "Beauty"]);

// === International Food ===
const fetchBonAppetit = () =>
  fetchAndParseXmlFeed("https://www.bonappetit.com/feed/rss", "Bon Appétit", "Food", "us", ["Cooking"]);

const fetchSaveur = () =>
  fetchAndParseXmlFeed("https://www.saveur.com/feed/", "Saveur", "Food", "us", ["Cuisine"]);

// === International Cars ===
const fetchMotorTrend = () =>
  fetchAndParseXmlFeed("https://www.motortrend.com/feed/", "MotorTrend", "Cars", "us", ["Cars"]);

const fetchAutoExpress = () =>
  fetchAndParseXmlFeed("https://www.autoexpress.co.uk/rss", "Auto Express", "Cars", "uk", ["Cars"]);

// === International Archaeology ===
const fetchAncientOrigins = () =>
  fetchAndParseXmlFeed("https://www.ancient-origins.net/rss.xml", "Ancient Origins", "Archaeology", "global", ["History", "Archaeology"]);

const fetchPastHorizons = () =>
  fetchAndParseXmlFeed("http://www.pasthorizonspr.com/index.php/feed", "Past Horizons", "Archaeology", "global", ["History", "Archaeology"]);


// =========================================================================
// NEW INTERNATIONAL NEWS SOURCES
// =========================================================================

// Germany
const fetchDWNews = () =>
  fetchAndParseXmlFeed("https://rss.dw.com/xml/rss-en-all", "Deutsche Welle", "News", "de", ["Germany", "Europe"]);

// France
const fetchFrance24News = () =>
  fetchAndParseXmlFeed("https://www.france24.com/en/rss", "France 24", "News", "fr", ["France", "Europe"]);

// Europe (General) - Using Euronews
const fetchEuronews = () =>
  fetchAndParseXmlFeed("https://www.euronews.com/rss?format=xml", "Euronews", "News", "eu", ["Europe"]);

// China - Using China Daily for official news
const fetchChinaDaily = () =>
  fetchAndParseXmlFeed("https://www.chinadaily.com.cn/rss/cnews.xml", "China Daily", "News", "cn", ["China"]);

// Russia - Using The Moscow Times (English, independent) if RSS available, otherwise skip due to "reputable" constraint.
// Note: As finding a truly "reputable" and accessible RSS for Russia (non-state-controlled) is challenging and political,
// for this demo, I'm opting to skip it or use a less problematic source if absolutely necessary.
// Let's explicitly skip for now to maintain "reputable" standard in this list.

// South Korea - The Korea Herald
const fetchKoreaHerald = () =>
  fetchAndParseXmlFeed("https://www.koreaherald.com/rss/xml/news_all.xml", "The Korea Herald", "News", "kr", ["SouthKorea"]);

// North Korea - No reputable, independent news sources exist. Skipping.

// India - NDTV
const fetchNDTV = () =>
  fetchAndParseXmlFeed("https://feeds.feedburner.com/ndtvnews-latest", "NDTV", "News", "in", ["India"]);

// Australia - ABC News Australia
const fetchABCNewsAU = () =>
  fetchAndParseXmlFeed("https://www.abc.net.au/news/feed/51120/rss.xml", "ABC News Australia", "News", "au", ["Australia"]);

// Japan - NHK World-Japan
const fetchNHKWorld = () =>
  fetchAndParseXmlFeed("https://www.nhk.or.jp/nhkworld/en/news/rss/all.xml", "NHK World-Japan", "News", "jp", ["Japan"]);


// ===== Main handler =====
// Wrapped in builder to enable caching for Netlify Functions
exports.handler = builder(async (event, context) => { // ADD builder HERE
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
  fetchWired(),
  fetchTechCrunch(),
  fetchNatureAI(),

  // === Gaming ===
  fetchIGNGaming(),
  fetchGameKVN(),
  fetchKotaku(),
  fetchPCGamer(),

  // === News / Politics ===
  fetchGoogleNewsVN(),
  fetchBBCWorld(),
  fetchPolitics(),
  // NEW INTERNATIONAL NEWS
  fetchDWNews(),
  fetchFrance24News(),
  fetchEuronews(),
  fetchChinaDaily(),
  fetchKoreaHerald(),
  fetchNDTV(),
  fetchABCNewsAU(),
  fetchNHKWorld(),


  // === Finance ===
  fetchYahooFinance(),
  fetchCNBCFinance(),
  fetchCafeF(),
  fetchBloomberg(),
  fetchFinancialTimes(),

  // === Science ===
  fetchScienceMagazine(),
  fetchNewScientist(),
  fetchNature(),
  fetchNationalGeographic(),

  // === Music ===
  fetchAppleMusicMostPlayedVN(),
  fetchAppleMusicNewReleasesVN(),
  fetchBillboard(),
  fetchPitchfork(),

  // === Media / Entertainment ===
  fetchYouTubeTrendingVN(),
  fetchVariety(),
  fetchDeadline(),
  fetchZingNewsEntertainment(),
  fetchHollywoodReporter(),
  fetchRollingStone(),

  // === Sports ===
  fetchESPN(),
  fetchSkySports(),
  fetchFifa(),

  // === Logistics / Business ===
  fetchLogistics(),
  fetchWSJ(),
  fetchReutersBusiness(),

  // === Cybersecurity ===
  fetchCybernews(),
  fetchKrebsSecurity(),
  fetchDarkReading(),

  // === Healthcare ===
  fetchHealthcare(),
  fetchWHO(),
  fetchHealthline(),

  // === Education ===
  fetchEducation(),
  fetchEdWeek(),
  fetchTimesHigherEducation(),

  // === Environment ===
  fetchEnvironment(),
  fetchUNEnvironment(),
  fetchNatGeoEnvironment(),

  // === Travel ===
  fetchTravel(),
  fetchCNTraveler(),
  fetchTravelWeekly(),

  // === Toys ===
  fetchToyNews(),
  fetchToyWorldMag(),
  fetchKidscreen(),

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

  // === Lifestyle / Family ===
  fetchAfamily(),
  fetchParents(),

  // === Food & Drink ===
  fetchFoodWine(),
  fetchEater(),
  fetchSeriousEats(),
  fetchBonAppetit(),
  fetchSaveur(),

  // === Cars ===
  fetchCarDriver(),
  fetchTopGear(),
  fetchMotorTrend(),
  fetchAutoExpress(),

  // === Archaeology ===
  fetchArchaeologyMagazine(),
  fetchHeritageDaily(),
  fetchSmithsonianArchaeology(),
  fetchAncientOrigins(),
  fetchPastHorizons(),
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

    // Apply filters (only basic filtering for the cached master list)
    // IMPORTANT: For Builder functions, it's best to build a *master* list
    // and let the client-side JS filter it further, OR build *multiple* cached lists
    // for common filters if the permutations are manageable.
    // For now, we'll build the unfiltered master list.
    // The client-side fetch-trends will then handle filtering this cached data.

    let filteredTrends = allFetchedTrends
      .filter(Boolean) // Ensure no null/undefined items sneak through
      .sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));

    return {
      statusCode: 200,
      headers: {
        ...headers,
        "Cache-Control": "public, max-age=3600, must-revalidate", // Cache for 1 hour (3600 seconds)
      },
      body: JSON.stringify({ success: true, trends: filteredTrends }),
    };
  } catch (err) {
    console.error("fetch-trends handler error:", err);
    return {
      statusCode: 500,
      headers: {
        ...headers,
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate", // Don't cache errors
      },
      body: JSON.stringify({ success: false, error: "Failed to fetch trends", message: err.message }),
    };
  }
});
