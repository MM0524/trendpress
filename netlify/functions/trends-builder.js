// netlify/functions/trends-builder.js
const { builder } = require("@netlify/functions");
const fetch = require("node-fetch");
const { XMLParser } = require("fast-xml-parser");
const crypto = require('crypto');

// ===== Helpers (giữ nguyên từ fetch-trends.js) =====

async function fetchWithTimeout(url, options = {}, ms = 30000) { // Tăng timeout lên 30 giây
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

function calculateHotnessScore(trend, maxValues) {
    const weights = { views: 0.2, interactions: 0.4, searches: 0.3, votes: 0.1 };
    const normViews = (trend.views / maxValues.views) || 0;
    const normInteractions = (trend.interactions / maxValues.interactions) || 0;
    const normSearches = (trend.searches / maxValues.searches) || 0;
    const normVotes = (trend.votes / maxValues.votes) || 0;
    return (normViews * weights.views) + (normInteractions * weights.interactions) + (normSearches * weights.searches) + (normVotes * weights.votes);
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


// =========================================================================
// Individual Feed Fetchers (Grouped by Category/Region for clarity and uniqueness)
// Đảm bảo tên hàm là DUY NHẤT và các URL là HỢP LỆ
// Đã cắt giảm số lượng nguồn để tăng tính ổn định
// =========================================================================

// --- AI ---
const fetchers_AI = [
  () => fetchAndParseXmlFeed("https://venturebeat.com/feed/", "VentureBeat AI", "AI", "us", ["VentureBeat","AI"]),
  () => fetchAndParseXmlFeed("https://www.technologyreview.com/feed/", "MIT Technology Review", "AI", "us", ["AI","Research"]),
  () => fetchAndParseXmlFeed("https://www.theguardian.com/technology/ai/rss", "Guardian AI", "AI", "uk", ["UK","AI"]),
  () => fetchAndParseXmlFeed("https://www.euronews.com/next/rss", "Euronews Next (AI)", "AI", "eu", ["EU","AI"]),
  () => fetchAndParseXmlFeed("https://www.lemonde.fr/technologies/rss_full.xml", "Le Monde Tech/AI", "AI", "fr", ["France","AI"]),
  () => fetchAndParseXmlFeed("https://technode.com/feed/", "TechNode AI", "AI", "cn", ["China","AI"]),
  () => fetchAndParseXmlFeed("https://vietnamnet.vn/rss/cong-nghe.rss", "Vietnamnet AI", "AI", "vn", ["Vietnam","AI"]), // Updated URL (using Vietnamnet for tech)
];

// --- Archaeology ---
const fetchers_Archaeology = [
  () => fetchAndParseXmlFeed("https://www.archaeology.org/rss.xml", "Archaeology Magazine", "Archaeology", "us", ["Archaeology"]),
  () => fetchAndParseXmlFeed("https://www.heritagedaily.com/category/archaeology/feed", "HeritageDaily", "Archaeology", "eu", ["Archaeology"]),
  () => fetchAndParseXmlFeed("https://www.ancient-origins.net/feed", "Ancient Origins", "Archaeology", "global", ["Archaeology"]),
  () => fetchAndParseXmlFeed("https://www.chinahistory.net/rss", "China Heritage", "Archaeology", "cn", ["China","Archaeology"]), // Adjusted URL
];

// --- Beauty ---
const fetchers_Beauty = [
  () => fetchAndParseXmlFeed("https://www.allure.com/feed/all", "Allure Beauty", "Beauty", "us", ["Beauty","Cosmetics"]),
  () => fetchAndParseXmlFeed("https://www.vogue.co.uk/rss/beauty", "Vogue Beauty UK", "Beauty", "uk", ["UK","Beauty"]),
];

// --- Business ---
const fetchers_Business = [
  () => fetchAndParseXmlFeed("https://feeds.a.dj.com/rss/RSSWorldNews.xml", "Wall Street Journal", "Business", "us", ["WSJ","Business"]),
  () => fetchAndParseXmlFeed("https://www.bloomberg.com/feed/podcast/etf-report.xml", "Bloomberg Business", "Business", "global", ["Markets","Business"]),
  () => fetchAndParseXmlFeed("https://www.ft.com/?format=rss", "Financial Times", "Business", "uk", ["Finance","Business"]),
  () => fetchAndParseXmlFeed("https://www.euronews.com/business/rss", "Euronews Business", "Business", "eu", ["Business"]),
  () => fetchAndParseXmlFeed("https://bfmbusiness.bfmtv.com/rss/info/flux-rss/flux-toutes-les-actualites/", "BFM Business", "Business", "fr", ["France","Business"]),
  () => fetchAndParseXmlFeed("https://rssexport.rbc.ru/rbcnews/business/index.rss", "RBC Business", "Business", "ru", ["Russia","Business"]),
  () => fetchAndParseXmlFeed("https://www.scmp.com/rss/91/feed", "South China Morning Post Business", "Business", "cn", ["China","Business"]), // General News feed, might include Business
  () => fetchAndParseXmlFeed("https://vietnambiz.vn/kinh-doanh.rss", "VietnamBiz", "Business", "vn", ["Vietnam","Business"]),
];

// --- Cars ---
const fetchers_Cars = [
  () => fetchAndParseXmlFeed("https://www.caranddriver.com/rss/all.xml/", "Car and Driver", "Cars", "us", ["Cars"]),
  () => fetchAndParseXmlFeed("https://www.topgear.com/feeds/all/rss.xml", "Top Gear", "Cars", "uk", ["Cars"]),
  () => fetchAndParseXmlFeed("https://europe.autonews.com/rss", "Autonews Europe", "Cars", "eu", ["Cars"]),
  () => fetchAndParseXmlFeed("https://www.largus.fr/rss.xml", "L'Argus", "Cars", "fr", ["France","Cars"]),
  () => fetchAndParseXmlFeed("https://kolesa.ru/rss", "Kolesa.ru", "Cars", "ru", ["Russia","Cars"]),
  () => fetchAndParseXmlFeed("https://www.autohome.com.cn/rss", "Autohome", "Cars", "cn", ["China","Cars"]),
  () => fetchAndParseXmlFeed("https://vnexpress.net/rss/oto-xe-may.rss", "VNExpress Auto", "Cars", "vn", ["Vietnam","Cars"]),
];

// --- Cybersecurity ---
const fetchers_Cybersecurity = [
  () => fetchAndParseXmlFeed("https://krebsonsecurity.com/feed/", "Krebs on Security", "Cybersecurity", "us", ["Security"]),
  () => fetchAndParseXmlFeed("https://www.scmagazineuk.com/rss", "SC Magazine UK", "Cybersecurity", "uk", ["Security"]),
  () => fetchAndParseXmlFeed("https://www.zdnet.com/topic/security/rss.xml", "ZDNet Security", "Cybersecurity", "eu", ["Security"]),
  () => fetchAndParseXmlFeed("https://www.ssi.gouv.fr/feed/", "ANSSI / SSI France", "Cybersecurity", "fr", ["France","Security"]),
  () => fetchAndParseXmlFeed("https://www.kaspersky.com/blog/rss", "Kaspersky Lab Blog", "Cybersecurity", "ru", ["Russia","Security"]),
  () => fetchAndParseXmlFeed("https://www.cert.org.cn/rss", "CN-CERT", "Cybersecurity", "cn", ["China","Security"]),
  () => fetchAndParseXmlFeed("https://ictnews.vietnamnet.vn/rss/bao-mat", "ICT News", "Cybersecurity", "vn", ["Vietnam","Security"]),
];

// --- Education ---
const fetchers_Education = [
  () => fetchAndParseXmlFeed("https://www.chronicle.com/feed", "Chronicle of Higher Education", "Education", "us", ["Education"]),
  () => fetchAndParseXmlFeed("https://www.timeshighereducation.com/rss", "Times Higher Education", "Education", "uk", ["Education"]),
  () => fetchAndParseXmlFeed("https://www.universityworldnews.com/rss/", "University World News", "Education", "eu", ["Education"]),
  () => fetchAndParseXmlFeed("https://www.lefigaro.fr/rss/le-figaro-education.xml", "Le Figaro Education", "Education", "fr", ["France","Education"]),
  () => fetchAndParseXmlFeed("https://tass.com/rss/education.xml", "TASS Education", "Education", "ru", ["Russia","Education"]),
  () => fetchAndParseXmlFeed("https://www.chinadaily.com.cn/rss/education.xml", "ChinaDaily Education", "Education", "cn", ["China","Education"]),
  () => fetchAndParseXmlFeed("https://tuoitre.vn/rss/giao-duc.rss", "Tuổi Trẻ Education", "Education", "vn", ["Vietnam","Education"]),
];

// --- Entertainment ---
const fetchers_Entertainment = [
  () => fetchAndParseXmlFeed("https://variety.com/feed/", "Variety", "Entertainment", "us", ["Entertainment"]),
  () => fetchAndParseXmlFeed("https://www.theguardian.com/uk/culture/rss", "Guardian Culture", "Entertainment", "uk", ["UK","Culture"]),
  () => fetchAndParseXmlFeed("https://www.euronews.com/culture/rss", "Euronews Culture", "Entertainment", "eu", ["Culture"]),
  () => fetchAndParseXmlFeed("http://rss.allocine.fr/ac/actualites/cine", "Allociné", "Entertainment", "fr", ["France","Entertainment"]),
  () => fetchAndParseXmlFeed("https://www.kino-teatr.ru/rss/news.rss", "Kino-Teatr.ru", "Entertainment", "ru", ["Russia","Entertainment"]),
  () => fetchAndParseXmlFeed("https://www.sixthtone.com/rss", "Sixth Tone Culture", "Entertainment", "cn", ["China","Entertainment"]),
  () => fetchAndParseXmlFeed("https://zingnews.vn/rss/giai-tri.rss", "ZingNews Entertainment", "Entertainment", "vn", ["Vietnam","Entertainment"]),
];

// --- Environment ---
const fetchers_Environment = [
  () => fetchAndParseXmlFeed("https://www.nationalgeographic.com/content/natgeo/en_us/rss/index.rss", "National Geographic", "Environment", "us", ["Nature"]),
  () => fetchAndParseXmlFeed("https://www.theguardian.com/uk/environment/rss", "Guardian Environment", "Environment", "uk", ["UK","Environment"]),
  () => fetchAndParseXmlFeed("https://www.euractiv.com/section/climate-environment/feed/", "Euractiv Environment", "Environment", "eu", ["EU","Environment"]),
  () => fetchAndParseXmlFeed("https://www.lemonde.fr/en/environment/rss_full.xml", "Le Monde Environment", "Environment", "fr", ["France","Environment"]),
  () => fetchAndParseXmlFeed("https://tass.com/rss/environment.xml", "TASS Environment", "Environment", "ru", ["Russia","Environment"]),
  () => fetchAndParseXmlFeed("https://www.chinadaily.com.cn/rss/environment.xml", "ChinaDaily Environment", "Environment", "cn", ["China","Environment"]),
  () => fetchAndParseXmlFeed("https://vnexpress.net/rss/khoa-hoc.rss", "VNExpress Environment", "Environment", "vn", ["Vietnam","Environment"]),
];

// --- Family ---
const fetchers_Family = [
  () => fetchAndParseXmlFeed("https://www.parents.com/rss/", "Parents.com", "Family", "us", ["Parenting","Family"]),
  () => fetchAndParseXmlFeed("https://www.motherandbaby.co.uk/rss", "Mother & Baby", "Family", "uk", ["Family"]),
  () => fetchAndParseXmlFeed("https://www.magicmaman.com/rss.xml", "MagicMaman", "Family", "fr", ["France","Family"]),
  () => fetchAndParseXmlFeed("https://www.mamsy.ru/rss", "Mamsy", "Family", "ru", ["Russia","Family"]),
  () => fetchAndParseXmlFeed("https://www.babytree.com/rss", "BabyTree", "Family", "cn", ["China","Family"]),
  () => fetchAndParseXmlFeed("https://afamily.vn/rss/home.rss", "Afamily Family", "Family", "vn", ["Vietnam","Family"]),
];

// --- Fashion ---
const fetchers_Fashion = [
  () => fetchAndParseXmlFeed("https://www.vogue.com/feed/rss", "Vogue", "Fashion", "us", ["Fashion","Beauty"]),
  () => fetchAndParseXmlFeed("https://www.elle.com/rss/all.xml", "Elle", "Fashion", "us", ["Fashion"]),
  () => fetchAndParseXmlFeed("https://www.harpersbazaar.com/rss/all.xml", "Harper's Bazaar", "Fashion", "uk", ["Fashion"]),
  () => fetchAndParseXmlFeed("https://www.highsnobiety.com/feed", "Highsnobiety", "Fashion", "eu", ["Fashion"]),
  () => fetchAndParseXmlFeed("https://www.lemonde.fr/m-styles/rss_full.xml", "Le Monde Styles", "Fashion", "fr", ["France","Fashion"]),
  () => fetchAndParseXmlFeed("https://www.gq.com/rss", "GQ", "Fashion", "us", ["Fashion"]),
  () => fetchAndParseXmlFeed("https://hypebeast.com/feed", "Hypebeast", "Fashion", "global", ["Fashion"]),
  () => fetchAndParseXmlFeed("https://www.chinadaily.com.cn/rss/fashion.xml", "ChinaDaily Fashion", "Fashion", "cn", ["China","Fashion"]),
  () => fetchAndParseXmlFeed("https://www.elle.vn/feed", "ELLE Vietnam Fashion", "Fashion", "vn", ["Vietnam","Fashion"]),
];

// --- Finance ---
const fetchers_Finance = [
  () => fetchAndParseXmlFeed("https://finance.yahoo.com/news/rss", "Yahoo Finance", "Finance", "us", ["Finance"]),
  () => fetchAndParseXmlFeed("https://www.ft.com/?format=rss", "Financial Times", "Finance", "uk", ["Finance"]),
  () => fetchAndParseXmlFeed("https://feeds.reuters.com/reuters/businessNews", "Reuters Business (Finance)", "Finance", "eu", ["Finance"]),
  () => fetchAndParseXmlFeed("https://www.lesechos.fr/rss", "Les Echos Finance", "Finance", "fr", ["France","Finance"]),
  () => fetchAndParseXmlFeed("https://www.kommersant.ru/RSS/news.xml", "Kommersant Finance", "Finance", "ru", ["Russia","Finance"]),
  () => fetchAndParseXmlFeed("https://www.caixinglobal.com/rss", "Caixin Finance", "Finance", "cn", ["China","Finance"]),
  () => fetchAndParseXmlFeed("https://vnexpress.net/rss/kinh-doanh.rss", "VNExpress Finance", "Finance", "vn", ["Vietnam","Finance"]),
];

// --- Food ---
const fetchers_Food = [
  () => fetchAndParseXmlFeed("https://www.bonappetit.com/feed/rss", "Bon Appétit", "Food", "us", ["Food"]),
  () => fetchAndParseXmlFeed("https://www.bbcgoodfood.com/feed/rss", "BBC Good Food", "Food", "uk", ["Food"]),
  () => fetchAndParseXmlFeed("https://www.seriouseats.com/rss", "Serious Eats", "Food", "global", ["Food"]), 
  () => fetchAndParseXmlFeed("https://www.cuisineaz.com/rss", "CuisineAZ", "Food", "fr", ["France","Food"]),
  () => fetchAndParseXmlFeed("https://www.povarenok.ru/rss", "Povarenok", "Food", "ru", ["Russia","Food"]),
  () => fetchAndParseXmlFeed("https://www.chinadaily.com.cn/rss/food.xml", "ChinaDaily Food", "Food", "cn", ["China","Food"]),
];

// --- Gaming ---
const fetchers_Gaming = [
  () => fetchAndParseXmlFeed("https://feeds.ign.com/ign/games-all", "IGN Gaming", "Gaming", "us", ["IGN","Games"]),
  () => fetchAndParseXmlFeed("https://www.pcgamer.com/rss/", "PC Gamer", "Gaming", "us", ["PCGames"]),
  () => fetchAndParseXmlFeed("https://www.eurogamer.net/?format=rss", "Eurogamer", "Gaming", "uk", ["Games"]),
  () => fetchAndParseXmlFeed("https://gamek.vn/home.rss", "GameK VN", "Gaming", "vn", ["Vietnam","Games"]),
  () => fetchAndParseXmlFeed("https://www.kotaku.com.au/feed/", "Kotaku AU", "Gaming", "au", ["Games","Australia"]),
  () => fetchAndParseXmlFeed("https://www.4gamer.net/rss/news.xml", "4Gamer JP", "Gaming", "jp", ["Japan","Games"]),
  () => fetchAndParseXmlFeed("https://www.gamelook.com.cn/feed", "GameLook CN", "Gaming", "cn", ["China","Games"]),
  () => fetchAndParseXmlFeed("https://www.inven.co.kr/rss/news.xml", "Inven KR", "Gaming", "kr", ["Korea","Games"]),
];

// --- Healthcare ---
const fetchers_Healthcare = [
  () => fetchAndParseXmlFeed("https://www.medicalnewstoday.com/rss", "Medical News Today", "Healthcare", "us", ["Health"]),
  () => fetchAndParseXmlFeed("https://www.bmj.com/rss.xml", "BMJ", "Healthcare", "uk", ["Health"]),
  () => fetchAndParseXmlFeed("https://www.euractiv.com/section/health/feed/", "Euractiv Health", "Healthcare", "eu", ["Europe","Health"]),
  () => fetchAndParseXmlFeed("https://www.who.int/feeds/entity/mediacentre/news/en/rss.xml", "WHO News", "Healthcare", "global", ["Health"]),
  () => fetchAndParseXmlFeed("https://www.inserm.fr/en/news/rss", "INSERM News", "Healthcare", "fr", ["France","Health"]),
  () => fetchAndParseXmlFeed("https://tass.com/rss/health.xml", "TASS Health", "Healthcare", "ru", ["Russia","Health"]),
  () => fetchAndParseXmlFeed("https://www.chinadaily.com.cn/rss/health.xml", "ChinaDaily Health", "Healthcare", "cn", ["China","Health"]),
  () => fetchAndParseXmlFeed("https://suckhoedoisong.vn/rss/home.rss", "Sức Khỏe & Đời Sống", "Healthcare", "vn", ["Vietnam","Health"]),
];

// --- Lifestyle ---
const fetchers_Lifestyle = [
  () => fetchAndParseXmlFeed("https://www.refinery29.com/en-us/feed", "Refinery29 Lifestyle", "Lifestyle", "us", ["Lifestyle"]),
  () => fetchAndParseXmlFeed("https://goop.com/feed/", "Goop", "Lifestyle", "us", ["Wellness"]),
  () => fetchAndParseXmlFeed("https://afamily.vn/rss/home.rss", "Afamily Lifestyle", "Lifestyle", "vn", ["Vietnam","Lifestyle"]),
];

// --- Music ---
const fetchers_Music = [
  () => fetchAndParseXmlFeed("https://www.billboard.com/feed/", "Billboard", "Music", "us", ["Music"]),
  () => fetchAndParseXmlFeed("https://www.nme.com/feed", "NME Music", "Music", "uk", ["Music"]),
  () => fetchAndParseXmlFeed("https://www.euronews.com/culture/music/rss", "Euronews Music", "Music", "eu", ["Europe","Music"]),
  () => fetchAndParseXmlFeed("https://www.francemusique.fr/rss", "France Musique", "Music", "fr", ["France","Music"]),
  () => fetchAndParseXmlFeed("https://www.themoscowtimes.com/feeds/rss/culture", "MoscowTimes Culture/Music", "Music", "ru", ["Russia","Music"]),
  () => fetchAndParseXmlFeed("https://www.scmp.com/rss/32/feed", "SCMP Culture", "Music", "cn", ["China","Music"]),
  () => fetchJsonFeed("https://rss.applemarketingtools.com/api/v2/vn/music/most-played/100/songs.json", "Apple Music Most Played VN", "Music", "vn", ["Vietnam","Music"]),
];

// --- News ---
const fetchers_News = [
  () => fetchAndParseXmlFeed("http://rss.cnn.com/rss/cnn_topstories.rss", "CNN News", "News", "us", ["USA","News"]),
  () => fetchAndParseXmlFeed("http://feeds.bbci.co.uk/news/rss.xml", "BBC News", "News", "uk", ["UK","News"]),
  () => fetchAndParseXmlFeed("https://www.euronews.com/rss?format=xml", "Euronews", "News", "eu", ["Europe","News"]),
  () => fetchAndParseXmlFeed("https://www.france24.com/en/rss", "France24 News", "News", "fr", ["France","News"]),
  () => fetchAndParseXmlFeed("https://tass.com/rss/v2.xml", "TASS", "News", "ru", ["Russia","News"]),
  () => fetchAndParseXmlFeed("https://www.globaltimes.cn/rss/", "China Globaltimes", "News", "cn", ["China","News"]),
  () => fetchAndParseXmlFeed("https://www.koreaherald.com/rss/xml/news_all.xml", "The Korea Herald", "News", "kr", ["SouthKorea"]),
  () => fetchAndParseXmlFeed("https://feeds.feedburner.com/ndtvnews-latest", "NDTV", "News", "in", ["India"]),
  () => fetchAndParseXmlFeed("https://www.abc.net.au/news/feed/51120/rss.xml", "ABC News Australia", "News", "au", ["Australia"]),
  () => fetchAndParseXmlFeed("https://www.japantimes.co.jp/feed/", "The Japan Times", "News", "jp", ["Japan"]), // Prefer Japan Times over NHK for diversity
  () => fetchAndParseXmlFeed("https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi", "Google News VN", "News", "vn", ["GoogleNewsVN", "Vietnam"]),
  () => fetchAndParseXmlFeed("https://vnexpress.net/rss/thoi-su.rss", "VnExpress News", "News", "vn", ["Vietnam","News"]),
];

// --- Politics ---
const fetchers_Politics = [
  () => fetchAndParseXmlFeed("https://www.politico.com/rss/politics.xml", "Politico", "Politics", "us", ["USA","Politics"]),
  () => fetchAndParseXmlFeed("https://www.theguardian.com/politics/rss", "Guardian Politics", "Politics", "uk", ["UK","Politics"]),
  () => fetchAndParseXmlFeed("https://www.euronews.com/news/politics/rss", "Euronews Politics", "Politics", "eu", ["EU","Politics"]),
  () => fetchAndParseXmlFeed("https://www.lemonde.fr/politique/rss_full.xml", "Le Monde Politics", "Politics", "fr", ["France","Politics"]),
  () => fetchAndParseXmlFeed("https://themoscowtimes.com/feeds/rss/politics", "MoscowTimes Politics", "Politics", "ru", ["Russia","Politics"]),
  () => fetchAndParseXmlFeed("http://www.chinadaily.com.cn/rss/politics.xml", "ChinaDaily Politics", "Politics", "cn", ["China","Politics"]),
  () => fetchAndParseXmlFeed("https://vnexpress.net/rss/thoi-su.rss", "VNExpress Politics", "Politics", "vn", ["Vietnam","Politics"]),
];

// --- Science ---
const fetchers_Science = [
  () => fetchAndParseXmlFeed("https://www.nature.com/nature.rss", "Nature", "Science", "global", ["Research"]),
  () => fetchAndParseXmlFeed("https://www.sciencemag.org/rss/news_current.xml", "Science Magazine", "Science", "us", ["Science"]),
  () => fetchAndParseXmlFeed("https://www.newscientist.com/feed/home/", "New Scientist", "Science", "uk", ["Science"]),
  () => fetchAndParseXmlFeed("https://www.euronews.com/science/rss", "Euronews Science", "Science", "eu", ["Science"]),
  () => fetchAndParseXmlFeed("https://www.cnrs.fr/en/rss", "CNRS News", "Science", "fr", ["France","Science"]),
  () => fetchAndParseXmlFeed("https://tass.com/rss/science.xml", "TASS Science", "Science", "ru", ["Russia","Science"]),
  () => fetchAndParseXmlFeed("https://www.chinadaily.com.cn/rss/science.xml", "ChinaDaily Science", "Science", "cn", ["China","Science"]),
  () => fetchAndParseXmlFeed("https://vnexpress.net/rss/khoa-hoc.rss", "VNExpress Science", "Science", "vn", ["Vietnam","Science"]),
];

// --- Sneakers ---
const fetchers_Sneakers = [
  () => fetchAndParseXmlFeed("https://sneakernews.com/feed/", "Sneaker News", "Sneakers", "us", ["Shoes", "Fashion"]),
  () => fetchAndParseXmlFeed("https://hypebeast.com/feed/category/footwear", "Hypebeast Sneakers", "Sneakers", "global", ["Shoes", "Fashion"]),
];

// --- Sports ---
const fetchers_Sports = [
  () => fetchAndParseXmlFeed("https://www.espn.com/espn/rss/news", "ESPN", "Sports", "us", ["Sports"]),
  () => fetchAndParseXmlFeed("https://www.skysports.com/rss/12040", "Sky Sports", "Sports", "uk", ["Sports"]),
  () => fetchAndParseXmlFeed("https://www.euronews.com/sport/rss", "Euronews Sport", "Sports", "eu", ["Sports"]),
  () => fetchAndParseXmlFeed("https://www.lequipe.fr/rss/actu_rss.xml", "L’Équipe", "Sports", "fr", ["France","Sports"]),
  () => fetchAndParseXmlFeed("https://www.sport-express.ru/services/materials/news/", "Sport-Express", "Sports", "ru", ["Russia","Sports"]),
  () => fetchAndParseXmlFeed("http://www.xinhuanet.com/english/rss/sportsrss.xml", "Xinhua Sports", "Sports", "cn", ["China","Sports"]),
  () => fetchAndParseXmlFeed("https://vnexpress.net/rss/the-thao.rss", "VNExpress Sports", "Sports", "vn", ["Vietnam","Sports"]),
];

// --- Technology ---
const fetchers_Technology = [
  () => fetchAndParseXmlFeed("https://techcrunch.com/feed/", "TechCrunch", "Technology", "us", ["Tech","Startups"]),
  () => fetchAndParseXmlFeed("https://www.wired.com/feed/rss", "Wired", "Technology", "us", ["Tech","Innovation"]),
  () => fetchAndParseXmlFeed("https://www.techradar.com/rss", "TechRadar", "Technology", "uk", ["Tech"]),
  () => fetchAndParseXmlFeed("https://digital-strategy.ec.europa.eu/en/news/rss.xml", "EU Digital Strategy", "Technology", "eu", ["EU","Tech"]),
  () => fetchAndParseXmlFeed("https://www.usine-digitale.fr/rss", "L’Usine Digitale", "Technology", "fr", ["France","Tech"]),
  () => fetchAndParseXmlFeed("https://www.tadviser.ru/index.php?title=Special:NewsFeed&feed=rss", "TAdviser", "Technology", "ru", ["Russia","Tech"]),
  () => fetchAndParseXmlFeed("https://pandaily.com/feed/", "Pandaily", "Technology", "cn", ["China","Tech"]),
  () => fetchAndParseXmlFeed("https://vnexpress.net/rss/so-hoa.rss", "VNExpress Technology", "Technology", "vn", ["Vietnam","Tech"]),
];

// --- Travel ---
const fetchers_Travel = [
  () => fetchAndParseXmlFeed("https://www.cntraveler.com/feed/rss", "Condé Nast Traveler", "Travel", "us", ["Travel"]),
  () => fetchAndParseXmlFeed("https://www.lonelyplanet.com/news/feed", "Lonely Planet", "Travel", "uk", ["Travel"]),
  () => fetchAndParseXmlFeed("https://www.euronews.com/travel/rss", "Euronews Travel", "Travel", "eu", ["Travel"]),
  () => fetchAndParseXmlFeed("https://www.france24.com/en/rss", "France24 Travel", "Travel", "fr", ["France","Travel"]),
  () => fetchAndParseXmlFeed("https://tass.com/rss/travel.xml", "TASS Travel", "Travel", "ru", ["Russia","Travel"]),
  () => fetchAndParseXmlFeed("https://www.chinadaily.com.cn/rss/travel.xml", "ChinaDaily Travel", "Travel", "cn", ["China","Travel"]),
  () => fetchAndParseXmlFeed("https://dulich.vnexpress.net/rss", "VNExpress Travel", "Travel", "vn", ["Vietnam","Travel"]),
];

// --- Toys ---
const fetchers_Toys = [
  () => fetchAndParseXmlFeed("https://toynewsinternational.com/rss.php", "Toy News International", "Toys", "us", ["Toys"]),
  () => fetchAndParseXmlFeed("https://toybook.com/feed/", "The Toy Book", "Toys", "us", ["Toys"]),
  () => fetchAndParseXmlFeed("https://toyworldmag.co.uk/feed/", "Toy World Magazine", "Toys", "uk", ["Toys"]),
  () => fetchAndParseXmlFeed("https://kidscreen.com/feed/", "Kidscreen", "Toys", "global", ["Kids", "Entertainment"]),
  () => fetchAndParseXmlFeed("https://www.russpress.ru/rss", "RussPress Toys", "Toys", "ru", ["Russia","Toys"]),
  () => fetchAndParseXmlFeed("https://www.chinatoy.org/rss", "China Toy", "Toys", "cn", ["China","Toys"]),
  () => fetchAndParseXmlFeed("https://vnexpress.net/rss/gia-dinh.rss", "VNExpress Toy", "Toys", "vn", ["Vietnam","Toys"]),
];


exports.handler = builder(async (event, context) => { 
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
    // Collect all fetcher functions from categorized arrays
    const allSources = [
      ...fetchers_AI,
      ...fetchers_Archaeology,
      ...fetchers_Beauty,
      ...fetchers_Business,
      ...fetchers_Cars,
      ...fetchers_Cybersecurity,
      ...fetchers_Education,
      ...fetchers_Entertainment,
      ...fetchers_Environment,
      ...fetchers_Family,
      ...fetchers_Fashion,
      ...fetchers_Finance,
      ...fetchers_Food,
      ...fetchers_Gaming,
      ...fetchers_Healthcare,
      ...fetchers_Lifestyle,
      ...fetchers_Music,
      ...fetchers_News,
      ...fetchers_Politics,
      ...fetchers_Science,
      ...fetchers_Sneakers,
      ...fetchers_Sports,
      ...fetchers_Technology,
      ...fetchers_Travel,
      ...fetchers_Toys,
    ];

    const results = await Promise.allSettled(allSources.map(f => f())); // Map to call each function
    
    let allFetchedTrends = [];
    for (const r of results) {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        allFetchedTrends.push(...r.value);
      } else if (r.status === "rejected") {
        console.warn(`Builder Function - A source failed: ${r.reason?.message || r.reason}`);
      }
    }

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
        body: JSON.stringify({ success: true, trends: [], message: "No trends found from any source for builder." }),
      };
    }

    // Preprocess trends here once for the master list before caching
    const maxViews = Math.max(1, ...allFetchedTrends.map(t => t.views || 0));
    const maxInteractions = Math.max(1, ...allFetchedTrends.map(t => t.interactions || 0));
    const maxSearches = Math.max(1, ...allFetchedTrends.map(t => t.searches || 0));
    const maxVotes = Math.max(1, ...allFetchedTrends.map(t => t.votes || 0));

    const maxValuesForHotness = {
        views: maxViews,
        interactions: maxInteractions,
        searches: maxSearches,
        votes: maxVotes,
    };

    const preprocessedTrends = allFetchedTrends.map(trend => {
        return {
            ...trend,
            hotnessScore: calculateHotnessScore(trend, maxValuesForHotness),
            type: trend.type || (Math.random() > 0.5 ? 'topic' : 'query')
        };
    });


    const sortedTrends = preprocessedTrends
      .filter(Boolean)
      .sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));

    return {
      statusCode: 200,
      headers: {
        ...headers,
        "Cache-Control": "public, max-age=3600, must-revalidate", // Cache for 1 hour (3600 seconds)
      },
      body: JSON.stringify({ success: true, trends: sortedTrends }),
    };
  } catch (err) {
    console.error("trends-builder handler error (caught):", err); // Log the actual error
    return {
      statusCode: 500,
      headers: {
        ...headers,
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate", // Don't cache errors
      },
      body: JSON.stringify({ success: false, error: "Failed to fetch trends", message: `Builder internal error: ${err.message}` }), // Provide more info
    };
  }
});
