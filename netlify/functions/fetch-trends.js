// netlify/functions/fetch-trends.js
const NewsAPI = require('newsapi');
const crypto = require('crypto');
const googleTrends = require('google-trends-api');

// Khởi tạo NewsAPI client với API key từ biến môi trường
const newsapi = new NewsAPI(process.env.NEWS_API_KEY);

// --- CÁC HÀM HELPER ---

function toDateStr(d) {
    const dt = d ? new Date(d) : new Date();
    return isNaN(dt.getTime()) ? new Date().toISOString().split("T")[0] : dt.toISOString().split("T")[0];
}

function toSortValue(d) {
    const dt = d ? new Date(d) : null;
    return dt && !isNaN(dt.getTime()) ? dt.getTime() : 0;
}

// Hàm chuẩn hóa dữ liệu trả về từ NewsAPI
function normalizeNewsApiArticle(article) {
    const { title, description, url, publishedAt, source } = article;
    if (!title || title === "[Removed]" || !url) return null;

    const stableId = crypto.createHash('md5').update(url).digest('hex');
    
    return {
        id: stableId,
        title_en: title || '', // Đảm bảo title_en không bao giờ là null
        description_en: description || "No description available.",
        title_vi: null,
        description_vi: null,
        category: "Search",
        tags: [source.name.replace(/\s/g, '')],
        source: url,
        date: toDateStr(publishedAt),
        submitter: source.name || "Unknown Source",
        publishedAt: publishedAt
    };
}

// Hàm tổng hợp các bài báo thành một chuỗi dữ liệu thời gian
function aggregateArticlesToTimeline(articles, daysAgo, hoursAgo = 0) {
    if (!articles || articles.length === 0) return [];
    
    const counts = new Map();
    const isHourly = hoursAgo > 0;

    articles.forEach(article => {
        const date = new Date(article.publishedAt);
        let key;
        if (isHourly) {
            key = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).toISOString();
        } else {
            key = date.toISOString().split('T')[0];
        }
        counts.set(key, (counts.get(key) || 0) + 1);
    });

    const timelineData = [];
    const now = new Date();

    if (isHourly) {
        for (let i = hoursAgo; i >= 0; i--) {
            const date = new Date(now);
            date.setHours(date.getHours() - i);
            const key = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).toISOString();
            const value = (counts.get(key) || 0) * (Math.random() * 50 + 50);
            
            timelineData.push({
                time: Math.floor(date.getTime() / 1000),
                value: [Math.round(value)]
            });
        }
    } else {
        for (let i = daysAgo; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const key = date.toISOString().split('T')[0];
            const value = (counts.get(key) || 0) * (Math.random() * 50 + 50);
            
            timelineData.push({
                time: Math.floor(date.getTime() / 1000),
                value: [Math.round(value)]
            });
        }
    }
    return timelineData;
}

// --- HANDLER CHÍNH ---
exports.handler = async (event) => {
    const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
    
    try {
        const { searchTerm, timeframe: rawTimeframe = '7d' } = event.queryStringParameters;
        if (!searchTerm || !searchTerm.trim()) {
            return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "searchTerm is required." }) };
        }
        
        const TIMEFRAME_MAP = {
            '1h': { hours: 1 }, '6h': { hours: 6 }, '24h': { hours: 24 },
            '3d': { days: 3 }, '7d': { days: 7 }, '1m': { days: 30 },
            '3m': { days: 90 },
            '12m': { days: 365 },
        };

        const timeConfig = TIMEFRAME_MAP[rawTimeframe] || { days: 7 };
        const startTime = new Date();
        let hoursAgo = 0, daysAgo = 0;

        if (timeConfig.hours) {
            startTime.setHours(startTime.getHours() - timeConfig.hours);
            hoursAgo = timeConfig.hours;
        } else {
            startTime.setDate(startTime.getDate() - timeConfig.days);
            daysAgo = timeConfig.days;
        }

        // Tạo một ngày bắt đầu riêng cho NewsAPI, không bao giờ cũ hơn 28 ngày
        const newsApiStartTime = new Date();
        newsApiStartTime.setDate(newsApiStartTime.getDate() - 28);

        // --- GỌI API SONG SONG ---
        const interestPromise = googleTrends.interestOverTime({ keyword: searchTerm, startTime: startTime });
        const newsPromise = newsapi.v2.everything({ q: searchTerm, from: newsApiStartTime.toISOString(), sortBy: 'relevancy', pageSize: 100, language: 'en' });
        const relatedQueriesPromise = googleTrends.relatedQueries({ keyword: searchTerm, startTime: startTime });

        const [interestResult, newsResult, relatedQueriesResult] = await Promise.allSettled([interestPromise, newsPromise, relatedQueriesPromise]);

        let timelineData = null;
        let topArticles = [];
        let relatedQueries = [];
        let sourceApi = "Google Trends";

        // 1. Xử lý kết quả Top Articles (từ NewsAPI)
        if (newsResult.status === 'fulfilled' && newsResult.value.status === 'ok' && newsResult.value.articles.length > 0) {
            const allArticles = newsResult.value.articles.map(normalizeNewsApiArticle).filter(Boolean);
            topArticles = allArticles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, 5);
        }

        // 2. Xử lý kết quả Timeline (ưu tiên Google, fallback về NewsAPI)
        if (interestResult.status === 'fulfilled') {
            try {
                const parsed = JSON.parse(interestResult.value);
                if (parsed.default.timelineData && parsed.default.timelineData.length > 0) {
                    timelineData = parsed.default.timelineData.map(p => ({ ...p, value: [p.value[0] * 1000] }));
                }
            } catch (e) { console.error("Parsing interestOverTime failed:", e.message); }
        }
        
        if (!timelineData && newsResult.status === 'fulfilled' && newsResult.value.articles.length > 0) {
            sourceApi = "NewsAPI";
            const allArticles = newsResult.value.articles.map(normalizeNewsApiArticle).filter(Boolean);
            timelineData = aggregateArticlesToTimeline(allArticles, daysAgo, hoursAgo);
        }

        // 3. Xử lý kết quả Related Queries
        if (relatedQueriesResult.status === 'fulfilled') {
            try {
                const parsed = JSON.parse(relatedQueriesResult.value);
                const risingQueries = parsed.default.rankedKeyword.find(k => k.rankedKeyword.every(q => q.value > 0));
                if (risingQueries) relatedQueries = risingQueries.rankedKeyword.slice(0, 5);
            } catch (e) { console.error("Parsing related queries failed:", e.message); }
        }

        if (!timelineData && topArticles.length === 0 && relatedQueries.length === 0) {
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, trends: [] }) };
        }

        const aggregatedTrend = {
            id: `aggregated-${searchTerm.replace(/\s/g, '-')}-${rawTimeframe}`,
            title_en: searchTerm,
            isAggregated: true,
            submitter: sourceApi,
            timelineData: timelineData || [],
            topArticles: topArticles,
            relatedQueries: relatedQueries,
        };
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, trends: [aggregatedTrend] }),
        };

    } catch (err) {
        console.error("fetch-trends handler critical error:", err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ success: false, message: err.message }),
        };
    }
};
