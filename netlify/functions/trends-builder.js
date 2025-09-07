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

// ===================== AUTO-GENERATED FEED FETCHERS (Alphabetical blocks A→Z) =====================
// Each function follows the pattern:
// const fetchSourceName = () => fetchAndParseXmlFeed("URL", "Source Name", "Category", "country_code", ["Tag1","Tag2"]);

// --------------------- A: AI ---------------------
const fetchVentureBeatAI = () =>
  fetchAndParseXmlFeed("https://venturebeat.com/feed/", "VentureBeat AI", "AI", "us", ["VentureBeat","AI"]);
const fetchMITTechReviewAI = () =>
  fetchAndParseXmlFeed("https://www.technologyreview.com/feed/", "MIT Technology Review", "AI", "us", ["AI","Research"]);

const fetchGuardianAI = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/technology/ai/rss", "Guardian AI", "AI", "uk", ["UK","AI"]);
const fetchFTTechAI = () =>
  fetchAndParseXmlFeed("https://www.ft.com/technology?format=rss", "FT Tech (AI)", "AI", "uk", ["UK","AI"]);

const fetchEuronewsNextAI = () =>
  fetchAndParseXmlFeed("https://www.euronews.com/next/rss", "Euronews Next (AI)", "AI", "eu", ["EU","AI"]);
const fetchEUDigitalAI = () =>
  fetchAndParseXmlFeed("https://digital-strategy.ec.europa.eu/en/news/rss.xml", "EU Digital Strategy", "AI", "eu", ["EU","AI"]);

const fetchLeMondeAI = () =>
  fetchAndParseXmlFeed("https://www.lemonde.fr/technologies/rss_full.xml", "Le Monde Tech/AI", "AI", "fr", ["France","AI"]);
const fetchNumeramaAI = () =>
  fetchAndParseXmlFeed("https://www.numerama.com/feed/", "Numerama AI", "AI", "fr", ["France","AI"]);

const fetchTAdviserAI = () =>
  fetchAndParseXmlFeed("https://www.tadviser.ru/index.php?title=Special:NewsFeed&feed=rss", "TAdviser Russia", "AI", "ru", ["Russia","AI"]);
const fetchCNewsAI = () =>
  fetchAndParseXmlFeed("https://www.cnews.ru/inc/rss/news.xml", "CNews Russia Tech/AI", "AI", "ru", ["Russia","AI"]);

const fetchSyncedReviewAI = () =>
  fetchAndParseXmlFeed("https://syncedreview.com/feed/", "Synced Review", "AI", "cn", ["China","AI"]);
const fetchTechNodeAI = () =>
  fetchAndParseXmlFeed("https://technode.com/feed/", "TechNode AI", "AI", "cn", ["China","AI"]);

// --------------------- A: Archaeology ---------------------
const fetchArchaeologyMag = () =>
  fetchAndParseXmlFeed("https://www.archaeology.org/rss.xml", "Archaeology Magazine", "Archaeology", "us", ["Archaeology"]);
const fetchSmithsonianHistory = () =>
  fetchAndParseXmlFeed("https://www.smithsonianmag.com/history/feed/", "Smithsonian History", "Archaeology", "us", ["History","Archaeology"]);

const fetchCurrentArchaeology = () =>
  fetchAndParseXmlFeed("https://www.archaeology.co.uk/feed", "Current Archaeology", "Archaeology", "uk", ["Archaeology"]);
const fetchPastHorizons = () =>
  fetchAndParseXmlFeed("http://www.pasthorizonspr.com/index.php/feed", "Past Horizons", "Archaeology", "uk", ["Archaeology"]);

const fetchHeritageDaily = () =>
  fetchAndParseXmlFeed("https://www.heritagedaily.com/category/archaeology/feed", "HeritageDaily", "Archaeology", "eu", ["Archaeology"]);
const fetchAncientOrigins = () =>
  fetchAndParseXmlFeed("https://www.ancient-origins.net/feed", "Ancient Origins", "Archaeology", "eu", ["Archaeology"]);

const fetchHeritageFR = () =>
  fetchAndParseXmlFeed("https://www.culture.gouv.fr/Feeds.rss", "French Heritage", "Archaeology", "fr", ["France","Heritage"]);
const fetchLeMondeHistory = () =>
  fetchAndParseXmlFeed("https://www.lemonde.fr/series/rss_full.xml", "Le Monde History", "Archaeology", "fr", ["France","History"]);

const fetchHeritageRU = () =>
  fetchAndParseXmlFeed("https://www.heritagedaily.com/rss", "HeritageDaily RU", "Archaeology", "ru", ["Russia","Archaeology"]);
const fetchPastRU = () =>
  fetchAndParseXmlFeed("https://ancient-origins.ru/feed", "Ancient Origins RU", "Archaeology", "ru", ["Russia","Archaeology"]);

const fetchChinaHeritage = () =>
  fetchAndParseXmlFeed("https://www.chinahistory.net/rss", "China Heritage", "Archaeology", "cn", ["China","Archaeology"]);
const fetchCulturalChina = () =>
  fetchAndParseXmlFeed("https://www.chinaculture.org/rss", "China Culture", "Archaeology", "cn", ["China","Archaeology"]);

// --------------------- B: Business ---------------------
const fetchWSJBusiness = () =>
  fetchAndParseXmlFeed("https://feeds.a.dj.com/rss/RSSWorldNews.xml", "Wall Street Journal", "Business", "us", ["WSJ","Business"]);
const fetchBloombergBiz = () =>
  fetchAndParseXmlFeed("https://www.bloomberg.com/feed/podcast/etf-report.xml", "Bloomberg Business", "Business", "global", ["Markets","Business"]);

const fetchFinancialTimesBiz = () =>
  fetchAndParseXmlFeed("https://www.ft.com/?format=rss", "Financial Times", "Business", "uk", ["Finance","Business"]);
const fetchCityAMBiz = () =>
  fetchAndParseXmlFeed("https://www.cityam.com/feed/", "City A.M.", "Business", "uk", ["Business"]);

const fetchReutersBusiness = () =>
  fetchAndParseXmlFeed("https://feeds.reuters.com/reuters/businessNews", "Reuters Business", "Business", "eu", ["Business"]);
const fetchEuronewsBusiness = () =>
  fetchAndParseXmlFeed("https://www.euronews.com/business/rss", "Euronews Business", "Business", "eu", ["Business"]);

const fetchLesEchosBiz = () =>
  fetchAndParseXmlFeed("https://www.lesechos.fr/rss", "Les Echos", "Business", "fr", ["France","Business"]);
const fetchBFMBusiness = () =>
  fetchAndParseXmlFeed("https://bfmbusiness.bfmtv.com/rss", "BFM Business", "Business", "fr", ["France","Business"]);

const fetchRBCBiz = () =>
  fetchAndParseXmlFeed("https://rssexport.rbc.ru/rbcnews/business/index.rss", "RBC Business", "Business", "ru", ["Russia","Business"]);
const fetchKommersantBiz = () =>
  fetchAndParseXmlFeed("https://www.kommersant.ru/RSS/business.xml", "Kommersant Business", "Business", "ru", ["Russia","Business"]);

const fetchCaixinBiz = () =>
  fetchAndParseXmlFeed("https://www.caixinglobal.com/rss", "Caixin", "Business", "cn", ["China","Business"]);
const fetchChinaDailyBiz = () =>
  fetchAndParseXmlFeed("https://www.chinadaily.com.cn/rss/cnews.xml", "ChinaDaily Business", "Business", "cn", ["China","Business"]);

const fetchCafeFBiz = () =>
  fetchAndParseXmlFeed("https://cafef.vn/trang-chu.rss", "CafeF", "Business", "vn", ["Vietnam","Business"]);
const fetchVietstockBiz = () =>
  fetchAndParseXmlFeed("https://vietstock.vn/rss/home.rss", "Vietstock", "Business", "vn", ["Vietnam","Business"]);

// --------------------- C: Cars ---------------------
const fetchCarAndDriver = () =>
  fetchAndParseXmlFeed("https://www.caranddriver.com/rss/all.xml/", "Car and Driver", "Cars", "us", ["Cars"]);
const fetchMotorTrend = () =>
  fetchAndParseXmlFeed("https://www.motortrend.com/feed/", "MotorTrend", "Cars", "us", ["Cars"]);

const fetchTopGear = () =>
  fetchAndParseXmlFeed("https://www.topgear.com/feeds/all/rss.xml", "Top Gear", "Cars", "uk", ["Cars"]);
const fetchAutocar = () =>
  fetchAndParseXmlFeed("https://www.autocar.co.uk/rss", "Autocar", "Cars", "uk", ["Cars"]);

const fetchAutoExpress = () =>
  fetchAndParseXmlFeed("https://www.autoexpress.co.uk/rss", "Auto Express", "Cars", "eu", ["Cars"]);
const fetchAutonewsEU = () =>
  fetchAndParseXmlFeed("https://europe.autonews.com/rss", "Autonews Europe", "Cars", "eu", ["Cars"]);

const fetchLArgus = () =>
  fetchAndParseXmlFeed("https://www.largus.fr/rss.xml", "L'Argus", "Cars", "fr", ["France","Cars"]);
const fetchAutoMotoFR = () =>
  fetchAndParseXmlFeed("https://www.auto-moto.com/rss", "Auto-Moto", "Cars", "fr", ["France","Cars"]);

const fetchKolesa = () =>
  fetchAndParseXmlFeed("https://kolesa.ru/rss", "Kolesa.ru", "Cars", "ru", ["Russia","Cars"]);
const fetchDriveRu = () =>
  fetchAndParseXmlFeed("https://www.drive.ru/rss", "Drive.ru", "Cars", "ru", ["Russia","Cars"]);

const fetchAutohome = () =>
  fetchAndParseXmlFeed("https://www.autohome.com.cn/rss", "Autohome", "Cars", "cn", ["China","Cars"]);
const fetchSinaAuto = () =>
  fetchAndParseXmlFeed("https://auto.sina.com.cn/rss.xml", "Sina Auto", "Cars", "cn", ["China","Cars"]);

const fetchVNExpressAuto = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/oto-xe-may.rss", "VNExpress Auto", "Cars", "vn", ["Vietnam","Cars"]);
const fetchOtoFun = () =>
  fetchAndParseXmlFeed("https://otofun.net/rss", "OtoFun", "Cars", "vn", ["Vietnam","Cars"]);

// --------------------- C: Cybersecurity ---------------------
const fetchKrebsOnSecurity = () =>
  fetchAndParseXmlFeed("https://krebsonsecurity.com/feed/", "Krebs on Security", "Cybersecurity", "us", ["Security"]);
const fetchThreatpost = () =>
  fetchAndParseXmlFeed("https://threatpost.com/feed/", "Threatpost", "Cybersecurity", "us", ["Security"]);

const fetchSCMagUK = () =>
  fetchAndParseXmlFeed("https://www.scmagazineuk.com/rss", "SC Magazine UK", "Cybersecurity", "uk", ["Security"]);
const fetchInfosecurityMag = () =>
  fetchAndParseXmlFeed("https://www.infosecurity-magazine.com/rss/news/", "Infosecurity Magazine", "Cybersecurity", "uk", ["Security"]);

const fetchZDNetSecurity = () =>
  fetchAndParseXmlFeed("https://www.zdnet.com/topic/security/rss.xml", "ZDNet Security", "Cybersecurity", "eu", ["Security"]);
const fetchTheRegisterSecurity = () =>
  fetchAndParseXmlFeed("https://www.theregister.com/security/headlines.atom", "The Register Security", "Cybersecurity", "eu", ["Security"]);

const fetchLeMagSecu = () =>
  fetchAndParseXmlFeed("https://www.zdnet.fr/rss/actualites/", "ZDNet France (Security)", "Cybersecurity", "fr", ["France","Security"]);
const fetchSecuriteInfo = () =>
  fetchAndParseXmlFeed("https://www.ssi.gouv.fr/feed/", "ANSSI / SSI France", "Cybersecurity", "fr", ["France","Security"]);

const fetchKasperskySec = () =>
  fetchAndParseXmlFeed("https://www.kaspersky.com/blog/rss", "Kaspersky Lab Blog", "Cybersecurity", "ru", ["Russia","Security"]);
const fetchHabrSec = () =>
  fetchAndParseXmlFeed("https://habr.com/en/rss/all/all/?fl=ru", "Habr Security", "Cybersecurity", "ru", ["Russia","Security"]);

const fetchCNcert = () =>
  fetchAndParseXmlFeed("https://www.cert.org.cn/rss", "CN-CERT", "Cybersecurity", "cn", ["China","Security"]);
const fetchChinaSecurity = () =>
  fetchAndParseXmlFeed("https://www.china.com.cn/rss/security.xml", "China Security", "Cybersecurity", "cn", ["China","Security"]);

const fetchVNExpressCyber = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/so-hoa.rss", "VNExpress Cyber", "Cybersecurity", "vn", ["Vietnam","Security"]);
const fetchBkavNews = () =>
  fetchAndParseXmlFeed("https://bkav.com.vn/rss", "Bkav News", "Cybersecurity", "vn", ["Vietnam","Security"]);

// --------------------- E: Education ---------------------
const fetchChronicleHigherEd = () =>
  fetchAndParseXmlFeed("https://www.chronicle.com/feed", "Chronicle of Higher Education", "Education", "us", ["Education"]);
const fetchInsideHigherEd = () =>
  fetchAndParseXmlFeed("https://www.insidehighered.com/rss/news", "Inside Higher Ed", "Education", "us", ["Education"]);

const fetchTimesHigherEducation = () =>
  fetchAndParseXmlFeed("https://www.timeshighereducation.com/rss", "Times Higher Education", "Education", "uk", ["Education"]);
const fetchGuardianEducation = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/education/rss", "Guardian Education", "Education", "uk", ["Education"]);

const fetchUniversityWorldNews = () =>
  fetchAndParseXmlFeed("https://www.universityworldnews.com/rss/", "University World News", "Education", "eu", ["Education"]);
const fetchEurydiceNews = () =>
  fetchAndParseXmlFeed("https://eacea.ec.europa.eu/education/european-policy/feeds_en", "Eurydice / EACEA", "Education", "eu", ["Education"]);

const fetchLeFigaroEducation = () =>
  fetchAndParseXmlFeed("https://www.lefigaro.fr/rss/le-figaro-education.xml", "Le Figaro Education", "Education", "fr", ["France","Education"]);
const fetchEducPros = () =>
  fetchAndParseXmlFeed("https://www.letudiant.fr/educpros.rss", "EducPros", "Education", "fr", ["France","Education"]);

const fetchTasseEducation = () =>
  fetchAndParseXmlFeed("https://tass.com/rss/education.xml", "TASS Education", "Education", "ru", ["Russia","Education"]);
const fetchRussianUniNews = () =>
  fetchAndParseXmlFeed("https://www.russia.edu/feed", "Russian Uni News", "Education", "ru", ["Russia","Education"]);

const fetchChinaEducation = () =>
  fetchAndParseXmlFeed("https://www.chinadaily.com.cn/rss/education.xml", "ChinaDaily Education", "Education", "cn", ["China","Education"]);
const fetchGlobalTimesEducation = () =>
  fetchAndParseXmlFeed("https://www.globaltimes.cn/rss/education.xml", "Global Times Education", "Education", "cn", ["China","Education"]);

const fetchTuoiTreEducation = () =>
  fetchAndParseXmlFeed("https://tuoitre.vn/rss/giao-duc.rss", "Tuổi Trẻ Education", "Education", "vn", ["Vietnam","Education"]);
const fetchVnExpressEducation = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/giao-duc.rss", "VNExpress Education", "Education", "vn", ["Vietnam","Education"]);

// --------------------- E: Entertainment ---------------------
const fetchVariety = () =>
  fetchAndParseXmlFeed("https://variety.com/feed/", "Variety", "Entertainment", "us", ["Entertainment"]);
const fetchHollywoodReporter = () =>
  fetchAndParseXmlFeed("https://www.hollywoodreporter.com/t/feed/", "Hollywood Reporter", "Entertainment", "us", ["Entertainment"]);

const fetchNME = () =>
  fetchAndParseXmlFeed("https://www.nme.com/feed", "NME", "Entertainment", "uk", ["Entertainment"]);
const fetchMetroEntertainment = () =>
  fetchAndParseXmlFeed("https://metro.co.uk/entertainment/feed/", "Metro Entertainment", "Entertainment", "uk", ["Entertainment"]);

const fetchEuronewsCulture = () =>
  fetchAndParseXmlFeed("https://www.euronews.com/culture/rss", "Euronews Culture", "Entertainment", "eu", ["Culture"]);
const fetchPoliticoEuropeCulture = () =>
  fetchAndParseXmlFeed("https://www.politico.eu/feed/culture/", "Politico Europe Culture", "Entertainment", "eu", ["Culture"]);

const fetchAllocine = () =>
  fetchAndParseXmlFeed("http://rss.allocine.fr/ac/actualites/cine", "Allociné", "Entertainment", "fr", ["France","Entertainment"]);
const fetchLeFigaroCulture = () =>
  fetchAndParseXmlFeed("https://www.lefigaro.fr/rss/figaro_culture.xml", "Le Figaro Culture", "Entertainment", "fr", ["France","Entertainment"]);

const fetchKinoTeatr = () =>
  fetchAndParseXmlFeed("https://www.kino-teatr.ru/rss/news.rss", "Kino-Teatr.ru", "Entertainment", "ru", ["Russia","Entertainment"]);
const fetchRussiaCulture = () =>
  fetchAndParseXmlFeed("https://www.culture.ru/rss", "Russia Culture", "Entertainment", "ru", ["Russia","Entertainment"]);

const fetchSixthToneCulture = () =>
  fetchAndParseXmlFeed("https://www.sixthtone.com/rss", "Sixth Tone Culture", "Entertainment", "cn", ["China","Entertainment"]);
const fetchGlobalTimesEntertainment = () =>
  fetchAndParseXmlFeed("https://www.globaltimes.cn/rss/entertainment.xml", "Global Times Entertainment", "Entertainment", "cn", ["China","Entertainment"]);

const fetchZingNewsEntertainment = () =>
  fetchAndParseXmlFeed("https://zingnews.vn/rss/giai-tri.rss", "ZingNews Entertainment", "Entertainment", "vn", ["Vietnam","Entertainment"]);
const fetchVnExpressEntertainment = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/giai-tri.rss", "VNExpress Entertainment", "Entertainment", "vn", ["Vietnam","Entertainment"]);

// --------------------- E: Environment ---------------------
const fetchNatGeoEnvironment = () =>
  fetchAndParseXmlFeed("https://www.nationalgeographic.com/content/natgeo/en_us/rss/index.rss", "National Geographic", "Environment", "us", ["Nature"]);
const fetchEPAnews = () =>
  fetchAndParseXmlFeed("https://www.epa.gov/newsreleases/rss.xml", "EPA News", "Environment", "us", ["USA","Environment"]);

const fetchGuardianEnvironment = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/uk/environment/rss", "Guardian Environment", "Environment", "uk", ["UK","Environment"]);
const fetchBBCEnvironment = () =>
  fetchAndParseXmlFeed("http://feeds.bbci.co.uk/news/science_and_environment/rss.xml", "BBC Environment", "Environment", "uk", ["UK","Environment"]);

const fetchEuractivEnvironment = () =>
  fetchAndParseXmlFeed("https://www.euractiv.com/section/climate-environment/feed/", "Euractiv Environment", "Environment", "eu", ["EU","Environment"]);
const fetchUNEP = () =>
  fetchAndParseXmlFeed("https://www.unep.org/rss.xml", "UN Environment", "Environment", "eu", ["Environment"]);

const fetchLeMondeEnvironment = () =>
  fetchAndParseXmlFeed("https://www.lemonde.fr/en/environment/rss_full.xml", "Le Monde Environment", "Environment", "fr", ["France","Environment"]);
const fetchActuEnvironnement = () =>
  fetchAndParseXmlFeed("https://www.actu-environnement.com/rss.xml", "Actu-Environnement", "Environment", "fr", ["France","Environment"]);

const fetchTASSEnvironment = () =>
  fetchAndParseXmlFeed("https://tass.com/rss/environment.xml", "TASS Environment", "Environment", "ru", ["Russia","Environment"]);
const fetchRiaEnvironment = () =>
  fetchAndParseXmlFeed("https://ria.ru/export/rss2/environment.xml", "RIA Environment", "Environment", "ru", ["Russia","Environment"]);

const fetchChinaEnvironment = () =>
  fetchAndParseXmlFeed("https://www.chinadaily.com.cn/rss/environment.xml", "ChinaDaily Environment", "Environment", "cn", ["China","Environment"]);
const fetchCaixinEnvironment = () =>
  fetchAndParseXmlFeed("https://www.caixinglobal.com/rss", "Caixin Environment", "Environment", "cn", ["China","Environment"]);

const fetchVnExpressEnvironment = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/khoa-hoc.rss", "VNExpress Environment", "Environment", "vn", ["Vietnam","Environment"]);
const fetchMoitruongVn = () =>
  fetchAndParseXmlFeed("https://moitruongvietnam.vn/rss", "Moitruong Vietnam", "Environment", "vn", ["Vietnam","Environment"]);

// --------------------- F: Family ---------------------
const fetchParentsCom = () =>
  fetchAndParseXmlFeed("https://www.parents.com/rss/", "Parents.com", "Family", "us", ["Parenting","Family"]);
const fetchFamilyToday = () =>
  fetchAndParseXmlFeed("https://www.familymagazine.com/rss", "Family Magazine", "Family", "us", ["Family"]);

const fetchMotherAndBaby = () =>
  fetchAndParseXmlFeed("https://www.motherandbaby.co.uk/rss", "Mother & Baby", "Family", "uk", ["Family"]);
const fetchNetMums = () =>
  fetchAndParseXmlFeed("https://www.netmums.com/rss", "Netmums", "Family", "uk", ["Family"]);

const fetchEuroParent = () =>
  fetchAndParseXmlFeed("https://www.parenting.com/feed", "Parenting.com", "Family", "eu", ["Family"]);
const fetchFamilyEurope = () =>
  fetchAndParseXmlFeed("https://www.family.eu/rss", "Family EU", "Family", "eu", ["Family"]);

const fetchMagicMaman = () =>
  fetchAndParseXmlFeed("https://www.magicmaman.com/rss.xml", "MagicMaman", "Family", "fr", ["France","Family"]);
const fetchParentsFR = () =>
  fetchAndParseXmlFeed("https://www.parents.fr/rss", "Parents.fr", "Family", "fr", ["France","Family"]);

const fetchParentsRU = () =>
  fetchAndParseXmlFeed("https://www.mamsy.ru/rss", "Mamsy", "Family", "ru", ["Russia","Family"]);
const fetchDetiMail = () =>
  fetchAndParseXmlFeed("https://deti.mail.ru/rss", "Deti.Mail.ru", "Family", "ru", ["Russia","Family"]);

const fetchBabyTree = () =>
  fetchAndParseXmlFeed("https://www.babytree.com/rss", "BabyTree", "Family", "cn", ["China","Family"]);
const fetchParentingChina = () =>
  fetchAndParseXmlFeed("https://www.jiemian.com/rss/parenting.xml", "Jiemian Parenting", "Family", "cn", ["China","Family"]);

const fetchAfamilyFamily = () =>
  fetchAndParseXmlFeed("https://afamily.vn/rss/home.rss", "Afamily Family", "Family", "vn", ["Vietnam","Family"]);
const fetchMeoHay = () =>
  fetchAndParseXmlFeed("https://meohay.vn/rss", "MeoHay", "Family", "vn", ["Vietnam","Family"]);

// --------------------- F: Fashion ---------------------
const fetchVogue = () =>
  fetchAndParseXmlFeed("https://www.vogue.com/feed/rss", "Vogue", "Fashion", "us", ["Fashion","Beauty"]);
const fetchElle = () =>
  fetchAndParseXmlFeed("https://www.elle.com/rss/all.xml", "Elle", "Fashion", "us", ["Fashion"]);

const fetchHarperBazaar = () =>
  fetchAndParseXmlFeed("https://www.harpersbazaar.com/rss/all.xml", "Harper's Bazaar", "Fashion", "uk", ["Fashion"]);
const fetchDazed = () =>
  fetchAndParseXmlFeed("https://www.dazeddigital.com/rss.xml", "Dazed", "Fashion", "uk", ["Lifestyle"]);

const fetchHighsnobiety = () =>
  fetchAndParseXmlFeed("https://www.highsnobiety.com/feed", "Highsnobiety", "Fashion", "eu", ["Fashion"]);
const fetchRefinery29 = () =>
  fetchAndParseXmlFeed("https://www.refinery29.com/en-us/feed", "Refinery29", "Fashion", "eu", ["Lifestyle"]);

const fetchLeMondeStyles = () =>
  fetchAndParseXmlFeed("https://www.lemonde.fr/m-styles/rss_full.xml", "Le Monde Styles", "Fashion", "fr", ["France","Fashion"]);
const fetchGraziaFR = () =>
  fetchAndParseXmlFeed("https://www.grazia.fr/rss", "Grazia France", "Fashion", "fr", ["France","Fashion"]);

const fetchGQ = () =>
  fetchAndParseXmlFeed("https://www.gq.com/rss", "GQ", "Fashion", "us", ["Fashion"]);
const fetchHypebeast = () =>
  fetchAndParseXmlFeed("https://hypebeast.com/feed", "Hypebeast", "Fashion", "global", ["Fashion"]);

// --------------------- F: Finance ---------------------
const fetchYahooFinance = () =>
  fetchAndParseXmlFeed("https://finance.yahoo.com/news/rss", "Yahoo Finance", "Finance", "us", ["Finance"]);
const fetchCNBCFinance = () =>
  fetchAndParseXmlFeed("https://www.cnbc.com/id/10000664/device/rss/rss.html", "CNBC Finance", "Finance", "us", ["Finance"]);

const fetchFinancialTimes = () =>
  fetchAndParseXmlFeed("https://www.ft.com/?format=rss", "Financial Times", "Finance", "uk", ["Finance"]);
const fetchCityAM = () =>
  fetchAndParseXmlFeed("https://www.cityam.com/feed/", "City A.M.", "Finance", "uk", ["Finance"]);

const fetchReutersFinance = () =>
  fetchAndParseXmlFeed("https://feeds.reuters.com/reuters/businessNews", "Reuters Business", "Finance", "eu", ["Finance"]);
const fetchEuronewsFinance = () =>
  fetchAndParseXmlFeed("https://www.euronews.com/business/rss", "Euronews Business", "Finance", "eu", ["Finance"]);

const fetchLesEchos = () =>
  fetchAndParseXmlFeed("https://www.lesechos.fr/rss", "Les Echos", "Finance", "fr", ["France","Finance"]);
const fetchBFMBusiness = () =>
  fetchAndParseXmlFeed("https://bfmbusiness.bfmtv.com/rss", "BFM Business", "Finance", "fr", ["France","Finance"]);

const fetchKommersantBusiness = () =>
  fetchAndParseXmlFeed("https://www.kommersant.ru/RSS/news.xml", "Kommersant Business", "Finance", "ru", ["Russia","Finance"]);
const fetchRBCBusiness = () =>
  fetchAndParseXmlFeed("https://rssexport.rbc.ru/rbcnews/news/30/full.rss", "RBC Business", "Finance", "ru", ["Russia","Finance"]);

const fetchCaixin = () =>
  fetchAndParseXmlFeed("https://www.caixinglobal.com/rss", "Caixin", "Finance", "cn", ["China","Finance"]);
const fetchChinaSecuritiesJournal = () =>
  fetchAndParseXmlFeed("https://www.cs.com.cn/rss/", "China Securities Journal", "Finance", "cn", ["China","Finance"]);

const fetchCafeF = () =>
  fetchAndParseXmlFeed("https://cafef.vn/trang-chu.rss", "CafeF", "Finance", "vn", ["Vietnam","Finance"]);
const fetchVietstock = () =>
  fetchAndParseXmlFeed("https://vietstock.vn/rss/home.rss", "Vietstock", "Finance", "vn", ["Vietnam","Finance"]);

// --------------------- F: Food ---------------------
const fetchBonAppetit = () =>
  fetchAndParseXmlFeed("https://www.bonappetit.com/feed/rss", "Bon Appétit", "Food", "us", ["Food"]);
const fetchEater = () =>
  fetchAndParseXmlFeed("https://www.eater.com/rss/index.xml", "Eater", "Food", "us", ["Food"]);

const fetchBBCGoodFood = () =>
  fetchAndParseXmlFeed("https://www.bbcgoodfood.com/feed/rss", "BBC Good Food", "Food", "uk", ["Food"]);
const fetchGuardianFood = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/food/rss", "Guardian Food", "Food", "uk", ["Food"]);

const fetchSeriousEats = () =>
  fetchAndParseXmlFeed("https://www.seriouseats.com/rss", "Serious Eats", "Food", "eu", ["Food"]);
const fetchSaveur = () =>
  fetchAndParseXmlFeed("https://www.saveur.com/feed/", "Saveur", "Food", "eu", ["Food"]);

const fetchCuisineAZ = () =>
  fetchAndParseXmlFeed("https://www.cuisineaz.com/rss", "CuisineAZ", "Food", "fr", ["France","Food"]);
const fetchMarmiton = () =>
  fetchAndParseXmlFeed("https://www.marmiton.org/rss.aspx", "Marmiton", "Food", "fr", ["France","Food"]);

const fetchPovarenok = () =>
  fetchAndParseXmlFeed("https://www.povarenok.ru/rss", "Povarenok", "Food", "ru", ["Russia","Food"]);
const fetchKuking = () =>
  fetchAndParseXmlFeed("https://kuking.net/rss", "Kuking", "Food", "ru", ["Russia","Food"]);

const fetchChinaDailyFood = () =>
  fetchAndParseXmlFeed("https://www.chinadaily.com.cn/rss/food.xml", "ChinaDaily Food", "Food", "cn", ["China","Food"]);
const fetchSinaFood = () =>
  fetchAndParseXmlFeed("https://food.sina.com.cn/rss.xml", "Sina Food", "Food", "cn", ["China","Food"]);

const fetchMonNgonMoiNgay = () =>
  fetchAndParseXmlFeed("https://monngonmoingay.com/feed/", "Món Ngon Mỗi Ngày", "Food", "vn", ["Vietnam","Food"]);
const fetchNgonAZ = () =>
  fetchAndParseXmlFeed("https://ngonaz.com/rss", "NgonAZ", "Food", "vn", ["Vietnam","Food"]);

// --------------------- G: Gaming ---------------------
const fetchIGNGaming = () =>
  fetchAndParseXmlFeed("https://feeds.ign.com/ign/games-all", "IGN Gaming", "Gaming", "us", ["IGN","Games"]);
const fetchPCGamer = () =>
  fetchAndParseXmlFeed("https://www.pcgamer.com/rss/", "PC Gamer", "Gaming", "us", ["PCGames"]);

const fetchEurogamer = () =>
  fetchAndParseXmlFeed("https://www.eurogamer.net/?format=rss", "Eurogamer", "Gaming", "uk", ["Games"]);
const fetchVG247 = () =>
  fetchAndParseXmlFeed("https://www.vg247.com/feed/", "VG247", "Gaming", "uk", ["Games"]);

const fetchGameK = () =>
  fetchAndParseXmlFeed("https://gamek.vn/home.rss", "GameK VN", "Gaming", "vn", ["Vietnam","Games"]);
const fetchGenKGaming = () =>
  fetchAndParseXmlFeed("https://genk.vn/game.rss", "GenK Gaming", "Gaming", "vn", ["Vietnam","Games"]);

const fetchKotaku = () =>
  fetchAndParseXmlFeed("https://kotaku.com/rss", "Kotaku", "Gaming", "us", ["Games"]);
const fetchKotakuAU = () =>
  fetchAndParseXmlFeed("https://www.kotaku.com.au/feed/", "Kotaku AU", "Gaming", "eu", ["Games"]);

const fetch4Gamer = () =>
  fetchAndParseXmlFeed("https://www.4gamer.net/rss/news.xml", "4Gamer JP", "Gaming", "cn", ["Japan","Games"]);
const fetchGame4V = () =>
  fetchAndParseXmlFeed("https://game4v.com/feed", "Game4V VN", "Gaming", "vn", ["Vietnam","Games"]);

// --------------------- H: Healthcare ---------------------
const fetchMedicalNewsToday = () =>
  fetchAndParseXmlFeed("https://www.medicalnewstoday.com/rss", "Medical News Today", "Healthcare", "us", ["Health"]);
const fetchHealthline = () =>
  fetchAndParseXmlFeed("https://www.healthline.com/rss", "Healthline", "Healthcare", "us", ["Health"]);

const fetchBMJ = () =>
  fetchAndParseXmlFeed("https://www.bmj.com/rss.xml", "BMJ", "Healthcare", "uk", ["Health"]);
const fetchNHSNews = () =>
  fetchAndParseXmlFeed("https://www.england.nhs.uk/news/feed/", "NHS England News", "Healthcare", "uk", ["Health"]);

const fetchEurActivHealth = () =>
  fetchAndParseXmlFeed("https://www.euractiv.com/health/feed/", "Euractiv Health", "Healthcare", "eu", ["Europe","Health"]);
const fetchWHOnews = () =>
  fetchAndParseXmlFeed("https://www.who.int/feeds/entity/mediacentre/news/en/rss.xml", "WHO News", "Healthcare", "eu", ["Health"]);

const fetchInsermNews = () =>
  fetchAndParseXmlFeed("https://www.inserm.fr/en/news/rss", "INSERM News", "Healthcare", "fr", ["France","Health"]);
const fetchLeMondeSante = () =>
  fetchAndParseXmlFeed("https://www.lemonde.fr/sante/rss_full.xml", "Le Monde Santé", "Healthcare", "fr", ["France","Health"]);

const fetchTASSHealth = () =>
  fetchAndParseXmlFeed("https://tass.com/rss/health.xml", "TASS Health", "Healthcare", "ru", ["Russia","Health"]);
const fetchRiaHealth = () =>
  fetchAndParseXmlFeed("https://ria.ru/export/rss2/health.xml", "RIA Health", "Healthcare", "ru", ["Russia","Health"]);

const fetchChinaDailyHealth = () =>
  fetchAndParseXmlFeed("https://www.chinadaily.com.cn/rss/health.xml", "ChinaDaily Health", "Healthcare", "cn", ["China","Health"]);
const fetchCCTVhealth = () =>
  fetchAndParseXmlFeed("https://www.cctv.com/rss/health.xml", "CCTV Health", "Healthcare", "cn", ["China","Health"]);

const fetchSucKhoeDoiSong = () =>
  fetchAndParseXmlFeed("https://suckhoedoisong.vn/rss/home.rss", "Sức Khỏe & Đời Sống", "Healthcare", "vn", ["Vietnam","Health"]);
const fetchBacSiOnline = () =>
  fetchAndParseXmlFeed("https://www.bacsionline.com/feed", "BacSiOnline", "Healthcare", "vn", ["Vietnam","Health"]);

// --------------------- L: Lifestyle ---------------------
const fetchRefinery29Lifestyle = () =>
  fetchAndParseXmlFeed("https://www.refinery29.com/en-us/feed", "Refinery29", "Lifestyle", "eu", ["Lifestyle"]);
const fetchAfamilyLifestyle = () =>
  fetchAndParseXmlFeed("https://afamily.vn/rss/home.rss", "Afamily", "Lifestyle", "vn", ["Vietnam","Lifestyle"]);

const fetchParents = () =>
  fetchAndParseXmlFeed("https://www.parents.com/rss/", "Parents.com", "Lifestyle", "us", ["Family","Parenting"]);
const fetchCosmopolitan = () =>
  fetchAndParseXmlFeed("https://www.cosmopolitan.com/rss/all.xml/", "Cosmopolitan", "Lifestyle", "us", ["Lifestyle"]);

// --------------------- M: Music ---------------------
const fetchBillboard = () =>
  fetchAndParseXmlFeed("https://www.billboard.com/feed/", "Billboard", "Music", "us", ["Music"]);
const fetchPitchfork = () =>
  fetchAndParseXmlFeed("https://pitchfork.com/feed/feed-news/rss", "Pitchfork", "Music", "us", ["Music"]);

const fetchNME_Music = () =>
  fetchAndParseXmlFeed("https://www.nme.com/feed", "NME", "Music", "uk", ["Music"]);
const fetchBBCMusic = () =>
  fetchAndParseXmlFeed("https://www.bbc.co.uk/music/feeds/rss.xml", "BBC Music", "Music", "uk", ["Music"]);

const fetchEuroMusicNews = () =>
  fetchAndParseXmlFeed("https://www.euronews.com/culture/music/rss", "Euronews Music", "Music", "eu", ["Music"]);
const fetchDWMusic = () =>
  fetchAndParseXmlFeed("https://www.dw.com/en/rss.xml", "DW (Culture/Music)", "Music", "eu", ["Music"]);

const fetchLeMondeMusic = () =>
  fetchAndParseXmlFeed("https://www.lemonde.fr/culture/music.rss", "Le Monde Music", "Music", "fr", ["France","Music"]);
const fetchTeleramaMusic = () =>
  fetchAndParseXmlFeed("https://www.telerama.fr/rss/musique.rss", "Télérama Music", "Music", "fr", ["France","Music"]);

const fetchMoscowTimesMusic = () =>
  fetchAndParseXmlFeed("https://www.themoscowtimes.com/feeds/rss/culture", "MoscowTimes Culture/Music", "Music", "ru", ["Russia","Music"]);
const fetchAfishaMusic = () =>
  fetchAndParseXmlFeed("https://www.afisha.ru/rss/all/", "Afisha Music", "Music", "ru", ["Russia","Music"]);

const fetchChinaDailyMusic = () =>
  fetchAndParseXmlFeed("https://www.chinadaily.com.cn/rss/entertainment.xml", "ChinaDaily Entertainment", "Music", "cn", ["China","Music"]);
const fetchSCMPMusic = () =>
  fetchAndParseXmlFeed("https://www.scmp.com/lifestyle/entertainment/feed", "SCMP Entertainment/Music", "Music", "cn", ["China","Music"]);

const fetchAppleMusicMostPlayedVN = () =>
  fetchJsonFeed("https://rss.applemarketingtools.com/api/v2/vn/music/most-played/100/songs.json", "Apple Music Most Played VN", "Music", "vn", ["Vietnam","Music"]);
const fetchZingMusic = () =>
  fetchAndParseXmlFeed("https://zingnews.vn/rss/nhac.rss", "ZingMusic", "Music", "vn", ["Vietnam","Music"]);

// --------------------- N: News ---------------------
const fetchCNNNews = () =>
  fetchAndParseXmlFeed("http://rss.cnn.com/rss/cnn_topstories.rss", "CNN News", "News", "us", ["USA","News"]);
const fetchPoliticoNews = () =>
  fetchAndParseXmlFeed("https://www.politico.com/rss/politics.xml", "Politico News", "News", "us", ["USA","News"]);

const fetchBBCNews = () =>
  fetchAndParseXmlFeed("http://feeds.bbci.co.uk/news/rss.xml", "BBC News", "News", "uk", ["UK","News"]);
const fetchGuardianNews = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/uk/rss", "The Guardian UK", "News", "uk", ["UK","News"]);

const fetchEuronews = () =>
  fetchAndParseXmlFeed("https://www.euronews.com/rss?format=xml", "Euronews", "News", "eu", ["Europe","News"]);
const fetchPoliticoEurope = () =>
  fetchAndParseXmlFeed("https://www.politico.eu/feed/", "Politico Europe", "News", "eu", ["Europe","News"]);

const fetchFrance24News = () =>
  fetchAndParseXmlFeed("https://www.france24.com/en/rss", "France24", "News", "fr", ["France","News"]);
const fetchLeMondeNews = () =>
  fetchAndParseXmlFeed("https://www.lemonde.fr/rss/une.xml", "Le Monde News", "News", "fr", ["France","News"]);

const fetchMoscowTimes = () =>
  fetchAndParseXmlFeed("https://www.themoscowtimes.com/feeds/rss/news", "The Moscow Times", "News", "ru", ["Russia","News"]);
const fetchMeduzaNews = () =>
  fetchAndParseXmlFeed("https://meduza.io/rss/all", "Meduza News", "News", "ru", ["Russia","News"]);

const fetchChinaDaily = () =>
  fetchAndParseXmlFeed("https://www.chinadaily.com.cn/rss/cnews.xml", "China Daily", "News", "cn", ["China","News"]);
const fetchSCMPNews = () =>
  fetchAndParseXmlFeed("https://www.scmp.com/rss/91/feed", "SCMP", "News", "cn", ["China","News"]);

const fetchVnExpressNews = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/thoi-su.rss", "VnExpress News", "News", "vn", ["Vietnam","News"]);
const fetchThanhNienNews = () =>
  fetchAndParseXmlFeed("https://thanhnien.vn/rss/home.rss", "Thanh Niên News", "News", "vn", ["Vietnam","News"]);

// --------------------- P: Politics ---------------------
const fetchPolitico = () =>
  fetchAndParseXmlFeed("https://www.politico.com/rss/politics.xml", "Politico", "Politics", "us", ["USA","Politics"]);
const fetchCNNPolitics = () =>
  fetchAndParseXmlFeed("https://www.cnn.com/specials/politics/rss", "CNN Politics", "Politics", "us", ["USA","Politics"]);

const fetchGuardianPolitics = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/politics/rss", "Guardian Politics", "Politics", "uk", ["UK","Politics"]);
const fetchBBCPolitics = () =>
  fetchAndParseXmlFeed("https://www.bbc.co.uk/news/politics/rss.xml", "BBC Politics", "Politics", "uk", ["UK","Politics"]);

const fetchEuronewsPolitics = () =>
  fetchAndParseXmlFeed("https://www.euronews.com/news/politics/rss", "Euronews Politics", "Politics", "eu", ["EU","Politics"]);
const fetchPoliticoEuropePolitics = () =>
  fetchAndParseXmlFeed("https://www.politico.eu/feed/", "Politico Europe (Politics)", "Politics", "eu", ["EU","Politics"]);

const fetchLeMondePolitics = () =>
  fetchAndParseXmlFeed("https://www.lemonde.fr/politique/rss_full.xml", "Le Monde Politics", "Politics", "fr", ["France","Politics"]);
const fetchFrance24Politics = () =>
  fetchAndParseXmlFeed("https://www.france24.com/en/rss", "France24 Politics", "Politics", "fr", ["France","Politics"]);

const fetchMoscowTimesPolitics = () =>
  fetchAndParseXmlFeed("https://themoscowtimes.com/feeds/rss/politics", "MoscowTimes Politics", "Politics", "ru", ["Russia","Politics"]);
const fetchTASSPolitics = () =>
  fetchAndParseXmlFeed("https://tass.com/politics/rss", "TASS Politics", "Politics", "ru", ["Russia","Politics"]);

const fetchChinaDailyPolitics = () =>
  fetchAndParseXmlFeed("http://www.chinadaily.com.cn/rss/politics.xml", "ChinaDaily Politics", "Politics", "cn", ["China","Politics"]);
const fetchChinaDailyGlobalPolitics = () =>
  fetchAndParseXmlFeed("https://global.chinadaily.com.cn/rss/politics.xml", "ChinaDaily Global Politics", "Politics", "cn", ["China","Politics"]);

const fetchVnExpressPolitics = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/thoi-su.rss", "VNExpress Politics", "Politics", "vn", ["Vietnam","Politics"]);
const fetchVnNewsPolitics = () =>
  fetchAndParseXmlFeed("https://tuoitre.vn/rss/tin-moi-nhat.rss", "Tuổi Trẻ (Politics/News)", "Politics", "vn", ["Vietnam","Politics"]);

// --------------------- S: Science ---------------------
const fetchNature = () =>
  fetchAndParseXmlFeed("https://www.nature.com/nature.rss", "Nature", "Science", "global", ["Research"]);
const fetchScienceMag = () =>
  fetchAndParseXmlFeed("https://www.sciencemag.org/rss/news_current.xml", "Science Magazine", "Science", "us", ["Science"]);

const fetchNewScientist = () =>
  fetchAndParseXmlFeed("https://www.newscientist.com/feed/home/", "New Scientist", "Science", "uk", ["Science"]);
const fetchNatureUK = () =>
  fetchAndParseXmlFeed("https://www.nature.com/nature.rss", "Nature (UK)", "Science", "uk", ["Science"]);

const fetchEuronewsScience = () =>
  fetchAndParseXmlFeed("https://www.euronews.com/science/rss", "Euronews Science", "Science", "eu", ["Science"]);
const fetchScienceDaily = () =>
  fetchAndParseXmlFeed("https://www.sciencedaily.com/rss/all.xml", "ScienceDaily", "Science", "eu", ["Science"]);

const fetchCNRSNews = () =>
  fetchAndParseXmlFeed("https://www.cnrs.fr/en/rss", "CNRS News", "Science", "fr", ["France","Science"]);
const fetchLeMondeScience = () =>
  fetchAndParseXmlFeed("https://www.lemonde.fr/sciences/rss_full.xml", "Le Monde Sciences", "Science", "fr", ["France","Science"]);

const fetchTassScience = () =>
  fetchAndParseXmlFeed("https://tass.com/science/rss", "TASS Science", "Science", "ru", ["Russia","Science"]);
const fetchRASNews = () =>
  fetchAndParseXmlFeed("https://www.ras.ru/rss/rss_all.xml", "RAS News", "Science", "ru", ["Russia","Science"]);

const fetchNatureAsia = () =>
  fetchAndParseXmlFeed("https://www.natureasia.com/en/research/rss", "Nature Asia", "Science", "cn", ["China","Science"]);
const fetchCaixinScience = () =>
  fetchAndParseXmlFeed("https://www.caixinglobal.com/rss", "Caixin Science", "Science", "cn", ["China","Science"]);

const fetchVnExpressScience = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/khoa-hoc.rss", "VNExpress Science", "Science", "vn", ["Vietnam","Science"]);
const fetchKhoaHocPhapLuat = () =>
  fetchAndParseXmlFeed("https://khoahocphapluat.com/rss", "KhoaHocPhapLuật", "Science", "vn", ["Vietnam","Science"]);

// --------------------- S: Sports ---------------------
const fetchESPN = () =>
  fetchAndParseXmlFeed("https://www.espn.com/espn/rss/news", "ESPN", "Sports", "us", ["Sports"]);
const fetchBleacherReport = () =>
  fetchAndParseXmlFeed("https://bleacherreport.com/articles/feed", "Bleacher Report", "Sports", "us", ["Sports"]);

const fetchSkySports = () =>
  fetchAndParseXmlFeed("https://www.skysports.com/rss/12040", "Sky Sports", "Sports", "uk", ["Sports"]);
const fetchBBCSport = () =>
  fetchAndParseXmlFeed("http://feeds.bbci.co.uk/sport/rss.xml?edition=uk", "BBC Sport", "Sports", "uk", ["Sports"]);

const fetchEuronewsSports = () =>
  fetchAndParseXmlFeed("https://www.euronews.com/sport/rss", "Euronews Sport", "Sports", "eu", ["Sports"]);
const fetchEuroSport = () =>
  fetchAndParseXmlFeed("https://www.eurosport.com/rss.xml", "EuroSport", "Sports", "eu", ["Sports"]);

const fetchLEquipe = () =>
  fetchAndParseXmlFeed("https://www.lequipe.fr/rss/actu_rss.xml", "L’Équipe", "Sports", "fr", ["France","Sports"]);
const fetchFranceFootball = () =>
  fetchAndParseXmlFeed("https://www.francefootball.fr/rss.xml", "France Football", "Sports", "fr", ["France","Sports"]);

const fetchSportExpress = () =>
  fetchAndParseXmlFeed("https://www.sport-express.ru/services/materials/news/", "Sport-Express", "Sports", "ru", ["Russia","Sports"]);
const fetchChampionat = () =>
  fetchAndParseXmlFeed("https://www.championat.com/xml/rss.xml", "Championat.com", "Sports", "ru", ["Russia","Sports"]);

const fetchXinhuaSports = () =>
  fetchAndParseXmlFeed("http://www.xinhuanet.com/english/rss/sportsrss.xml", "Xinhua Sports", "Sports", "cn", ["China","Sports"]);
const fetchSinaSports = () =>
  fetchAndParseXmlFeed("https://sports.sina.com.cn/rss/eng/sports.xml", "Sina Sports", "Sports", "cn", ["China","Sports"]);

const fetchVnExpressSports = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/the-thao.rss", "VNExpress Sports", "Sports", "vn", ["Vietnam","Sports"]);
const fetch24hSports = () =>
  fetchAndParseXmlFeed("https://www.24h.com.vn/upload/rss/thethao.rss", "24h Sports", "Sports", "vn", ["Vietnam","Sports"]);

// --------------------- T: Technology ---------------------
const fetchTechCrunch = () =>
  fetchAndParseXmlFeed("https://techcrunch.com/feed/", "TechCrunch", "Technology", "us", ["Tech","Startups"]);
const fetchWired = () =>
  fetchAndParseXmlFeed("https://www.wired.com/feed/rss", "Wired", "Technology", "us", ["Tech","Innovation"]);

const fetchTechRadar = () =>
  fetchAndParseXmlFeed("https://www.techradar.com/rss", "TechRadar", "Technology", "uk", ["Tech"]);
const fetchTheRegister = () =>
  fetchAndParseXmlFeed("https://www.theregister.com/headlines.atom", "The Register", "Technology", "uk", ["Tech"]);

const fetchEUSciHub = () =>
  fetchAndParseXmlFeed("https://ec.europa.eu/newsroom/sdf/rss.cfm?serviceID=601", "EU Science Hub", "Technology", "eu", ["EU","Tech"]);
const fetchEUDigital = () =>
  fetchAndParseXmlFeed("https://digital-strategy.ec.europa.eu/en/news/rss.xml", "EU Digital Strategy", "Technology", "eu", ["EU","Tech"]);

const fetchUsineDigitale = () =>
  fetchAndParseXmlFeed("https://www.usine-digitale.fr/rss", "L’Usine Digitale", "Technology", "fr", ["France","Tech"]);
const fetchNumerama = () =>
  fetchAndParseXmlFeed("https://www.numerama.com/feed/", "Numerama", "Technology", "fr", ["France","Tech"]);

const fetchTAdviser = () =>
  fetchAndParseXmlFeed("https://www.tadviser.ru/index.php?title=Special:NewsFeed&feed=rss", "TAdviser", "Technology", "ru", ["Russia","Tech"]);
const fetchCNewsRussia = () =>
  fetchAndParseXmlFeed("https://www.cnews.ru/inc/rss/news.xml", "CNews Russia", "Technology", "ru", ["Russia","Tech"]);

const fetchPandaily = () =>
  fetchAndParseXmlFeed("https://pandaily.com/feed/", "Pandaily", "Technology", "cn", ["China","Tech"]);
const fetchTechNode = () =>
  fetchAndParseXmlFeed("https://technode.com/feed/", "TechNode", "Technology", "cn", ["China","Tech"]);

const fetchVnExpressTech = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/so-hoa.rss", "VNExpress Technology", "Technology", "vn", ["Vietnam","Tech"]);
const fetchICTNews = () =>
  fetchAndParseXmlFeed("https://ictnews.vietnamnet.vn/rss/home.rss", "ICTNews Vietnam", "Technology", "vn", ["Vietnam","Tech"]);

// --------------------- T: Travel ---------------------
const fetchCNTraveler = () =>
  fetchAndParseXmlFeed("https://www.cntraveler.com/feed/rss", "Condé Nast Traveler", "Travel", "us", ["Travel"]);
const fetchTravelLeisure = () =>
  fetchAndParseXmlFeed("https://www.travelandleisure.com/rss", "Travel + Leisure", "Travel", "us", ["Travel"]);

const fetchLonelyPlanet = () =>
  fetchAndParseXmlFeed("https://www.lonelyplanet.com/news/feed", "Lonely Planet", "Travel", "uk", ["Travel"]);
const fetchBBCTravel = () =>
  fetchAndParseXmlFeed("http://feeds.bbci.co.uk/news/travel/rss.xml", "BBC Travel", "Travel", "uk", ["Travel"]);

const fetchEuronewsTravel = () =>
  fetchAndParseXmlFeed("https://www.euronews.com/travel/rss", "Euronews Travel", "Travel", "eu", ["Travel"]);
const fetchTravelWeekly = () =>
  fetchAndParseXmlFeed("https://www.travelweekly.com/rss/top-headlines", "Travel Weekly", "Travel", "eu", ["Travel"]);

const fetchFrance24Travel = () =>
  fetchAndParseXmlFeed("https://www.france24.com/en/rss", "France24 Travel", "Travel", "fr", ["France","Travel"]);
const fetchLePointTravel = () =>
  fetchAndParseXmlFeed("https://www.lepoint.fr/rss/", "Le Point (Travel)", "Travel", "fr", ["France","Travel"]);

const fetchTASSTravel = () =>
  fetchAndParseXmlFeed("https://tass.com/rss/travel.xml", "TASS Travel", "Travel", "ru", ["Russia","Travel"]);
const fetchRussianTravel = () =>
  fetchAndParseXmlFeed("https://www.russiatourism.ru/rss", "Russia Tourism", "Travel", "ru", ["Russia","Travel"]);

const fetchChinaDailyTravel = () =>
  fetchAndParseXmlFeed("https://www.chinadaily.com.cn/rss/travel.xml", "ChinaDaily Travel", "Travel", "cn", ["China","Travel"]);
const fetchSCMPTravel = () =>
  fetchAndParseXmlFeed("https://www.scmp.com/lifestyle/travel/feed", "SCMP Travel", "Travel", "cn", ["China","Travel"]);

const fetchVNExpressTravel = () =>
  fetchAndParseXmlFeed("https://dulich.vnexpress.net/rss", "VNExpress Travel", "Travel", "vn", ["Vietnam","Travel"]);
const fetchVietnamTourism = () =>
  fetchAndParseXmlFeed("https://vietnamtourism.gov.vn/rss", "Vietnam Tourism", "Travel", "vn", ["Vietnam","Travel"]);


// India - NDTV
const fetchNDTV = () =>
  fetchAndParseXmlFeed("https://feeds.feedburner.com/ndtvnews-latest", "NDTV", "News", "in", ["India"]);

// Australia - ABC News Australia
const fetchABCNewsAU = () =>
  fetchAndParseXmlFeed("https://www.abc.net.au/news/feed/51120/rss.xml", "ABC News Australia", "News", "au", ["Australia"]);

// Japan - NHK World-Japan
const fetchNHKWorld = () =>
  fetchAndParseXmlFeed("https://www.nhk.or.jp/nhkworld/en/news/rss/all.xml", "NHK World-Japan", "News", "jp", ["Japan"]);

// ===================== END OF LIST =====================


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
  // === AI ===
  fetchNatureAI(),
  fetchVentureBeatAI(),
  fetchTechCrunchAI(),
  fetchWiredAI(),
  fetchMITTechReviewAI(),
  fetchVNExpressAI(),

  // === Archaeology ===
  fetchAncientOrigins(),
  fetchArchaeologyMagazine(),
  fetchHeritageDaily(),
  fetchPastHorizons(),
  fetchSmithsonianArchaeology(),
  fetchScienceRussiaArchaeology(),
  fetchCNArchaeology(),

  // === Business ===
  fetchBloomberg(),
  fetchCafeF(),
  fetchCNBCBusiness(),
  fetchFinancialTimes(),
  fetchReutersBusiness(),
  fetchVNExpressBusiness(),
  fetchWSJBusiness(),
  fetchGuardianBusiness(),
  fetchLeMondeBusiness(),
  fetchRTBusiness(),
  fetchChinaDailyBusiness(),

  // === Cars ===
  fetchAutoExpress(),
  fetchCarDriver(),
  fetchMotorTrend(),
  fetchTopGear(),
  fetchVNExpressAuto(),

  // === Cybersecurity ===
  fetchCybernews(),
  fetchDarkReading(),
  fetchKrebsSecurity(),
  fetchTheHackerNews(),
  fetchSecurityWeek(),
  fetchBleepingComputer(),
  fetchVNExpressCyber(),

  // === Education ===
  fetchEdWeek(),
  fetchEducation(),
  fetchGuardianEducation(),
  fetchTimesHigherEducation(),
  fetchInsideHigherEd(),
  fetchLeMondeEducation(),
  fetchVNExpressEducation(),
  fetchChinaDailyEducation(),
  fetchRussiaTodayEducation(),

  // === Entertainment ===
  fetchDeadline(),
  fetchHollywoodReporter(),
  fetchRollingStone(),
  fetchVariety(),
  fetchZingNewsEntertainment(),
  fetchGuardianCulture(),
  fetchLeMondeCulture(),
  fetchChinaDailyCulture(),
  fetchRussiaTodayCulture(),

  // === Environment ===
  fetchEnvironment(),
  fetchGuardianEnvironment(),
  fetchNatGeoEnvironment(),
  fetchUNEnvironment(),
  fetchLeMondeEnvironment(),
  fetchChinaDailyEnvironment(),
  fetchRussiaTodayEnvironment(),
  fetchVNExpressEnvironment(),

  // === Family ===
  fetchAfamily(),
  fetchParents(),
  fetchRefinery29Family(),
  fetchGuardianFamily(),
  fetchChinaDailyFamily(),

  // === Fashion ===
  fetchAllureBeauty(),
  fetchCosmopolitan(),
  fetchElle(),
  fetchElleVN(),
  fetchGQ(),
  fetchHarperBazaar(),
  fetchHighsnobiety(),
  fetchHypebeast(),
  fetchVogueBeauty(),
  fetchGuardianFashion(),
  fetchLeMondeStyle(),
  fetchChinaDailyFashion(),

  // === Finance ===
  fetchBloombergMarkets(),
  fetchCNBCFinance(),
  fetchFinancialTimesMarkets(),
  fetchYahooFinance(),
  fetchVNExpressFinance(),
  fetchGuardianFinance(),
  fetchLeMondeFinance(),
  fetchRussiaTodayFinance(),
  fetchChinaDailyFinance(),

  // === Food ===
  fetchBonAppetit(),
  fetchEater(),
  fetchFoodWine(),
  fetchMonNgonMoiNgay(),
  fetchNgonAZ(),
  fetchSaveur(),
  fetchSeriousEats(),
  fetchGuardianFood(),
  fetchLeMondeFood(),
  fetchChinaDailyFood(),

  // === Gaming ===
  fetchEurogamer(),
  fetchGameKVN(),
  fetchIGNGaming(),
  fetchKotaku(),
  fetchPCGamer(),
  fetchVNExpressGaming(),
  fetchGuardianGames(),
  fetchChinaDailyGaming(),
  fetchRussiaTodayGaming(),

  // === Healthcare ===
  fetchHealthline(),
  fetchHealthcare(),
  fetchMedicalNewsToday(),
  fetchWHO(),
  fetchGuardianHealth(),
  fetchLeMondeHealth(),
  fetchRussiaTodayHealth(),
  fetchChinaDailyHealth(),
  fetchVNExpressSucKhoe(),

  // === Lifestyle ===
  fetchGuardianLifestyle(),
  fetchLifehack(),
  fetchRefinery29(),
  fetchZingNewsLifestyle(),
  fetchLeMondeLifestyle(),
  fetchChinaDailyLifestyle(),
  fetchRussiaTodayLifestyle(),

  // === Music ===
  fetchAppleMusicMostPlayedVN(),
  fetchAppleMusicNewReleasesVN(),
  fetchBillboard(),
  fetchPitchfork(),
  fetchRollingStoneMusic(),
  fetchZingNewsMusic(),
  fetchGuardianMusic(),
  fetchLeMondeMusic(),
  fetchChinaDailyMusic(),
  fetchRussiaTodayMusic(),

  // === News ===
  fetchABCNewsAU(),
  fetchBBCWorld(),
  fetchChinaDaily(),
  fetchDWNews(),
  fetchEuronews(),
  fetchFrance24News(),
  fetchGoogleNewsVN(),
  fetchKoreaHerald(),
  fetchNDTV(),
  fetchNHKWorld(),
  fetchQdndNews(),
  fetchRTNews(),
  fetchGuardianNews(),
  fetchLeMondeNews(),
  fetchVNExpressNews(),

  // === Politics ===
  fetchGuardianPolitics(),
  fetchLeMondePolitics(),
  fetchPolitico(),
  fetchPolitics(),
  fetchRussiaTodayPolitics(),
  fetchTheHill(),
  fetchChinaDailyPolitics(),
  fetchVNExpressPolitics(),

  // === Science ===
  fetchNationalGeographic(),
  fetchNature(),
  fetchNewScientist(),
  fetchScienceMagazine(),
  fetchGuardianScience(),
  fetchLeMondeScience(),
  fetchRussiaTodayScience(),
  fetchChinaDailyScience(),
  fetchVNExpressScience(),

  // === Sports ===
  fetchESPN(),
  fetchFifa(),
  fetchSkySports(),
  fetchVNExpressSports(),
  fetchGuardianSport(),
  fetchLeMondeSport(),
  fetchRussiaTodaySport(),
  fetchChinaDailySport(),

  // === Technology ===
  fetchGenKVNTech(),
  fetchHackerNewsFrontpage(),
  fetchPandaily(),
  fetchTechCrunch(),
  fetchTechnode(),
  fetchTheVerge(),
  fetchWired(),
  fetchGuardianTech(),
  fetchLeMondeTech(),
  fetchChinaDailyTech(),
  fetchRussiaTodayTech(),
  fetchVNExpressTechnology(),

  // === Travel ===
  fetchCNTraveler(),
  fetchGuardianTravel(),
  fetchLeMondeTravel(),
  fetchTravel(),
  fetchTravelWeekly(),
  fetchVNExpressTravel(),
  fetchChinaDailyTravel(),
  fetchRussiaTodayTravel(),

  fetchNDTV(), 
  fetchABCNewsAU(),
  fetchNHKWorld(),
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
