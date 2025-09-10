// netlify/functions/trends-builder.js
const { builder } = require("@netlify/functions");
const fetch = require("node-fetch");
const { XMLParser } = require("fast-xml-parser");
const crypto = require('crypto');
const googleTrends = require('google-trends-api');
const NewsAPI = require('newsapi');

// Khởi tạo NewsAPI client với API key từ biến môi trường
const newsapi = new NewsAPI(process.env.NEWS_API_KEY);

// =========================================================================
// HÀM HELPER CHUẨN (Giữ nguyên và bổ sung)
// =========================================================================

async function fetchWithTimeout(url, options = {}, ms = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36", ...(options.headers || {}) },
    });
    if (!res.ok) throw new Error(`HTTP error! Status: ${res.status} from ${url}`);
    return res;
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`Request to ${url} timed out after ${ms}ms.`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function getSafeString(value) {
    // ... (Giữ nguyên hàm này từ file gốc của bạn)
    if (value === null || value === undefined) return "";
    let strValue = "";
    if (typeof value === 'string') strValue = value;
    else if (typeof value === 'object' && value.hasOwnProperty('#text')) strValue = String(value['#text']);
    else if (typeof value === 'object' && value.hasOwnProperty('href')) strValue = String(value.href);
    else if (Array.isArray(value)) strValue = String(value[0]);
    else strValue = String(value);
    return strValue.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
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

// =========================================================================
// LUỒNG CHÍNH MỚI: GOOGLE TRENDS -> NEWSAPI
// =========================================================================

/**
 * Chuẩn hóa một bài báo từ NewsAPI thành đối tượng trend của ứng dụng.
 * @param {object} article - Đối tượng bài báo từ NewsAPI.
 * @param {string} keyword - Từ khóa Google Trend đã tạo ra bài báo này.
 * @param {string} region - Mã khu vực (ví dụ: 'us', 'vn').
 * @returns {object} - Đối tượng trend đã được chuẩn hóa.
 */
function normalizeNewsApiArticle(article, keyword, region) {
  const { title, description, url, publishedAt, source } = article;

  if (!title || title === "[Removed]" || !url) {
    return null;
  }

  const stableId = crypto.createHash('md5').update(url).digest('hex');
  const baseVotes = Math.floor(Math.random() * 500) + 200; // Mock data
  const baseMultiplier = (Math.random() * 1.5) + 0.5;

  const trend = {
    id: stableId,
    title_en: title,
    description_en: description || "No description available.",
    title_vi: null, // NewsAPI không cung cấp bản dịch, frontend sẽ tự fallback
    description_vi: null,
    category: "News", // Gán category chung cho các tin tức từ NewsAPI
    tags: [...new Set([keyword.replace(/\s/g, ''), source.name.replace(/\s/g, ''), region])],
    votes: baseVotes,
    views: Math.floor(baseVotes * (baseMultiplier * (Math.random() * 10 + 15))),
    interactions: Math.floor(baseVotes * (baseMultiplier * (Math.random() * 3 + 4))),
    searches: Math.floor(baseVotes * (baseMultiplier * (Math.random() * 1 + 1.5))),
    source: url,
    date: toDateStr(publishedAt),
    sortKey: toSortValue(publishedAt),
    submitter: source.name || "Unknown Source",
    region: region,
  };
  return trend;
}

/**
 * LẤY TRENDS TRỰC TIẾP TỪ NEWSAPI TOP HEADLINES (ỔN ĐỊNH)
 * Luồng này không còn phụ thuộc vào Google Trends.
 * @returns {Promise<Array>} - Một mảng các đối tượng trend.
 */
async function getTrendsFromNewsAPI() {
  if (!process.env.NEWS_API_KEY) {
    throw new Error("NEWS_API_KEY is not configured in environment variables.");
  }

  console.log("🚀 Starting primary flow: NewsAPI Top Headlines...");

  try {
    // 1. Lấy các tin tức hàng đầu từ NewsAPI cho một khu vực cụ thể (ví dụ: US)
    const response = await newsapi.v2.topHeadlines({
      country: 'us', // Lấy tin tức hàng đầu tại Mỹ. Bạn có thể đổi sang 'gb', 'ca', v.v.
      pageSize: 30, // Lấy khoảng 30 tin tức hàng đầu
    });

    if (response.status !== 'ok' || response.articles.length === 0) {
      console.warn("⚠️ No articles returned from NewsAPI top-headlines.");
      return []; // Trả về mảng rỗng để có thể kích hoạt fallback nếu cần
    }

    console.log(`✅ Fetched ${response.articles.length} top headlines from NewsAPI.`);

    // 2. Chuẩn hóa các bài báo này thành đối tượng trend
    // Từ khóa (keyword) bây giờ có thể lấy từ chính title của bài báo
    const allTrends = response.articles
      .map(article => {
        // Lấy 1-2 từ khóa chính từ tiêu đề để làm tag
        const titleKeywords = article.title.split(' ')[0] || "Headlines";
        return normalizeNewsApiArticle(article, titleKeywords, 'us');
      })
      .filter(Boolean); // Lọc ra các kết quả null (ví dụ: bài báo có title là "[Removed]")

    console.log(`✅ Normalized ${allTrends.length} articles into trends.`);
    return allTrends;

  } catch (err) {
    console.error("❌ An error occurred while fetching from NewsAPI Top Headlines:", err.message);
    return []; // Trả về mảng rỗng để kích hoạt fallback
  }
}

// =========================================================================
// LUỒNG DỰ PHÒNG (FALLBACK): CÁC NGUỒN RSS CŨ
// =========================================================================

async function getTrendsFromRssFallback() {
    console.log("⚡️ Initiating RSS Fallback flow...");

    // COPY & PASTE toàn bộ các hàm fetcher và định nghĩa nguồn RSS của bạn vào đây
    // Ví dụ: createStandardTrend, fetchAndParseXmlFeed, fetchJsonFeed, fetchers_AI, fetchers_News,...

    // Helper function (cần thiết cho các hàm fetcher RSS)
    function createStandardTrend(item, sourceName, defaultCategory = "General", defaultRegion = "global", extraTags = []) {
      const title = getSafeString(item.title || item['media:title'] || item.name) || "No Title Available"; 
      const description = getSafeString(item.description || item.content?.['#text'] || item.summary?.['#text'] || item.content || item.artistName) || "No description available";
      let link = getSafeString(item.link);
      if (Array.isArray(item.link)) {
          const firstLink = item.link.find(l => l.rel === 'alternate' || !l.rel);
          if (firstLink && firstLink.href) link = getSafeString(firstLink.href);
          else if (item.link.length > 0) link = getSafeString(item.link[0]);
      } else if (typeof item.link === 'object' && item.link.href) link = getSafeString(item.link.href);
      link = link || "#";
      const pubDate = getSafeString(item.pubDate || item.published || item.updated || item.releaseDate) || new Date().toISOString();
      const cleanedTitle = title.replace(/<[^>]*>?/gm, '').replace(/\n{2,}/g, '\n').trim();
      const cleanedDescription = description.replace(/<[^>]*>?/gm, '').replace(/\n{2,}/g, '\n').trim();
      const baseVotes = Math.floor(Math.random() * 2000) + 1000;
      const baseMultiplier = (Math.random() * 1.5) + 0.5;
      const stableId = crypto.createHash('md5').update(`${link}-${cleanedTitle}`).digest('hex');
      return { id: stableId, title_en: cleanedTitle, description_en: cleanedDescription, title_vi: null, description_vi: null, category: defaultCategory, tags: [...new Set([...extraTags, sourceName.replace(/\s/g, "") || "Unknown", defaultRegion || "global"].filter(Boolean))], votes: baseVotes, views: Math.floor(baseVotes * (baseMultiplier * (Math.random() * 10 + 15))), interactions: Math.floor(baseVotes * (baseMultiplier * (Math.random() * 3 + 4))), searches: Math.floor(baseVotes * (baseMultiplier * (Math.random() * 1 + 1.5))), source: link, date: toDateStr(pubDate), sortKey: toSortValue(pubDate), submitter: sourceName || "Unknown", region: defaultRegion || "global" };
    }
    
    async function fetchAndParseXmlFeed(url, sourceName, defaultCategory, defaultRegion, extraTags = []) {
        try {
            const res = await fetchWithTimeout(url); const text = await res.text();
            const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", trimValues: true, textNodeName: "#text", removeNSPrefix: true, isArray: (name) => ["item", "entry", "link", "category"].includes(name) });
            const parsed = parser.parse(text);
            let rawItems = parsed?.rss?.channel?.item || parsed?.feed?.entry || parsed?.channel?.item || parsed?.feed?.item || parsed?.RDF?.item || [];
            if (rawItems.length === 0) return [];
            return rawItems.map(item => createStandardTrend(item, sourceName, defaultCategory, defaultRegion, extraTags));
        } catch (err) {
            console.error(`❌ RSS Fallback Error for ${sourceName} (${url}):`, err.message);
            return [];
        }
    }

    // Định nghĩa các nguồn RSS (chỉ lấy một vài nguồn làm ví dụ)
    const fetchers_News = [
      () => fetchAndParseXmlFeed("http://rss.cnn.com/rss/cnn_topstories.rss", "CNN News", "News", "us", ["USA","News"]),
      () => fetchAndParseXmlFeed("http://feeds.bbci.co.uk/news/rss.xml", "BBC News", "News", "uk", ["UK","News"]),
      () => fetchAndParseXmlFeed("https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi", "Google News VN", "News", "vn", ["GoogleNewsVN", "Vietnam"]),
    ];
    const fetchers_Technology = [
      () => fetchAndParseXmlFeed("https://techcrunch.com/feed/", "TechCrunch", "Technology", "us", ["Tech","Startups"]),
      () => fetchAndParseXmlFeed("https://www.wired.com/feed/rss", "Wired", "Technology", "us", ["Tech","Innovation"]),
    ];

    const allSources = [...fetchers_News, ...fetchers_Technology]; // Bạn có thể thêm các nguồn khác vào đây
    const results = await Promise.allSettled(allSources.map(f => f()));
    
    let fallbackTrends = [];
    for (const r of results) {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        fallbackTrends.push(...r.value);
      }
    }
    console.log(`✅ RSS Fallback completed, found ${fallbackTrends.length} trends.`);
    return fallbackTrends;
}

// =========================================================================
// BUILDER HANDLER CHÍNH
// =========================================================================

exports.handler = builder(async (event, context) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  try {
    let finalTrends = [];

    // Cố gắng chạy luồng chính
    try {
      finalTrends = await getTrendsFromNewsAPI();
    } catch (primaryError) {
      console.warn(`⚠️ Primary flow (NewsAPI) failed: ${primaryError.message}. Proceeding to fallback.`);
      finalTrends = [];
    }

    // Kiểm tra nếu cần fallback
    const MIN_TRENDS_THRESHOLD = 10;
    if (finalTrends.length < MIN_TRENDS_THRESHOLD) {
      console.log(`Not enough trends from primary source (${finalTrends.length}). Triggering RSS fallback.`);
      const fallbackTrends = await getTrendsFromRssFallback();
      
      // Gộp kết quả và loại bỏ trùng lặp
      const trendMap = new Map();
      [...finalTrends, ...fallbackTrends].forEach(t => {
        if (t && t.id) {
          trendMap.set(t.id, t)
        }
      });
      finalTrends = Array.from(trendMap.values());
    }

    if (finalTrends.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, trends: [], message: "No trends found from any source." }),
      };
    }

    // Xử lý hậu kỳ (tính hotnessScore) trên toàn bộ tập dữ liệu cuối cùng
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
