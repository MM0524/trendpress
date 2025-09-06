// File: netlify/functions/fetch-trends.js
const fetch = require("node-fetch");
const { XMLParser } = require("fast-xml-parser");
const crypto = require("crypto");

// ===== Helpers =====

async function fetchWithTimeout(url, options = {}, ms = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
        "Accept":
          "application/xml, text/xml, application/rss+xml, application/atom+xml, application/json, text/plain, */*",
        "Referer": safeOrigin(url),
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
    if (
      err.code === "ENOTFOUND" ||
      err.code === "ECONNREFUSED" ||
      err.name === "FetchError"
    ) {
      throw new Error(
        `Network error: Could not reach ${url}. Message: ${err.message}`
      );
    }
    throw new Error(`Processing error for ${url}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

function safeOrigin(u) {
  try {
    return new URL(u).origin;
  } catch {
    return "";
  }
}

// Function to safely get string value, handling null/undefined/objects
function getSafeString(value) {
  if (value === null || value === undefined) {
    return "";
  }
  let strValue = "";
  if (typeof value === "string") {
    strValue = value;
  } else if (typeof value === "object" && value && value.hasOwnProperty("#text")) {
    strValue = String(value["#text"]);
  } else if (typeof value === "object" && value && value.hasOwnProperty("href")) {
    strValue = String(value.href);
  } else if (Array.isArray(value)) {
    strValue = String(value[0]);
  } else {
    strValue = String(value);
  }
  return decodeHtmlEntities(strValue).trim();
}

// HTML Entity Decoder
function decodeHtmlEntities(str = "") {
  return str
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// Date helpers
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

// ===== Trend Factory =====
function createStandardTrend(
  item,
  sourceName,
  defaultCategory = "General",
  defaultRegion = "global",
  extraTags = []
) {
  const title =
    getSafeString(item.title || item["media:title"] || item.name) ||
    "No Title Available";
  const description =
    getSafeString(
      item.description ||
        item.content?.["#text"] ||
        item.summary?.["#text"] ||
        item.content ||
        item.artistName
    ) || "No description available";

  let link = getSafeString(item.link);
  if (Array.isArray(item.link)) {
    const firstLink =
      item.link.find((l) => l.rel === "alternate" || !l.rel) || item.link[0];
    if (firstLink && (firstLink.href || typeof firstLink === "string")) {
      link = getSafeString(firstLink.href || firstLink);
    }
  } else if (typeof item.link === "object" && item.link?.href) {
    link = getSafeString(item.link.href);
  }
  link = link || "#";

  const pubDate =
    getSafeString(
      item.pubDate || item.published || item.updated || item.releaseDate
    ) || new Date().toISOString();

  const cleanedTitle = title.replace(/<[^>]*>?/gm, "").replace(/\n{2,}/g, "\n").trim();
  const cleanedDescription = description
    .replace(/<[^>]*>?/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();

  const baseVotes = Math.floor(Math.random() * 2000) + 1000;
  const baseMultiplier = Math.random() * 1.5 + 0.5;

  const stableId = crypto
    .createHash("md5")
    .update(`${link}-${cleanedTitle}`)
    .digest("hex");

  return {
    id: stableId,
    title_en: cleanedTitle,
    description_en: cleanedDescription,
    title_vi: cleanedTitle,
    description_vi: cleanedDescription,
    category: defaultCategory,
    tags: [
      ...new Set(
        [
          ...extraTags,
          (sourceName || "Unknown").replace(/\s/g, ""),
          defaultRegion || "global",
        ].filter(Boolean)
      ),
    ],
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

// ===== XML/RSS/Atom Feed Fetcher =====
async function fetchAndParseXmlFeed(
  url,
  sourceName,
  defaultCategory,
  defaultRegion,
  extraTags = []
) {
  try {
    const res = await fetchWithTimeout(url);
    const text = await res.text();

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      trimValues: true,
      textNodeName: "#text",
      removeNSPrefix: true,
      isArray: (name, jpath) => {
        if (name === "item" || name === "entry") return true;
        if (
          (name === "link" || name === "category") &&
          /(^|\.)(item|entry)(\.|$)/.test(jpath)
        )
          return true;
        return false;
      },
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
      for (const key in parsed || {}) {
        const potential = parsed[key];
        if (
          Array.isArray(potential) &&
          potential.length > 0 &&
          typeof potential[0] === "object" &&
          (potential[0].title || potential[0].name)
        ) {
          rawItems = potential;
          console.warn(
            `⚠️ ${sourceName}: Items found at non-standard path parsed.${key} from ${url}.`
          );
          break;
        }
      }
    }

    if (rawItems.length === 0) {
      console.error(
        `❌ ${sourceName}: No items found from ${url}. Roots: ${JSON.stringify(
          Object.keys(parsed || {})
        )}`
      );
      return [];
    }

    return rawItems.map((item) =>
      createStandardTrend(item, sourceName, defaultCategory, defaultRegion, extraTags)
    );
  } catch (err) {
    console.error(`❌ Lỗi khi fetch hoặc parse XML từ ${sourceName} (${url}):`, err.message);
    return [];
  }
}

// ===== JSON Feed Fetcher =====
async function fetchJsonFeed(
  url,
  sourceName,
  defaultCategory,
  defaultRegion,
  extraTags = []
) {
  try {
    const res = await fetchWithTimeout(url);
    const json = await res.json();

    let rawItems = [];
    if (json?.feed?.results) {
      rawItems = json.feed.results;
    } else if (Array.isArray(json?.items)) {
      rawItems = json.items;
    } else {
      console.warn(
        `⁉️ ${sourceName}: Unexpected JSON shape at ${url}.`
      );
      return [];
    }

    return rawItems.map((item) =>
      createStandardTrend(item, sourceName, defaultCategory, defaultRegion, extraTags)
    );
  } catch (err) {
    console.error(`❌ Lỗi khi fetch hoặc parse JSON từ ${sourceName} (${url}):`, err.message);
    return [];
  }
}

/* ======================================================================
   Individual fetch functions — by Category and Region
   Regions used: us, uk, vn, cn, jp, ru, eu, au, kr, kp
   ======================================================================*/

/* === Technology === */
const fetchHackerNewsFrontpage = () =>
  fetchAndParseXmlFeed("https://hnrss.org/frontpage", "Hacker News", "Technology", "us", ["Tech"]);
const fetchTheVerge = () =>
  fetchAndParseXmlFeed("https://www.theverge.com/rss/index.xml", "The Verge", "Technology", "us", ["Tech"]);
const fetchBBCtech = () =>
  fetchAndParseXmlFeed("http://feeds.bbci.co.uk/news/technology/rss.xml", "BBC Tech", "Technology", "uk", ["Tech"]);
const fetchVNExpressTech = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/khoa-hoc.rss", "VNExpress Khoa Học & Công Nghệ", "Technology", "vn", ["Vietnam","Tech"]);
const fetchTechNodeCN = () =>
  fetchAndParseXmlFeed("https://technode.com/feed/", "TechNode CN", "Technology", "cn", ["China","Tech"]);
const fetchITMediaJP = () =>
  fetchAndParseXmlFeed("https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml", "ITmedia JP", "Technology", "jp", ["Japan","Tech"]);
const fetchTJournalRU = () =>
  fetchAndParseXmlFeed("https://tjournal.ru/rss", "TJ Journal RU", "Technology", "ru", ["Russia","Tech"]);
const fetchEUObserverTech = () =>
  fetchAndParseXmlFeed("https://euobserver.com/rss", "EUobserver (Tech/General EU)", "Technology", "eu", ["EU","Tech"]);
const fetchGizmodoAU = () =>
  fetchAndParseXmlFeed("https://www.gizmodo.com.au/feed/", "Gizmodo AU", "Technology", "au", ["Australia","Tech"]);
const fetchKoreaHeraldTech = () =>
  fetchAndParseXmlFeed("http://www.koreaherald.com/rss/030000000000.xml", "Korea Herald Tech", "Technology", "kr", ["Korea","Tech"]);

/* === AI === */
const fetchVentureBeatAI = () =>
  fetchAndParseXmlFeed("https://venturebeat.com/feed/", "VentureBeat AI", "AI", "us", ["AI"]);
const fetchNatureAI = () =>
  fetchAndParseXmlFeed("https://www.nature.com/subjects/machine-learning/rss", "Nature AI", "AI", "uk", ["AI"]);
const fetchZingNewsAI = () =>
  fetchAndParseXmlFeed("https://zingnews.vn/cong-nghe.rss", "ZingNews AI/Tech", "AI", "vn", ["Vietnam","AI"]);
const fetchSyncedReviewCN = () =>
  fetchAndParseXmlFeed("https://syncedreview.com/feed/", "SyncedReview CN", "AI", "cn", ["China","AI"]);
const fetchAISTJP = () =>
  fetchAndParseXmlFeed("https://www.aist.go.jp/index_en.rdf", "AIST (JP) News", "AI", "jp", ["Japan","AI"]);
const fetchKasperskyAI RU = () =>
  fetchAndParseXmlFeed("https://securelist.com/feed/", "Securelist (Kaspersky) RU", "AI", "ru", ["Russia","AI","Security"]);
const fetchEuractivAI = () =>
  fetchAndParseXmlFeed("https://www.euractiv.com/section/digital/feed/", "Euractiv Digital EU", "AI", "eu", ["EU","AI"]);
const fetchCSIROAI = () =>
  fetchAndParseXmlFeed("https://blog.csiro.au/feed/", "CSIRO AU (Sci/AI)", "AI", "au", ["Australia","AI"]);
const fetchKISAkr = () =>
  fetchAndParseXmlFeed("https://www.kisa.or.kr/rss/eng_notice.jsp", "KISA KR (Notices)", "AI", "kr", ["Korea","AI"]);

/* === Gaming === */
const fetchIGNGaming = () =>
  fetchAndParseXmlFeed("https://feeds.ign.com/ign/games-all", "IGN Gaming", "Gaming", "us", ["Games"]);
const fetchEurogamer = () =>
  fetchAndParseXmlFeed("https://www.eurogamer.net/?format=rss", "Eurogamer", "Gaming", "uk", ["Games"]);
const fetchGenKVN = () =>
  fetchAndParseXmlFeed("https://genk.vn/game.rss", "GenK VN (Game)", "Gaming", "vn", ["Vietnam","Games"]);
const fetchSCMPGamingCN = () =>
  fetchAndParseXmlFeed("https://www.scmp.com/rss/318200/feed", "SCMP Gaming CN", "Gaming", "cn", ["China","Gaming"]);
const fetch4GamerJP = () =>
  fetchAndParseXmlFeed("https://www.4gamer.net/rss/news_topics.xml", "4Gamer JP", "Gaming", "jp", ["Japan","Gaming"]);
const fetchIgromaniaRU = () =>
  fetchAndParseXmlFeed("https://www.igromania.ru/rss/all/allnews.xml", "Igromania RU", "Gaming", "ru", ["Russia","Gaming"]);
const fetchEUROgamerEU = () =>
  fetchAndParseXmlFeed("https://www.eurogamer.net/?format=rss", "Eurogamer (EU)", "Gaming", "eu", ["EU","Gaming"]);
const fetchPressStartAU = () =>
  fetchAndParseXmlFeed("https://press-start.com.au/feed/", "Press Start AU", "Gaming", "au", ["Australia","Gaming"]);
const fetchInvenKR = () =>
  fetchAndParseXmlFeed("https://www.inven.co.kr/rss/news.xml", "Inven KR", "Gaming", "kr", ["Korea","Gaming"]);
const fetch38NorthGamingKP = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP topical)", "Gaming", "kp", ["NorthKorea","General"]);

/* === Finance === */
const fetchCNBCFinance = () =>
  fetchAndParseXmlFeed("https://www.cnbc.com/id/10000664/device/rss/rss.html", "CNBC Finance", "Finance", "us", ["Markets"]);
const fetchGuardianBusiness = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/uk/business/rss", "Guardian Business", "Finance", "uk", ["Markets"]);
const fetchVNExpressFinance = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/kinh-doanh.rss", "VNExpress Kinh Doanh", "Finance", "vn", ["Vietnam","Markets"]);
const fetchSCMPEconomyCN = () =>
  fetchAndParseXmlFeed("https://www.scmp.com/rss/91/feed", "SCMP Economy/Tech CN", "Finance", "cn", ["China","Markets"]);
const fetchNikkeiAsiaBizJP = () =>
  fetchAndParseXmlFeed("https://asia.nikkei.com/rss/category/Business", "Nikkei Asia Business", "Finance", "jp", ["Japan","Markets"]);
const fetchMoscowTimesBizRU = () =>
  fetchAndParseXmlFeed("https://www.themoscowtimes.com/rss/business", "Moscow Times Business", "Finance", "ru", ["Russia","Markets"]);
const fetchECBPressEU = () =>
  fetchAndParseXmlFeed("https://www.ecb.europa.eu/press/press.html?format=rss", "ECB Press (EU)", "Finance", "eu", ["EU","Markets"]);
const fetchABC_AU_Business = () =>
  fetchAndParseXmlFeed("https://www.abc.net.au/news/feed/51892/rss.xml", "ABC AU Business", "Finance", "au", ["Australia","Markets"]);
const fetchKoreaTimesBiz = () =>
  fetchAndParseXmlFeed("http://www.koreatimes.co.kr/www/rss/biz.xml", "Korea Times Business", "Finance", "kr", ["Korea","Markets"]);
const fetch38NorthEconKP = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP Economy)", "Finance", "kp", ["NorthKorea","Economy"]);

/* === Science === */
const fetchScienceMagazine = () =>
  fetchAndParseXmlFeed("https://www.sciencemag.org/rss/news_current.xml", "Science Magazine", "Science", "us", ["Science"]);
const fetchNewScientist = () =>
  fetchAndParseXmlFeed("https://www.newscientist.com/feed/home/", "New Scientist", "Science", "uk", ["Science"]);
const fetchVNExpressScience = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/khoa-hoc.rss", "VNExpress Khoa Học", "Science", "vn", ["Vietnam","Science"]);
const fetchChinaDailyTechSci = () =>
  fetchAndParseXmlFeed("http://www.chinadaily.com.cn/rss/tech_rss.xml", "China Daily Tech/Science", "Science", "cn", ["China","Science"]);
const fetchNHKWorldSci = () =>
  fetchAndParseXmlFeed("https://www3.nhk.or.jp/nhkworld/en/news/rss/", "NHK World News (Sci/Tech mixed)", "Science", "jp", ["Japan","Science"]);
const fetchRoscosmosRU = () =>
  fetchAndParseXmlFeed("https://www.roscosmos.ru/rss/", "Roscosmos (RU)", "Science", "ru", ["Russia","Space"]);
const fetchESA_EU = () =>
  fetchAndParseXmlFeed("https://www.esa.int/rssfeed/Our_Activities", "ESA (EU)", "Science", "eu", ["EU","Space","Science"]);
const fetchCSIRO_AU = () =>
  fetchAndParseXmlFeed("https://blog.csiro.au/feed/", "CSIRO AU", "Science", "au", ["Australia","Science"]);
const fetchKoreanHeraldSci = () =>
  fetchAndParseXmlFeed("http://www.koreaherald.com/rss/020000000000.xml", "Korea Herald Sci/World", "Science", "kr", ["Korea","Science"]);
const fetch38NorthSciKP = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP general)", "Science", "kp", ["NorthKorea"]);

/* === Music === */
const fetchRollingStone = () =>
  fetchAndParseXmlFeed("https://www.rollingstone.com/music/music-news/feed/", "Rolling Stone", "Music", "us", ["Music"]);
const fetchNME = () =>
  fetchAndParseXmlFeed("https://www.nme.com/feed", "NME Music", "Music", "uk", ["Music"]);
const fetchAppleMusicMostPlayedVN = () =>
  fetchJsonFeed("https://rss.applemarketingtools.com/api/v2/vn/music/most-played/100/songs.json", "Apple Music VN Most Played", "Music", "vn", ["Vietnam","Music"]);
const fetchRADIIChina = () =>
  fetchAndParseXmlFeed("https://radiichina.com/feed/", "RADII China (culture/music)", "Music", "cn", ["China","Music"]);
const fetchTokyoWeekender = () =>
  fetchAndParseXmlFeed("https://www.tokyoweekender.com/feed/", "Tokyo Weekender", "Music", "jp", ["Japan","Culture"]);
const fetchMoscowTimesCulture = () =>
  fetchAndParseXmlFeed("https://www.themoscowtimes.com/rss/arts-and-ideas", "Moscow Times Arts", "Music", "ru", ["Russia","Culture"]);
const fetchEuronewsCulture = () =>
  fetchAndParseXmlFeed("https://www.euronews.com/rss?level=theme&name=culture", "Euronews Culture (EU)", "Music", "eu", ["EU","Culture"]);
const fetchABC_AU_Arts = () =>
  fetchAndParseXmlFeed("https://www.abc.net.au/news/feed/45730/rss.xml", "ABC AU Arts & Culture", "Music", "au", ["Australia","Culture"]);
const fetchKoreaHeraldCulture = () =>
  fetchAndParseXmlFeed("http://www.koreaherald.com/rss/030200000000.xml", "Korea Herald Culture", "Music", "kr", ["Korea","Culture"]);
const fetch38NorthCulture = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP culture/politics)", "Music", "kp", ["NorthKorea","Culture"]);

/* === Entertainment === */
const fetchVariety = () =>
  fetchAndParseXmlFeed("https://variety.com/feed/", "Variety", "Entertainment", "us", ["Hollywood"]);
const fetchGuardianCulture = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/uk/culture/rss", "Guardian Culture", "Entertainment", "uk", ["Culture"]);
const fetchZingNewsEntertainment = () =>
  fetchAndParseXmlFeed("https://zingnews.vn/rss/giai-tri.rss", "ZingNews Entertainment", "Entertainment", "vn", ["Vietnam"]);
const fetchSixthToneCultureCN = () =>
  fetchAndParseXmlFeed("https://www.sixthtone.com/rss", "Sixth Tone (Culture) CN", "Entertainment", "cn", ["China","Culture"]);
const fetchANN_JP = () =>
  fetchAndParseXmlFeed("https://www.animenewsnetwork.com/all/rss.xml", "Anime News Network", "Entertainment", "jp", ["Japan","Anime"]);
const fetchRT_Arts_RU = () =>
  fetchAndParseXmlFeed("https://www.rt.com/rss/arts/", "RT Arts & Culture", "Entertainment", "ru", ["Russia","Culture"]);
const fetchEuronewsCultureEU = () =>
  fetchAndParseXmlFeed("https://www.euronews.com/rss?level=theme&name=culture", "Euronews Culture (EU)", "Entertainment", "eu", ["EU","Culture"]);
const fetchABC_AU_Entertainment = () =>
  fetchAndParseXmlFeed("https://www.abc.net.au/news/feed/45730/rss.xml", "ABC AU Arts & Culture", "Entertainment", "au", ["Australia","Culture"]);
const fetchKoreaTimesCulture = () =>
  fetchAndParseXmlFeed("http://www.koreatimes.co.kr/www/rss/art.xml", "Korea Times Culture", "Entertainment", "kr", ["Korea","Culture"]);
const fetch38NorthEntKP = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP topical)", "Entertainment", "kp", ["NorthKorea"]);

/* === Sports === */
const fetchESPN = () =>
  fetchAndParseXmlFeed("https://www.espn.com/espn/rss/news", "ESPN", "Sports", "us", ["Sports"]);
const fetchSkySportsNews = () =>
  fetchAndParseXmlFeed("https://www.skysports.com/rss/12040", "Sky Sports", "Sports", "uk", ["Sports"]);
const fetchThanhNienSports = () =>
  fetchAndParseXmlFeed("https://thanhnien.vn/rss/the-thao.rss", "Thanh Niên Thể Thao", "Sports", "vn", ["Vietnam"]);
const fetchChinaDailySports = () =>
  fetchAndParseXmlFeed("http://www.chinadaily.com.cn/rss/sports_rss.xml", "China Daily Sports", "Sports", "cn", ["China","Sports"]);
const fetchJapanTimesSports = () =>
  fetchAndParseXmlFeed("https://www.japantimes.co.jp/sports/feed/", "Japan Times Sports", "Sports", "jp", ["Japan","Sports"]);
const fetchTASSSportsRU = () =>
  fetchAndParseXmlFeed("https://tass.com/rss/v2.xml", "TASS (RU) General incl. Sports", "Sports", "ru", ["Russia"]);
const fetchUEFA_EU = () =>
  fetchAndParseXmlFeed("https://www.uefa.com/rssfeed/uefachampionsleague/rss.xml", "UEFA (EU)", "Sports", "eu", ["EU","Football"]);
const fetchABC_AU_Sport = () =>
  fetchAndParseXmlFeed("https://www.abc.net.au/news/feed/45910/rss.xml", "ABC AU Sport", "Sports", "au", ["Australia","Sports"]);
const fetchKoreaTimesSports = () =>
  fetchAndParseXmlFeed("http://www.koreatimes.co.kr/www/rss/sports.xml", "Korea Times Sports", "Sports", "kr", ["Korea","Sports"]);
const fetch38NorthSports = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP)", "Sports", "kp", ["NorthKorea"]);

/* === Logistics === */
const fetchFreightWaves = () =>
  fetchAndParseXmlFeed("https://www.freightwaves.com/feed", "FreightWaves", "Logistics", "us", ["SupplyChain"]);
const fetchTheLoadstar = () =>
  fetchAndParseXmlFeed("https://theloadstar.com/feed/", "The Loadstar UK", "Logistics", "uk", ["Logistics"]);
const fetchVNLogistics = () =>
  fetchAndParseXmlFeed("https://vietship.net/feed/", "Vietnam Logistics", "Logistics", "vn", ["Logistics"]);
const fetchChinaBriefing = () =>
  fetchAndParseXmlFeed("https://www.china-briefing.com/news/feed/", "China Briefing (Biz/Trade)", "Logistics", "cn", ["China","Trade"]);
const fetchNikkeiSupplyJP = () =>
  fetchAndParseXmlFeed("https://asia.nikkei.com/rss/category/Economy", "Nikkei Asia Economy/Supply", "Logistics", "jp", ["Japan","SupplyChain"]);
const fetchRailFreightEU = () =>
  fetchAndParseXmlFeed("https://www.railfreight.com/feed/", "RailFreight (EU)", "Logistics", "eu", ["EU","Rail","Logistics"]);
const fetchATN_AU = () =>
  fetchAndParseXmlFeed("https://www.fullyloaded.com.au/rss", "ATN AU (Transport/Logistics)", "Logistics", "au", ["Australia","Logistics"]);
const fetchKoreaHeraldBizLog = () =>
  fetchAndParseXmlFeed("http://www.koreaherald.com/rss/030000000000.xml", "Korea Herald Business/Logistics", "Logistics", "kr", ["Korea","Logistics"]);
const fetchRU_Trans_Sputnik = () =>
  fetchAndParseXmlFeed("https://sputnikglobe.com/export/rss2/transport/index.xml", "Sputnik Transport (RU/Eurasia)", "Logistics", "ru", ["Russia","Transport"]);
const fetch38NorthTrade = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP trade)", "Logistics", "kp", ["NorthKorea","Trade"]);

/* === Cybersecurity === */
const fetchKrebsOnSecurity = () =>
  fetchAndParseXmlFeed("https://krebsonsecurity.com/feed/", "Krebs on Security", "Cybersecurity", "us", ["Security"]);
const fetchSCMagUK = () =>
  fetchAndParseXmlFeed("https://www.scmagazineuk.com/rss", "SC Magazine UK", "Cybersecurity", "uk", ["Security"]);
const fetchVNExpressCyber = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/so-hoa.rss", "VNExpress Công Nghệ (Cyber)", "Cybersecurity", "vn", ["Vietnam"]);
const fetchQiAnXinCN = () =>
  fetchAndParseXmlFeed("https://blog.qianxin.com/feed", "QiAnXin Blog CN", "Cybersecurity", "cn", ["China","Security"]);
const fetchJPCERTBlog = () =>
  fetchAndParseXmlFeed("https://blogs.jpcert.or.jp/en/atom.xml", "JPCERT/CC Blog", "Cybersecurity", "jp", ["Japan","Security"]);
const fetchSecurelistRU = () =>
  fetchAndParseXmlFeed("https://securelist.com/feed/", "Securelist (Kaspersky)", "Cybersecurity", "ru", ["Russia","Security"]);
const fetchENISA_EU = () =>
  fetchAndParseXmlFeed("https://www.enisa.europa.eu/news/enisa-news/RSS", "ENISA (EU)", "Cybersecurity", "eu", ["EU","Security"]);
const fetchASDC_AU = () =>
  fetchAndParseXmlFeed("https://www.cyber.gov.au/newsroom/rss", "Australian Cyber Security Centre", "Cybersecurity", "au", ["Australia","Security"]);
const fetchKISA_KR_Cyber = () =>
  fetchAndParseXmlFeed("https://www.kisa.or.kr/rss/eng_notice.jsp", "KISA KR", "Cybersecurity", "kr", ["Korea","Security"]);
const fetch38NorthCyber = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP)", "Cybersecurity", "kp", ["NorthKorea","Security"]);

/* === Healthcare === */
const fetchMedicalNewsToday = () =>
  fetchAndParseXmlFeed("https://www.medicalnewstoday.com/rss", "Medical News Today", "Healthcare", "us", ["Health"]);
const fetchNHSNews = () =>
  fetchAndParseXmlFeed("https://www.england.nhs.uk/news/feed/", "NHS England News", "Healthcare", "uk", ["Health"]);
const fetchSucKhoeDoiSong = () =>
  fetchAndParseXmlFeed("https://suckhoedoisong.vn/rss/home.rss", "Sức Khỏe & Đời Sống", "Healthcare", "vn", ["Vietnam","Health"]);
const fetchChinaDailyHealth = () =>
  fetchAndParseXmlFeed("http://www.chinadaily.com.cn/rss/china_health_rss.xml", "China Daily Health", "Healthcare", "cn", ["China","Health"]);
const fetchJapanTimesHealth = () =>
  fetchAndParseXmlFeed("https://www.japantimes.co.jp/news_category/health/feed/", "Japan Times Health", "Healthcare", "jp", ["Japan","Health"]);
const fetchECDC_EU = () =>
  fetchAndParseXmlFeed("https://www.ecdc.europa.eu/en/news-events/rss.xml", "ECDC (EU)", "Healthcare", "eu", ["EU","Health"]);
const fetchABC_AU_Health = () =>
  fetchAndParseXmlFeed("https://www.abc.net.au/news/feed/24510/rss.xml", "ABC AU Health", "Healthcare", "au", ["Australia","Health"]);
const fetchKoreaTimesHealth = () =>
  fetchAndParseXmlFeed("http://www.koreatimes.co.kr/www/rss/nation.xml", "Korea Times Nation/Health", "Healthcare", "kr", ["Korea","Health"]);
const fetchTASSHealthRU = () =>
  fetchAndParseXmlFeed("https://tass.com/rss/v2.xml", "TASS (RU General incl. Health)", "Healthcare", "ru", ["Russia"]);
const fetch38NorthHealthKP = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP)", "Healthcare", "kp", ["NorthKorea"]);

/* === Education === */
const fetchEdSurge = () =>
  fetchAndParseXmlFeed("https://www.edsurge.com/research.rss", "EdSurge", "Education", "us", ["Education"]);
const fetchTimesHigherEd = () =>
  fetchAndParseXmlFeed("https://www.timeshighereducation.com/rss", "Times Higher Education", "Education", "uk", ["Education"]);
const fetchTuoiTreEducation = () =>
  fetchAndParseXmlFeed("https://tuoitre.vn/rss/giao-duc.rss", "Tuổi Trẻ Giáo Dục", "Education", "vn", ["Vietnam","Education"]);
const fetchChinaDailyEdu = () =>
  fetchAndParseXmlFeed("http://www.chinadaily.com.cn/rss/learning_china_rss.xml", "China Daily Education", "Education", "cn", ["China","Education"]);
const fetchJapanTimesEdu = () =>
  fetchAndParseXmlFeed("https://www.japantimes.co.jp/community/feed/", "Japan Times Community/Edu", "Education", "jp", ["Japan","Education"]);
const fetchEurydiceEU = () =>
  fetchAndParseXmlFeed("https://education.ec.europa.eu/news/rss.xml", "EU Commission Education", "Education", "eu", ["EU","Education"]);
const fetchABC_AU_Edu = () =>
  fetchAndParseXmlFeed("https://www.abc.net.au/news/feed/45928/rss.xml", "ABC AU Education", "Education", "au", ["Australia","Education"]);
const fetchKoreaHeraldEdu = () =>
  fetchAndParseXmlFeed("http://www.koreaherald.com/rss/030500000000.xml", "Korea Herald Education", "Education", "kr", ["Korea","Education"]);
const fetchTASS_EduRU = () =>
  fetchAndParseXmlFeed("https://tass.com/rss/v2.xml", "TASS (RU General incl. Edu)", "Education", "ru", ["Russia"]);
const fetch38NorthEduKP = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP)", "Education", "kp", ["NorthKorea"]);

/* === Environment === */
const fetchNatGeoEnvironment = () =>
  fetchAndParseXmlFeed("https://www.nationalgeographic.com/animals/rss/", "National Geographic Environment (Animals)", "Environment", "us", ["Climate","Environment"]);
const fetchGuardianEnvironment = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/uk/environment/rss", "Guardian Environment", "Environment", "uk", ["Environment"]);
const fetchVNExpressEnvironment = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/khoa-hoc.rss", "VNExpress Môi Trường/Khoa học", "Environment", "vn", ["Vietnam","Environment"]);
const fetchChinaDialogue = () =>
  fetchAndParseXmlFeed("https://chinadialogue.net/en/feed/", "China Dialogue (EN)", "Environment", "cn", ["China","Climate"]);
const fetchJapanTimesEnv = () =>
  fetchAndParseXmlFeed("https://www.japantimes.co.jp/environment/feed/", "Japan Times Environment", "Environment", "jp", ["Japan","Environment"]);
const fetchEEA_EU = () =>
  fetchAndParseXmlFeed("https://www.eea.europa.eu/en/newsroom/news/RSS", "European Environment Agency", "Environment", "eu", ["EU","Environment"]);
const fetchABC_AU_Environment = () =>
  fetchAndParseXmlFeed("https://www.abc.net.au/news/feed/24524/rss.xml", "ABC AU Environment", "Environment", "au", ["Australia","Environment"]);
const fetchKoreaHeraldEnv = () =>
  fetchAndParseXmlFeed("http://www.koreaherald.com/rss/010000000000.xml", "Korea Herald (General/Env)", "Environment", "kr", ["Korea"]);
const fetchTASS_EnvRU = () =>
  fetchAndParseXmlFeed("https://tass.com/rss/v2.xml", "TASS (RU General/Env)", "Environment", "ru", ["Russia"]);
const fetch38NorthEnvKP = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP)", "Environment", "kp", ["NorthKorea"]);

/* === Travel === */
const fetchCNTraveler = () =>
  fetchAndParseXmlFeed("https://www.cntraveler.com/feed/rss", "Condé Nast Traveler", "Travel", "us", ["Travel"]);
const fetchGuardianTravel = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/uk/travel/rss", "Guardian Travel", "Travel", "uk", ["Travel"]);
const fetchVNExpressTravel = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/du-lich.rss", "VNExpress Du Lịch", "Travel", "vn", ["Vietnam","Travel"]);
const fetchChinaDailyTravel = () =>
  fetchAndParseXmlFeed("http://www.chinadaily.com.cn/rss/life_travel.xml", "China Daily Travel", "Travel", "cn", ["China","Travel"]);
const fetchJapanGuideBlog = () =>
  fetchAndParseXmlFeed("https://www.japan-guide.com/blog/feed/", "Japan-Guide Blog", "Travel", "jp", ["Japan","Travel"]);
const fetchEU_Travel_Euronews = () =>
  fetchAndParseXmlFeed("https://www.euronews.com/rss?level=theme&name=travel", "Euronews Travel (EU)", "Travel", "eu", ["EU","Travel"]);
const fetchTravellerAU = () =>
  fetchAndParseXmlFeed("https://www.traveller.com.au/rss", "Traveller AU", "Travel", "au", ["Australia","Travel"]);
const fetchKoreaHeraldTravel = () =>
  fetchAndParseXmlFeed("http://www.koreaherald.com/rss/090000000000.xml", "Korea Herald Travel", "Travel", "kr", ["Korea","Travel"]);
const fetchMoscowTimesTravel = () =>
  fetchAndParseXmlFeed("https://www.themoscowtimes.com/rss/travel", "Moscow Times Travel", "Travel", "ru", ["Russia","Travel"]);
const fetch38NorthTravel = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP)", "Travel", "kp", ["NorthKorea"]);

/* === Toys === */
const fetchToyBook = () =>
  fetchAndParseXmlFeed("https://toybook.com/feed/", "Toy Book US", "Toys", "us", ["Toys"]);
const fetchToyWorldUK = () =>
  fetchAndParseXmlFeed("https://toyworldmag.co.uk/feed/", "Toy World Magazine UK", "Toys", "uk", ["Toys"]);
const fetchGame4V = () =>
  fetchAndParseXmlFeed("https://game4v.com/feed", "Game4V VN", "Toys", "vn", ["Vietnam","Games","Toys"]);
const fetchLicensingIntlEU = () =>
  fetchAndParseXmlFeed("https://licensinginternational.org/news/feed/", "Licensing International (EU/Global)", "Toys", "eu", ["EU","Licensing","Toys"]);
const fetchGoodSmileJP = () =>
  fetchAndParseXmlFeed("https://www.goodsmile.info/en/rss.xml", "Good Smile (JP) Figures", "Toys", "jp", ["Japan","Figures"]);
const fetchHobbyChinaCN = () =>
  fetchAndParseXmlFeed("https://www.chinahobby.com/rss", "China Hobby (CN)", "Toys", "cn", ["China","Hobby"]);
const fetchToy_AU_ZingPop = () =>
  fetchAndParseXmlFeed("https://www.zingpopculture.com.au/blog?format=rss", "Zing Pop Culture AU", "Toys", "au", ["Australia","Toys"]);
const fetchRU_ToyWorld = () =>
  fetchAndParseXmlFeed("https://www.toynews-online.biz/feed/", "ToyNews (EU/UK/RU market coverage)", "Toys", "ru", ["Toys"]);
const fetchKR_Toys_News = () =>
  fetchAndParseXmlFeed("https://www.inven.co.kr/rss/news.xml", "Inven KR (Merch/Toys)", "Toys", "kr", ["Korea","Toys"]);
const fetchKP_Toys = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP)", "Toys", "kp", ["NorthKorea"]);

/* === Fashion / Beauty === */
const fetchVogueUS = () =>
  fetchAndParseXmlFeed("https://www.vogue.com/feed/rss", "Vogue US", "Fashion", "us", ["Fashion"]);
const fetchGuardianFashion = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/uk/fashion/rss", "Guardian Fashion", "Fashion", "uk", ["Fashion"]);
const fetchElleVN = () =>
  fetchAndParseXmlFeed("https://www.elle.vn/feed", "Elle Vietnam", "Fashion", "vn", ["Vietnam","Fashion"]);
const fetchJingDailyCN = () =>
  fetchAndParseXmlFeed("https://jingdaily.com/feed/", "Jing Daily (CN luxury)", "Fashion", "cn", ["China","Luxury"]);
const fetchVogueJP = () =>
  fetchAndParseXmlFeed("https://www.vogue.co.jp/rss", "Vogue Japan", "Fashion", "jp", ["Japan","Fashion"]);
const fetchRussiaBeyondStyle = () =>
  fetchAndParseXmlFeed("https://www.rbth.com/xml/rss.xml", "Russia Beyond (Lifestyle)", "Fashion", "ru", ["Russia","Lifestyle"]);
const fetchHighsnobietyEU = () =>
  fetchAndParseXmlFeed("https://www.highsnobiety.com/feed", "Highsnobiety (EU)", "Fashion", "eu", ["EU","Streetwear"]);
const fetchGQ_AU = () =>
  fetchAndParseXmlFeed("https://www.gq.com.au/rss", "GQ Australia", "Fashion", "au", ["Australia","Fashion"]);
const fetchHypebeastKR = () =>
  fetchAndParseXmlFeed("https://hypebeast.com/kr/feed", "Hypebeast Korea", "Fashion", "kr", ["Korea","Streetwear"]);
const fetchKP_Fashion = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP)", "Fashion", "kp", ["NorthKorea"]);

/* === Food === */
const fetchBonAppetit = () =>
  fetchAndParseXmlFeed("https://www.bonappetit.com/feed/rss", "Bon Appetit", "Food", "us", ["Food"]);
const fetchBBCGoodFood = () =>
  fetchAndParseXmlFeed("https://www.bbcgoodfood.com/feed/rss", "BBC Good Food", "Food", "uk", ["Food"]);
const fetchMonNgonMoiNgay = () =>
  fetchAndParseXmlFeed("https://monngonmoingay.com/feed/", "Món Ngon Mỗi Ngày", "Food", "vn", ["Vietnam","Food"]);
const fetchWoksOfLifeCN = () =>
  fetchAndParseXmlFeed("https://thewoksoflife.com/feed/", "The Woks of Life (CN cuisine)", "Food", "cn", ["China","Food"]);
const fetchSoraNewsFoodJP = () =>
  fetchAndParseXmlFeed("https://soranews24.com/category/food/feed/", "SoraNews24 Food (JP)", "Food", "jp", ["Japan","Food"]);
const fetchMoscowTimesFood = () =>
  fetchAndParseXmlFeed("https://www.themoscowtimes.com/rss/arts-and-ideas", "Moscow Times Culture/Food", "Food", "ru", ["Russia","Food"]);
const fetchEuronewsFoodEU = () =>
  fetchAndParseXmlFeed("https://www.euronews.com/rss?level=theme&name=living", "Euronews Living (Food)", "Food", "eu", ["EU","Food"]);
const fetchGoodFoodAU = () =>
  fetchAndParseXmlFeed("https://www.goodfood.com.au/rss", "GoodFood AU", "Food", "au", ["Australia","Food"]);
const fetchKoreaTimesFood = () =>
  fetchAndParseXmlFeed("http://www.koreatimes.co.kr/www/rss/culture.xml", "Korea Times Culture/Food", "Food", "kr", ["Korea","Food"]);
const fetch38NorthFood = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP)", "Food", "kp", ["NorthKorea"]);

/* === Cars === */
const fetchCarDriver = () =>
  fetchAndParseXmlFeed("https://www.caranddriver.com/rss/all.xml/", "Car and Driver", "Cars", "us", ["Cars"]);
const fetchAutoCarUK = () =>
  fetchAndParseXmlFeed("https://www.autocar.co.uk/rss", "Autocar UK", "Cars", "uk", ["Cars"]);
const fetchVNExpressCarVN = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/oto-xe-may.rss", "VNExpress Ôtô - Xe Máy", "Cars", "vn", ["Vietnam","Cars"]);
const fetchCarNewsChina = () =>
  fetchAndParseXmlFeed("https://carnewschina.com/feed/", "CarNewsChina", "Cars", "cn", ["China","Cars"]);
const fetchResponseJP = () =>
  fetchAndParseXmlFeed("https://response.jp/rss/index.rdf", "Response.jp (Auto)", "Cars", "jp", ["Japan","Cars"]);
const fetchAutoRU = () =>
  fetchAndParseXmlFeed("https://www.autoreview.ru/rss/all.xml", "Autoreview RU", "Cars", "ru", ["Russia","Cars"]);
const fetchWhichCarAU = () =>
  fetchAndParseXmlFeed("https://www.whichcar.com.au/rss", "WhichCar AU", "Cars", "au", ["Australia","Cars"]);
const fetchEU_Cars = () =>
  fetchAndParseXmlFeed("https://www.euronews.com/rss?level=theme&name=next", "Euronews Next (Mobility/EU)", "Cars", "eu", ["EU","Mobility"]);
const fetchKoreaTimesAuto = () =>
  fetchAndParseXmlFeed("http://www.koreatimes.co.kr/www/rss/tech.xml", "Korea Times Tech/Auto", "Cars", "kr", ["Korea","Auto"]);
const fetch38NorthAuto = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP)", "Cars", "kp", ["NorthKorea"]);

/* === Archaeology === */
const fetchArchaeologyMagazine = () =>
  fetchAndParseXmlFeed("https://www.archaeology.org/rss.xml", "Archaeology Magazine", "Archaeology", "us", ["Archaeology"]);
const fetchCurrentArchaeology = () =>
  fetchAndParseXmlFeed("https://www.archaeology.co.uk/feed", "Current Archaeology UK", "Archaeology", "uk", ["Archaeology"]);
const fetchHeritageVN = () =>
  fetchAndParseXmlFeed("https://baodantoc.vn/rss/van-hoa", "Báo Dân Tộc & Phát Triển - Di Sản", "Archaeology", "vn", ["Vietnam","Culture"]);
const fetchChinaOrgHeritage = () =>
  fetchAndParseXmlFeed("http://www.china.org.cn/rss/2010-07/20/content_20525397.htm", "China.org.cn Heritage (RSS)", "Archaeology", "cn", ["China","Heritage"]);
const fetchMainichiCultureJP = () =>
  fetchAndParseXmlFeed("https://mainichi.jp/english/rss/etc/english.rdf", "The Mainichi (EN) Culture", "Archaeology", "jp", ["Japan","Culture"]);
const fetchTASScultureRU = () =>
  fetchAndParseXmlFeed("https://tass.com/rss/v2.xml", "TASS (RU General/Culture)", "Archaeology", "ru", ["Russia","Culture"]);
const fetchHeritageDailyEU = () =>
  fetchAndParseXmlFeed("https://www.heritagedaily.com/feed", "HeritageDaily (EU/UK)", "Archaeology", "eu", ["EU","Archaeology"]);
const fetchAustArchNews = () =>
  fetchAndParseXmlFeed("https://www.archaeology.org.au/feed/", "Australian Archaeological Association", "Archaeology", "au", ["Australia","Archaeology"]);
const fetchKRCulturalHeritage = () =>
  fetchAndParseXmlFeed("https://english.cha.go.kr/cop/bbs/selectBoardList.do?bbsId=BBSMSTR_1206&ctgryLrcls=CTGRY001&mn=EN_01_02&siteCd=ENG&rss=Y", "KR Cultural Heritage Admin", "Archaeology", "kr", ["Korea","Heritage"]);
const fetch38NorthHeritage = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP)", "Archaeology", "kp", ["NorthKorea","Heritage"]);

/* === News (World/General) === */
const fetchNYTimesWorld = () =>
  fetchAndParseXmlFeed("https://rss.nytimes.com/services/xml/rss/nyt/World.xml", "NYTimes World", "News", "us", ["USA","World"]);
const fetchBBCWorld = () =>
  fetchAndParseXmlFeed("http://feeds.bbci.co.uk/news/world/rss.xml", "BBC World", "News", "uk", ["WorldNews","UK"]);
const fetchGoogleNewsVN = () =>
  fetchAndParseXmlFeed("https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi", "Google News VN", "News", "vn", ["GoogleNewsVN","Vietnam"]);
const fetchSCMP_CN_World = () =>
  fetchAndParseXmlFeed("https://www.scmp.com/rss/2/feed", "SCMP (CN/HK) World", "News", "cn", ["China","World"]);
const fetchNHKWorldNews = () =>
  fetchAndParseXmlFeed("https://www3.nhk.or.jp/nhkworld/en/news/rss/", "NHK World (EN)", "News", "jp", ["Japan","World"]);
const fetchTASS_World = () =>
  fetchAndParseXmlFeed("https://tass.com/rss/v2.xml", "TASS (RU)", "News", "ru", ["Russia","World"]);
const fetchEUobserverNews = () =>
  fetchAndParseXmlFeed("https://euobserver.com/rss", "EUobserver", "News", "eu", ["EU","World"]);
const fetchABC_AU_Top = () =>
  fetchAndParseXmlFeed("https://www.abc.net.au/news/feed/51120/rss.xml", "ABC Australia Top Stories", "News", "au", ["Australia","World"]);
const fetchKoreaHeraldWorld = () =>
  fetchAndParseXmlFeed("http://www.koreaherald.com/rss/021000000000.xml", "Korea Herald World", "News", "kr", ["Korea","World"]);
const fetch38NorthNewsKP = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP)", "News", "kp", ["NorthKorea"]);

/* === Military / Defense === */
const fetchDefenseNews = () =>
  fetchAndParseXmlFeed("https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml", "Defense News", "Military", "us", ["USA","Defense"]);
const fetchUKDefenseJournal = () =>
  fetchAndParseXmlFeed("https://ukdefencejournal.org.uk/feed/", "UK Defence Journal", "Military", "uk", ["UK","Defense"]);
const fetchBaoQuanDoiNhanDan = () =>
  fetchAndParseXmlFeed("https://www.qdnd.vn/rss/qsnd", "Báo Quân đội Nhân dân", "Military", "vn", ["Vietnam","Defense"]);
const fetchGlobalTimesCN_Mil = () =>
  fetchAndParseXmlFeed("https://www.globaltimes.cn/rss/mil.xml", "Global Times (CN) Military", "Military", "cn", ["China","Defense"]);
const fetchJapanTimesDefense = () =>
  fetchAndParseXmlFeed("https://www.japantimes.co.jp/news_category/national/defense-security/feed/", "Japan Times Defense/Security", "Military", "jp", ["Japan","Defense"]);
const fetchTASS_Military = () =>
  fetchAndParseXmlFeed("https://tass.com/rss/v2.xml", "TASS (RU) Military", "Military", "ru", ["Russia","Defense"]);
const fetchNATO_EU = () =>
  fetchAndParseXmlFeed("https://www.nato.int/cps/en/natohq/news.htm?selectedLocale=en&rss=news", "NATO News (EU focus)", "Military", "eu", ["EU","Defense","NATO"]);
const fetchADF_AU = () =>
  fetchAndParseXmlFeed("https://news.defence.gov.au/rss.xml", "Australian Dept of Defence", "Military", "au", ["Australia","Defense"]);
const fetchYonhap_KR_Defense = () =>
  fetchAndParseXmlFeed("https://en.yna.co.kr/RSS", "Yonhap (KR) – RSS Index", "Military", "kr", ["Korea","Defense"]);
const fetch38NorthKP = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP)", "Military", "kp", ["NorthKorea","Defense"]);

/* === Politics === */
const fetchPolitico = () =>
  fetchAndParseXmlFeed("https://www.politico.com/rss/politics.xml", "Politico", "Politics", "us", ["USA","Politics"]);
const fetchGuardianPolitics = () =>
  fetchAndParseXmlFeed("https://www.theguardian.com/politics/rss", "The Guardian Politics", "Politics", "uk", ["UK","Politics"]);
const fetchVNExpressPolitics = () =>
  fetchAndParseXmlFeed("https://vnexpress.net/rss/thoi-su.rss", "VNExpress Politics", "Politics", "vn", ["Vietnam","Politics"]);
const fetchSCMP_CN_Politics = () =>
  fetchAndParseXmlFeed("https://www.scmp.com/rss/3/feed", "SCMP China Politics", "Politics", "cn", ["China","Politics"]);
const fetchJapanTimesPolitics = () =>
  fetchAndParseXmlFeed("https://www.japantimes.co.jp/news_category/national/politics-diplomacy/feed/", "Japan Times Politics", "Politics", "jp", ["Japan","Politics"]);
const fetchMoscowTimesPolitics = () =>
  fetchAndParseXmlFeed("https://www.themoscowtimes.com/rss/politics", "Moscow Times Politics", "Politics", "ru", ["Russia","Politics"]);
const fetchPoliticoEurope = () =>
  fetchAndParseXmlFeed("https://www.politico.eu/feed/", "POLITICO Europe", "Politics", "eu", ["EU","Politics"]);
const fetchABC_AU_Politics = () =>
  fetchAndParseXmlFeed("https://www.abc.net.au/news/feed/2942460/rss.xml", "ABC AU Politics", "Politics", "au", ["Australia","Politics"]);
const fetchKoreaTimesPolitics = () =>
  fetchAndParseXmlFeed("http://www.koreatimes.co.kr/www/rss/nation.xml", "Korea Times Politics/Nation", "Politics", "kr", ["Korea","Politics"]);
const fetch38NorthPolitics = () =>
  fetchAndParseXmlFeed("https://www.38north.org/feed/", "38 North (KP)", "Politics", "kp", ["NorthKorea","Politics"]);

/* ======================================================================
   Main handler
   ======================================================================*/
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
    const { region, category, timeframe, searchTerm, hashtag } =
      event.queryStringParameters || {};

    const sources = [
      // === Technology ===
      fetchHackerNewsFrontpage(),
      fetchTheVerge(),
      fetchBBCtech(),
      fetchVNExpressTech(),
      fetchTechNodeCN(),
      fetchITMediaJP(),
      fetchTJournalRU(),
      fetchEUObserverTech(),
      fetchGizmodoAU(),
      fetchKoreaHeraldTech(),

      // === AI ===
      fetchVentureBeatAI(),
      fetchNatureAI(),
      fetchZingNewsAI(),
      fetchSyncedReviewCN(),
      fetchAISTJP(),
      fetchSecurelistRU, // defined below as function fetchSecurelistRU(); but we used name fetchKasperskyAI RU earlier -> fix call
      // fix: use fetchSecurelistRU()
      // (we push again properly)
      fetchSecurelistRU(),
      fetchEuractivAI(),
      fetchCSIROAI(),
      fetchKISAkr(),

      // === Gaming ===
      fetchIGNGaming(),
      fetchEurogamer(),
      fetchGenKVN(),
      fetchSCMPGamingCN(),
      fetch4GamerJP(),
      fetchIgromaniaRU(),
      fetchEUROgamerEU(),
      fetchPressStartAU(),
      fetchInvenKR(),
      fetch38NorthGamingKP(),

      // === Finance ===
      fetchCNBCFinance(),
      fetchGuardianBusiness(),
      fetchVNExpressFinance(),
      fetchSCMPEconomyCN(),
      fetchNikkeiAsiaBizJP(),
      fetchMoscowTimesBizRU(),
      fetchECBPressEU(),
      fetchABC_AU_Business(),
      fetchKoreaTimesBiz(),
      fetch38NorthEconKP(),

      // === Science ===
      fetchScienceMagazine(),
      fetchNewScientist(),
      fetchVNExpressScience(),
      fetchChinaDailyTechSci(),
      fetchNHKWorldSci(),
      fetchRoscosmosRU(),
      fetchESA_EU(),
      fetchCSIRO_AU(),
      fetchKoreanHeraldSci(),
      fetch38NorthSciKP(),

      // === Music ===
      fetchRollingStone(),
      fetchNME(),
      fetchAppleMusicMostPlayedVN(),
      fetchRADIIChina(),
      fetchTokyoWeekender(),
      fetchMoscowTimesCulture(),
      fetchEuronewsCulture(),
      fetchABC_AU_Arts(),
      fetchKoreaHeraldCulture(),
      fetch38NorthCulture(),

      // === Entertainment ===
      fetchVariety(),
      fetchGuardianCulture(),
      fetchZingNewsEntertainment(),
      fetchSixthToneCultureCN(),
      fetchANN_JP(),
      fetchRT_Arts_RU(),
      fetchEuronewsCultureEU(),
      fetchABC_AU_Entertainment(),
      fetchKoreaTimesCulture(),
      fetch38NorthEntKP(),

      // === Sports ===
      fetchESPN(),
      fetchSkySportsNews(),
      fetchThanhNienSports(),
      fetchChinaDailySports(),
      fetchJapanTimesSports(),
      fetchTASSSportsRU(),
      fetchUEFA_EU(),
      fetchABC_AU_Sport(),
      fetchKoreaTimesSports(),
      fetch38NorthSports(),

      // === Logistics ===
      fetchFreightWaves(),
      fetchTheLoadstar(),
      fetchVNLogistics(),
      fetchChinaBriefing(),
      fetchNikkeiSupplyJP(),
      fetchRailFreightEU(),
      fetchATN_AU(),
      fetchKoreaHeraldBizLog(),
      fetchRU_Trans_Sputnik(),
      fetch38NorthTrade(),

      // === Cybersecurity ===
      fetchKrebsOnSecurity(),
      fetchSCMagUK(),
      fetchVNExpressCyber(),
      fetchQiAnXinCN(),
      fetchJPCERTBlog(),
      fetchSecurelistRU(),
      fetchENISA_EU(),
      fetchASDC_AU(),
      fetchKISA_KR_Cyber(),
      fetch38NorthCyber(),

      // === Healthcare ===
      fetchMedicalNewsToday(),
      fetchNHSNews(),
      fetchSucKhoeDoiSong(),
      fetchChinaDailyHealth(),
      fetchJapanTimesHealth(),
      fetchECDC_EU(),
      fetchABC_AU_Health(),
      fetchKoreaTimesHealth(),
      fetchTASSHealthRU(),
      fetch38NorthHealthKP(),

      // === Education ===
      fetchEdSurge(),
      fetchTimesHigherEd(),
      fetchTuoiTreEducation(),
      fetchChinaDailyEdu(),
      fetchJapanTimesEdu(),
      fetchEurydiceEU(),
      fetchABC_AU_Edu(),
      fetchKoreaHeraldEdu(),
      fetchTASS_EduRU(),
      fetch38NorthEduKP(),

      // === Environment ===
      fetchNatGeoEnvironment(),
      fetchGuardianEnvironment(),
      fetchVNExpressEnvironment(),
      fetchChinaDialogue(),
      fetchJapanTimesEnv(),
      fetchEEA_EU(),
      fetchABC_AU_Environment(),
      fetchKoreaHeraldEnv(),
      fetchTASS_EnvRU(),
      fetch38NorthEnvKP(),

      // === Travel ===
      fetchCNTraveler(),
      fetchGuardianTravel(),
      fetchVNExpressTravel(),
      fetchChinaDailyTravel(),
      fetchJapanGuideBlog(),
      fetchEU_Travel_Euronews(),
      fetchTravellerAU(),
      fetchKoreaHeraldTravel(),
      fetchMoscowTimesTravel(),
      fetch38NorthTravel(),

      // === Toys ===
      fetchToyBook(),
      fetchToyWorldUK(),
      fetchGame4V(),
      fetchLicensingIntlEU(),
      fetchGoodSmileJP(),
      fetchHobbyChinaCN(),
      fetchToy_AU_ZingPop(),
      fetchRU_ToyWorld(),
      fetchKR_Toys_News(),
      fetchKP_Toys(),

      // === Fashion / Beauty ===
      fetchVogueUS(),
      fetchGuardianFashion(),
      fetchElleVN(),
      fetchJingDailyCN(),
      fetchVogueJP(),
      fetchRussiaBeyondStyle(),
      fetchHighsnobietyEU(),
      fetchGQ_AU(),
      fetchHypebeastKR(),
      fetchKP_Fashion(),

      // === Food ===
      fetchBonAppetit(),
      fetchBBCGoodFood(),
      fetchMonNgonMoiNgay(),
      fetchWoksOfLifeCN(),
      fetchSoraNewsFoodJP(),
      fetchMoscowTimesFood(),
      fetchEuronewsFoodEU(),
      fetchGoodFoodAU(),
      fetchKoreaTimesFood(),
      fetch38NorthFood(),

      // === Cars ===
      fetchCarDriver(),
      fetchAutoCarUK(),
      fetchVNExpressCarVN(),
      fetchCarNewsChina(),
      fetchResponseJP(),
      fetchAutoRU(),
      fetchWhichCarAU(),
      fetchEU_Cars(),
      fetchKoreaTimesAuto(),
      fetch38NorthAuto(),

      // === Archaeology ===
      fetchArchaeologyMagazine(),
      fetchCurrentArchaeology(),
      fetchHeritageVN(),
      fetchChinaOrgHeritage(),
      fetchMainichiCultureJP(),
      fetchTASScultureRU(),
      fetchHeritageDailyEU(),
      fetchAustArchNews(),
      fetchKRCulturalHeritage(),
      fetch38NorthHeritage(),

      // === News ===
      fetchNYTimesWorld(),
      fetchBBCWorld(),
      fetchGoogleNewsVN(),
      fetchSCMP_CN_World(),
      fetchNHKWorldNews(),
      fetchTASS_World(),
      fetchEUobserverNews(),
      fetchABC_AU_Top(),
      fetchKoreaHeraldWorld(),
      fetch38NorthNewsKP(),

      // === Military ===
      fetchDefenseNews(),
      fetchUKDefenseJournal(),
      fetchBaoQuanDoiNhanDan(),
      fetchGlobalTimesCN_Mil(),
      fetchJapanTimesDefense(),
      fetchTASS_Military(),
      fetchNATO_EU(),
      fetchADF_AU(),
      fetchYonhap_KR_Defense(),
      fetch38NorthKP(),

      // === Politics ===
      fetchPolitico(),
      fetchGuardianPolitics(),
      fetchVNExpressPolitics(),
      fetchSCMP_CN_Politics(),
      fetchJapanTimesPolitics(),
      fetchMoscowTimesPolitics(),
      fetchPoliticoEurope(),
      fetchABC_AU_Politics(),
      fetchKoreaTimesPolitics(),
      fetch38NorthPolitics(),
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

    // Unique by stable hash id
    const uniqueTrendsMap = new Map();
    for (const trend of allFetchedTrends) {
      if (trend && trend.id) uniqueTrendsMap.set(trend.id, trend);
    }
    allFetchedTrends = Array.from(uniqueTrendsMap.values());

    if (allFetchedTrends.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          trends: [],
          message: "No trends found from any source.",
        }),
      };
    }

    // Filters
    let filteredTrends = allFetchedTrends;

    if (region && region !== "global") {
      filteredTrends = filteredTrends.filter(
        (t) => t.region && t.region.toLowerCase() === region.toLowerCase()
      );
    }
    if (category && category !== "All") {
      filteredTrends = filteredTrends.filter(
        (t) => t.category && t.category.toLowerCase() === category.toLowerCase()
      );
    }
    if (timeframe && timeframe !== "all") {
      const now = new Date();
      let cutoffDate = new Date(now);
      switch (timeframe) {
        case "7d":
          cutoffDate.setDate(now.getDate() - 7);
          break;
        case "1m":
          cutoffDate.setDate(now.getDate() - 30);
          break;
        case "12m":
          cutoffDate.setFullYear(now.getFullYear() - 1);
          break;
      }
      cutoffDate.setHours(0, 0, 0, 0);
      filteredTrends = filteredTrends.filter((t) => {
        const trendDate = new Date(t.date);
        trendDate.setHours(0, 0, 0, 0);
        return trendDate >= cutoffDate;
      });
    }
    if (searchTerm) {
      const termLower = searchTerm.toLowerCase();
      filteredTrends = filteredTrends.filter(
        (t) =>
          (t.title_en && t.title_en.toLowerCase().includes(termLower)) ||
          (t.description_en &&
            t.description_en.toLowerCase().includes(termLower)) ||
          (t.title_vi && t.title_vi.toLowerCase().includes(termLower)) ||
          (t.description_vi &&
            t.description_vi.toLowerCase().includes(termLower)) ||
          (t.tags && t.tags.some((tag) => tag.toLowerCase().includes(termLower)))
      );
    }
    if (hashtag) {
      const hashtagLower = hashtag.toLowerCase();
      filteredTrends = filteredTrends.filter(
        (t) => t.tags && t.tags.some((tag) => tag.toLowerCase() === hashtagLower)
      );
    }

    // Sort newest first
    filteredTrends = filteredTrends
      .filter(Boolean)
      .sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));

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
      body: JSON.stringify({
        success: false,
        error: "Failed to fetch trends",
        message: err.message,
      }),
    };
  }
};
