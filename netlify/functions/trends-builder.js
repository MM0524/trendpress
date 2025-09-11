// netlify/functions/trends-builder.js
const { XMLParser } = require("fast-xml-parser");
const crypto = require("crypto");
const NewsAPI = require("newsapi");
const googleTrends = require("google-trends-api");

// Sử dụng dynamic import cho node-fetch để tương thích với nhiều môi trường Node.js
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

// Khởi tạo NewsAPI client
const newsapi = new NewsAPI(process.env.NEWS_API_KEY);

// =========================================================================
// HÀM HELPER
// =========================================================================

async function fetchWithTimeout(url, options = {}, ms = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        const res = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
                "Accept": "application/xml, text/xml, application/rss+xml, application/atom+xml, application/json, text/plain, */*",
                ...(options.headers || {}),
            },
        });
        if (!res.ok) throw new Error(`HTTP error! Status: ${res.status} from ${url}`);
        return res;
    } catch (err) {
        if (err.name === "AbortError") throw new Error(`Request to ${url} timed out.`);
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

function getSafeString(value) {
    if (value === null || value === undefined) return "";
    let strValue = "";
    if (typeof value === "string") strValue = value;
    else if (typeof value === "object" && value.hasOwnProperty("#text")) strValue = String(value["#text"]);
    else if (typeof value === "object" && value.hasOwnProperty("href")) strValue = String(value.href);
    else if (Array.isArray(value)) strValue = String(value[0]);
    else strValue = String(value);
    return decodeHtmlEntities(strValue).trim();
}

function decodeHtmlEntities(str = "") {
    return str.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function toDateStr(d) {
    const dt = d ? new Date(d) : new Date();
    return isNaN(dt.getTime()) ? new Date().toISOString().split("T")[0] : dt.toISOString().split("T")[0];
}

function toSortValue(d) {
    const dt = d ? new Date(d) : null;
    return dt && !isNaN(dt.getTime()) ? dt.getTime() : 0;
}

function calculateHotnessScore(trend, maxValues) {
    const weights = { views: 0.3, interactions: 0.4, searches: 0.3 };
    const normViews = (trend.views / maxValues.views) || 0;
    const normInteractions = (trend.interactions / maxValues.interactions) || 0;
    const normSearches = (trend.searches / maxValues.searches) || 0;
    return (normViews * weights.views + normInteractions * weights.interactions + normSearches * weights.searches);
}

function inferCategoryFromName(sourceName) {
    if (!sourceName) return "News";
    const name = sourceName.toLowerCase();
    const categoryMap = {
        'Technology': ["tech", "digital", "wired", "gadget", "ai", "crypto", "computing", "khoa-hoc", "so-hoa", "công nghệ"],
        'Business': ["business", "finance", "market", "economic", "wsj", "bloomberg", "ft.com", "cafef", "kinh doanh"],
        'Sports': ["sport", "espn", "football", "nba", "f1", "the-thao", "thể thao"],
        'Entertainment': ["entertainment", "showbiz", "movies", "music", "hollywood", "variety", "giai-tri", "culture", "phim"],
        'Science': ["science", "space", "nature", "research", "khảo cổ"],
        'Health': ["health", "medical", "wellness", "pharma", "suckhoedoisong", "sức khỏe"],
        'Politics': ["politic", "government", "white house", "thoi-su", "chính trị"],
        'Cars': ["car", "auto", "driver", "oto-xe-may", "ô tô"],
        'Fashion': ["fashion", "vogue", "elle", "bazaar", "style", "thời trang"],
        'Travel': ["travel", "lonely planet", "du-lich", "du lịch"],
        'Food': ["food", "bon appetit", "recipe", "am-thuc", "ẩm thực"],
        'Gaming': ["game", "ign", "esports", "gamek"],
        'Education': ["education", "higher-ed", "giao-duc", "giáo dục"],
        'Family': ["family", "parents", "afamily", "gia đình"],
        'Lifestyle': ["lifestyle", "life", "đời sống"],
        'Beauty': ["beauty", "allure", "cosmetics", "làm đẹp"],
        'Cybersecurity': ["cybersecurity", "security", "an ninh mạng"],
    };
    for (const category in categoryMap) {
        for (const keyword of categoryMap[category]) {
            if (name.includes(keyword)) return category;
        }
    }
    return "News";
}

// =========================================================================
// CÁC HÀM LẤY DỮ LIỆU TỪ TỪNG NGUỒN
// =========================================================================

async function getTrendsFromGoogleTrends() {
    console.log("🚀 Fetching Google Trends (Global + VN)...");
    try {
        const [globalDaily, vnDaily] = await Promise.all([
            googleTrends.dailyTrends({ geo: "US" }),
            googleTrends.dailyTrends({ geo: "VN" }),
        ]);

        const parsedGlobal = JSON.parse(globalDaily);
        const parsedVN = JSON.parse(vnDaily);

        const mapToTrend = (item, region) => {
            const stableId = crypto.createHash("md5").update(`${item.title.query}-${region}`).digest("hex");
            return {
                id: stableId,
                title_en: region !== "vn" ? item.title.query : null,
                description_en: region !== "vn" ? `Trending search query related to: ${item.articles?.[0]?.title || item.title.query}` : null,
                title_vi: region === "vn" ? item.title.query : null,
                description_vi: region === "vn" ? `Từ khóa tìm kiếm thịnh hành liên quan đến: ${item.articles?.[0]?.title || item.title.query}` : null,
                category: "Trending",
                tags: [region, "google-trends"],
                views: Math.floor(Math.random() * 50000) + 10000,
                interactions: Math.floor(Math.random() * 20000) + 5000,
                searches: Math.floor(Math.random() * 30000) + 8000,
                source: item.articles?.[0]?.url || "https://trends.google.com",
                date: toDateStr(),
                sortKey: Date.now(),
                submitter: "Google Trends",
                region: region,
            };
        };

        const globalTrends = parsedGlobal.default.trendingSearchesDays[0]?.trendingSearches.map((t) => mapToTrend(t, "global")) || [];
        const vnTrends = parsedVN.default.trendingSearchesDays[0]?.trendingSearches.map((t) => mapToTrend(t, "vn")) || [];

        console.log(`✅ Google Trends fetched: ${globalTrends.length} global + ${vnTrends.length} vn`);
        return [...globalTrends, ...vnTrends];
    } catch (err) {
        console.warn(`⚠️ Google Trends API failed (likely blocked), returning empty array. Error: ${err.message}`);
        return [];
    }
}

function normalizeNewsApiArticle(article, category, region = "global") {
    const { title, description, url, publishedAt, source } = article;
    if (!title || title === "[Removed]" || !url) return null;
    const stableId = crypto.createHash("md5").update(url).digest("hex");
    const baseInteractions = Math.floor(Math.random() * 500) + 200;
    return {
        id: stableId,
        title_en: title,
        description_en: description || "No description available.",
        title_vi: null, description_vi: null,
        category: category.charAt(0).toUpperCase() + category.slice(1),
        tags: [...new Set([category, source.name.replace(/\s/g, ""), region])],
        views: Math.floor(baseInteractions * (Math.random() * 5 + 10)),
        interactions: baseInteractions,
        searches: Math.floor(baseInteractions * (Math.random() * 2 + 3)),
        source: url,
        date: toDateStr(publishedAt),
        sortKey: toSortValue(publishedAt),
        submitter: source.name || "Unknown Source",
        region: region,
    };
}

async function getTrendsFromNewsAPI() {
    console.log("🚀 Starting GLOBAL NewsAPI fetch...");
    try {
        if (!process.env.NEWS_API_KEY) throw new Error("NEWS_API_KEY is not configured.");
        const categories = ["business", "entertainment", "general", "health", "science", "sports", "technology"];
        const apiPromises = categories.map((category) =>
            newsapi.v2.topHeadlines({
                category: category, language: "en", pageSize: 20,
            }).then((response) => {
                if (response.status === "ok" && response.articles.length > 0) {
                    return response.articles.map((a) => normalizeNewsApiArticle(a, category, "global")).filter(Boolean);
                }
                return [];
            })
        );
        const results = await Promise.all(apiPromises);
        const allTrends = results.flat();
        console.log(`✅ NewsAPI fetch successful. Total trends: ${allTrends.length}`);
        return allTrends;
    } catch (err) {
        console.error(`❌ NewsAPI failed critically: ${err.message}`);
        return [];
    }
}

function createStandardTrend(item, sourceName, defaultCategory = "General", defaultRegion = "global", extraTags = []) {
    const title = getSafeString(item.title);
    if (!title) return null;
    const description = getSafeString(item.description) || "No description available";
    let link = getSafeString(item.link);
    if (Array.isArray(item.link)) {
        const firstLink = item.link.find((l) => l.rel === "alternate" || !l.rel);
        link = getSafeString(firstLink?.href || item.link[0]);
    } else if (typeof item.link === "object" && item.link.href) {
        link = getSafeString(item.link.href);
    }
    link = link || "#";
    const pubDate = getSafeString(item.pubDate || item.published) || new Date().toISOString();
    const cleanedTitle = title.replace(/<[^>]*>?/gm, "").trim();
    const cleanedDescription = description.replace(/<[^>]*>?/gm, "").trim();
    const stableId = crypto.createHash("md5").update(`${link}-${cleanedTitle}`).digest("hex");
    const category = defaultCategory !== "General" ? defaultCategory : inferCategoryFromName(sourceName);
    const baseInteractions = Math.floor(Math.random() * 2000) + 1000;
    return {
        id: stableId,
        title_en: defaultRegion !== "vn" ? cleanedTitle : null,
        description_en: defaultRegion !== "vn" ? cleanedDescription : null,
        title_vi: defaultRegion === "vn" ? cleanedTitle : null,
        description_vi: defaultRegion === "vn" ? cleanedDescription : null,
        category: category,
        tags: [...new Set([ ...extraTags, sourceName.replace(/\s/g, ""), defaultRegion, category ].filter(Boolean))],
        views: Math.floor(baseInteractions * (Math.random() * 5 + 10)),
        interactions: baseInteractions,
        searches: Math.floor(baseInteractions * (Math.random() * 2 + 3)),
        source: link,
        date: toDateStr(pubDate),
        sortKey: toSortValue(pubDate),
        submitter: sourceName || "Unknown",
        region: defaultRegion,
    };
}

async function fetchAndParseXmlFeed(url, sourceName, defaultCategory, defaultRegion, extraTags = []) {
    try {
        const res = await fetchWithTimeout(url);
        const text = await res.text();
        const parser = new XMLParser({
            ignoreAttributes: false, attributeNamePrefix: "", textNodeName: "#text", isArray: (name) => ["item", "entry", "link"].includes(name),
        });
        const parsed = parser.parse(text);
        const rawItems = parsed?.rss?.channel?.item || parsed?.feed?.entry || [];
        return rawItems.map((item) => createStandardTrend(item, sourceName, defaultCategory, defaultRegion, extraTags)).filter(Boolean);
    } catch (err) {
        console.error(`❌ RSS Error for ${sourceName} (${url}):`, err.message);
        return [];
    }
}

async function getTrendsFromRssFallback() {
    console.log("⚡️ Starting RSS Fallback flow...");
    try {
        const fetchers = [
            () => fetchAndParseXmlFeed("https://vnexpress.net/rss/tin-moi-nhat.rss", "VNExpress", "News", "vn"),
            () => fetchAndParseXmlFeed("http://feeds.bbci.co.uk/news/rss.xml", "BBC News", "News", "uk"),
            // Thêm các nguồn RSS khác của bạn ở đây nếu muốn
        ];
        const results = await Promise.allSettled(fetchers.map((f) => f()));
        const allRssTrends = results.filter((r) => r.status === "fulfilled" && r.value).flatMap((r) => r.value);
        console.log(`✅ RSS Fallback successful. Total trends: ${allRssTrends.length}`);
        return allRssTrends;
    } catch (err) {
        console.error(`❌ RSS Fallback failed critically: ${err.message}`);
        return [];
    }
}

// =========================================================================
// HANDLER CHÍNH
// =========================================================================
exports.handler = async (event, context) => {
    const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

    try {
        const [newsApiTrends, rssTrends, googleTrendsData] = await Promise.all([
            getTrendsFromNewsAPI(),
            getTrendsFromRssFallback(),
            getTrendsFromGoogleTrends(),
        ]);

        const trendMap = new Map();
        [...newsApiTrends, ...rssTrends, ...googleTrendsData].forEach((t) => {
            if (t && t.id) trendMap.set(t.id, t);
        });
        let finalTrends = Array.from(trendMap.values());

        if (finalTrends.length === 0) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: true, trends: [], message: "No trends found from any source." }),
            };
        }

        const maxValues = {
            views: Math.max(1, ...finalTrends.map((t) => t.views || 0)),
            interactions: Math.max(1, ...finalTrends.map((t) => t.interactions || 0)),
            searches: Math.max(1, ...finalTrends.map((t) => t.searches || 0)),
        };

        const preprocessedTrends = finalTrends.map((trend) => ({
            ...trend,
            hotnessScore: calculateHotnessScore(trend, maxValues),
            type: trend.type || (Math.random() > 0.5 ? "topic" : "query"),
        }));

        const sortedTrends = preprocessedTrends.filter(Boolean).sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));

        return {
            statusCode: 200,
            headers: { ...headers, "Cache-Control": "public, max-age=1800" }, // Cache 30 phút
            body: JSON.stringify({ success: true, trends: sortedTrends }),
        };

    } catch (err) {
        console.error("trends-builder handler CRITICAL error:", err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ success: false, error: "Failed to build trends", message: err.message }),
        };
    }
};
