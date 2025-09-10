// netlify/functions/trends-builder.js
const { builder } = require("@netlify/functions");
const fetch = require("node-fetch");
const { XMLParser } = require("fast-xml-parser");
const crypto = require('crypto');
const NewsAPI = require('newsapi');

// Khởi tạo NewsAPI client với API key từ biến môi trường
const newsapi = new NewsAPI(process.env.NEWS_API_KEY);

// =========================================================================
// HÀM HELPER
// =========================================================================

async function fetchWithTimeout(url, options = {}, ms = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        const res = await fetch(url, {
            ...options, signal: controller.signal, headers: {
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
    } finally { clearTimeout(timer); }
}

function getSafeString(value) {
    if (value === null || value === undefined) return "";
    let strValue = "";
    if (typeof value === 'string') strValue = value;
    else if (typeof value === 'object' && value.hasOwnProperty('#text')) strValue = String(value['#text']);
    else if (typeof value === 'object' && value.hasOwnProperty('href')) strValue = String(value.href);
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
    const weights = { views: 0.2, interactions: 0.4, searches: 0.3, votes: 0.1 };
    const normViews = (trend.views / maxValues.views) || 0;
    const normInteractions = (trend.interactions / maxValues.interactions) || 0;
    const normSearches = (trend.searches / maxValues.searches) || 0;
    const normVotes = (trend.votes / maxValues.votes) || 0;
    return (normViews * weights.views) + (normInteractions * weights.interactions) + (normSearches * weights.searches) + (normVotes * weights.votes);
}

/**
 * Suy luận category từ tên của nguồn tin tức (đã mở rộng).
 */
function inferCategoryFromName(sourceName) {
    if (!sourceName) return "News";
    const name = sourceName.toLowerCase();
    const categoryMap = {
        'Technology': ['tech', 'digital', 'wired', 'gadget', 'ai', 'crypto', 'computing', 'khoa-hoc', 'so-hoa', 'công nghệ'],
        'Business': ['business', 'finance', 'market', 'economic', 'wsj', 'bloomberg', 'ft.com', 'cafef', 'kinh doanh'],
        'Sports': ['sport', 'espn', 'football', 'nba', 'f1', 'the-thao', 'thể thao'],
        'Entertainment': ['entertainment', 'showbiz', 'movies', 'music', 'hollywood', 'variety', 'giai-tri', 'culture', 'phim'],
        'Science': ['science', 'space', 'nature', 'research', 'khảo cổ'],
        'Health': ['health', 'medical', 'wellness', 'pharma', 'suckhoedoisong', 'sức khỏe'],
        'Politics': ['politic', 'government', 'white house', 'thoi-su', 'chính trị'],
        'Cars': ['car', 'auto', 'driver', 'oto-xe-may', 'ô tô'],
        'Fashion': ['fashion', 'vogue', 'elle', 'bazaar', 'style', 'thời trang'],
        'Travel': ['travel', 'lonely planet', 'du-lich', 'du lịch'],
        'Food': ['food', 'bon appetit', 'recipe', 'am-thuc', 'ẩm thực'],
        'Gaming': ['game', 'ign', 'esports', 'gamek'],
        'Education': ['education', 'higher-ed', 'giao-duc', 'giáo dục'],
        'Family': ['family', 'parents', 'afamily', 'gia đình'],
        'Lifestyle': ['lifestyle', 'life', 'đời sống'],
        'Beauty': ['beauty', 'allure', 'cosmetics', 'làm đẹp'],
        'Cybersecurity': ['cybersecurity', 'security', 'an ninh mạng'],
    };
    for (const category in categoryMap) {
        for (const keyword of categoryMap[category]) {
            if (name.includes(keyword)) return category;
        }
    }
    return "News";
}

function normalizeNewsApiArticle(article, keyword, region) {
    const { title, description, url, publishedAt, source } = article;
    if (!title || title === "[Removed]" || !url) return null;
    const category = inferCategoryFromName(source.name);
    const stableId = crypto.createHash('md5').update(url).digest('hex');
    const baseVotes = Math.floor(Math.random() * 500) + 200;
    return {
        id: stableId,
        title_en: title, description_en: description || "No description available.", title_vi: null, description_vi: null,
        category: category, tags: [...new Set([keyword.replace(/\s/g, ''), source.name.replace(/\s/g, ''), region, category])],
        votes: baseVotes, views: Math.floor(baseVotes * (Math.random() * 10 + 15)),
        interactions: Math.floor(baseVotes * (Math.random() * 3 + 4)), searches: Math.floor(baseVotes * (Math.random() * 1 + 1.5)),
        source: url, date: toDateStr(publishedAt), sortKey: toSortValue(publishedAt),
        submitter: source.name || "Unknown Source", region: region,
    };
}

// =========================================================================
// LUỒNG CHÍNH: NEWSAPI
// =========================================================================

async function getTrendsFromNewsAPI() {
    if (!process.env.NEWS_API_KEY) throw new Error("NEWS_API_KEY is not configured.");
    console.log("🚀 Starting primary flow: NewsAPI Top Headlines...");
    const requests = [
        { country: 'us', regionCode: 'us', pageSize: 15 },
        { country: 'gb', regionCode: 'gb', pageSize: 15 },
        { category: 'technology', regionCode: 'global', pageSize: 15 }
    ];
    const apiPromises = requests.map(params => {
        const { regionCode, ...apiParams } = params;
        return newsapi.v2.topHeadlines(apiParams).then(response => {
            if (response.status === 'ok' && response.articles.length > 0) {
                console.log(`✅ Fetched ${response.articles.length} headlines for ${regionCode}`);
                return response.articles.map(article => normalizeNewsApiArticle(article, article.title.split(' ')[0], regionCode)).filter(Boolean);
            }
            return [];
        }).catch(err => { console.error(`❌ Error fetching for ${regionCode}:`, err.message); return []; });
    });
    const results = await Promise.all(apiPromises);
    const allTrends = results.flat();
    console.log(`✅ Primary flow successful. Total trends: ${allTrends.length}`);
    return allTrends;
}

// =========================================================================
// LUỒNG DỰ PHÒNG (FALLBACK): RSS
// =========================================================================

function createStandardTrend(item, sourceName, defaultCategory = "General", defaultRegion = "global", extraTags = []) {
    const title = getSafeString(item.title) || "No Title Available";
    const description = getSafeString(item.description) || "No description available";
    let link = getSafeString(item.link);
    if (Array.isArray(item.link)) {
        const firstLink = item.link.find(l => l.rel === 'alternate' || !l.rel);
        link = getSafeString(firstLink?.href || item.link[0]);
    } else if (typeof item.link === 'object' && item.link.href) { link = getSafeString(item.link.href); }
    link = link || "#";
    const pubDate = getSafeString(item.pubDate || item.published) || new Date().toISOString();
    const cleanedTitle = title.replace(/<[^>]*>?/gm, '').trim();
    const cleanedDescription = description.replace(/<[^>]*>?/gm, '').trim();
    const stableId = crypto.createHash('md5').update(`${link}-${cleanedTitle}`).digest('hex');
    const category = (defaultCategory !== "General") ? defaultCategory : inferCategoryFromName(sourceName);
    const baseVotes = Math.floor(Math.random() * 2000) + 1000;
    return {
        id: stableId,
        title_en: defaultRegion !== 'vn' ? cleanedTitle : null,
        description_en: defaultRegion !== 'vn' ? cleanedDescription : null,
        title_vi: defaultRegion === 'vn' ? cleanedTitle : null,
        description_vi: defaultRegion === 'vn' ? cleanedDescription : null,
        category: category, tags: [...new Set([...extraTags, sourceName.replace(/\s/g, ""), defaultRegion, category].filter(Boolean))],
        votes: baseVotes, views: Math.floor(baseVotes * (Math.random() * 10 + 15)),
        interactions: Math.floor(baseVotes * (Math.random() * 3 + 4)), searches: Math.floor(baseVotes * (Math.random() * 1 + 1.5)),
        source: link, date: toDateStr(pubDate), sortKey: toSortValue(pubDate),
        submitter: sourceName || "Unknown", region: defaultRegion,
    };
}

async function fetchAndParseXmlFeed(url, sourceName, defaultCategory, defaultRegion, extraTags = []) {
    try {
        const res = await fetchWithTimeout(url);
        const text = await res.text();
        const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", textNodeName: "#text", isArray: (name) => ["item", "entry", "link"].includes(name) });
        const parsed = parser.parse(text);
        const rawItems = parsed?.rss?.channel?.item || parsed?.feed?.entry || [];
        return rawItems.map(item => createStandardTrend(item, sourceName, defaultCategory, defaultRegion, extraTags));
    } catch (err) {
        console.error(`❌ RSS Error for ${sourceName} (${url}):`, err.message);
        return [];
    }
}

async function getTrendsFromRssFallback() {
    console.log("⚡️ Initiating RSS Fallback flow (with extensive VN sources)...");
    const fetchers = [
        // === VIETNAM ===
        () => fetchAndParseXmlFeed("https://vnexpress.net/rss/tin-moi-nhat.rss", "VNExpress", "News", "vn"),
        () => fetchAndParseXmlFeed("https://vnexpress.net/rss/the-gioi.rss", "VNExpress World", "Politics", "vn"),
        () => fetchAndParseXmlFeed("https://vnexpress.net/rss/kinh-doanh.rss", "VNExpress Business", "Business", "vn"),
        () => fetchAndParseXmlFeed("https://vnexpress.net/rss/so-hoa.rss", "VNExpress Technology", "Technology", "vn"),
        () => fetchAndParseXmlFeed("https://vnexpress.net/rss/giai-tri.rss", "VNExpress Entertainment", "Entertainment", "vn"),
        () => fetchAndParseXmlFeed("https://vnexpress.net/rss/the-thao.rss", "VNExpress Sports", "Sports", "vn"),
        () => fetchAndParseXmlFeed("https://vnexpress.net/rss/du-lich.rss", "VNExpress Travel", "Travel", "vn"),
        () => fetchAndParseXmlFeed("https://cafef.vn/trang-chu.rss", "CafeF", "Business", "vn"),
        () => fetchAndParseXmlFeed("https://gamek.vn/home.rss", "GameK", "Gaming", "vn"),
        () => fetchAndParseXmlFeed("https://tuoitre.vn/rss/giao-duc.rss", "Tuổi Trẻ Education", "Education", "vn"),
        () => fetchAndParseXmlFeed("https://afamily.vn/rss/home.rss", "Afamily", "Family", "vn"),
        () => fetchAndParseXmlFeed("https://suckhoedoisong.vn/rss/home.rss", "Sức Khỏe & Đời Sống", "Health", "vn"),

        // === INTERNATIONAL (for variety) ===
        () => fetchAndParseXmlFeed("https://www.chinadaily.com.cn/rss/cnews.xml", "China Daily", "News", "cn"),
        () => fetchAndParseXmlFeed("https://pandaily.com/feed/", "Pandaily", "Technology", "cn"),
        () => fetchAndParseXmlFeed("https://techcrunch.com/feed/", "TechCrunch", "Technology", "us"),
        () => fetchAndParseXmlFeed("https://www.vogue.com/feed/rss", "Vogue", "Fashion", "us"),
        () => fetchAndParseXmlFeed("http://feeds.bbci.co.uk/news/rss.xml", "BBC News", "News", "uk"),
    ];
    const results = await Promise.allSettled(fetchers.map(f => f()));
    const fallbackTrends = results.filter(r => r.status === 'fulfilled' && r.value).flatMap(r => r.value);
    console.log(`✅ RSS Fallback completed, found ${fallbackTrends.length} trends.`);
    return fallbackTrends;
}

// =========================================================================
// BUILDER HANDLER CHÍNH
// =========================================================================

exports.handler = builder(async (event, context) => {
    const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
    try {
        // Luôn chạy cả hai luồng để có dữ liệu đa dạng nhất
        const primaryPromise = getTrendsFromNewsAPI();
        const fallbackPromise = getTrendsFromRssFallback();

        const [primaryTrends, fallbackTrends] = await Promise.all([primaryPromise, fallbackPromise]);

        // Gộp kết quả và loại bỏ trùng lặp
        const trendMap = new Map();
        [...primaryTrends, ...fallbackTrends].forEach(t => { if (t && t.id) trendMap.set(t.id, t) });
        let finalTrends = Array.from(trendMap.values());

        if (finalTrends.length === 0) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: true, trends: [], message: "No trends found from any source." }),
            };
        }

        const maxValues = {
            views: Math.max(1, ...finalTrends.map(t => t.views || 0)),
            interactions: Math.max(1, ...finalTrends.map(t => t.interactions || 0)),
            searches: Math.max(1, ...finalTrends.map(t => t.searches || 0)),
            votes: Math.max(1, ...finalTrends.map(t => t.votes || 0)),
        };
        const preprocessedTrends = finalTrends.map(trend => ({
            ...trend,
            hotnessScore: calculateHotnessScore(trend, maxValues),
            type: trend.type || (Math.random() > 0.5 ? 'topic' : 'query')
        }));

        const sortedTrends = preprocessedTrends.filter(Boolean).sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));

        return {
            statusCode: 200,
            headers: { ...headers, "Cache-Control": "public, max-age=1800, must-revalidate" }, // Cache 30 phút
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
});
