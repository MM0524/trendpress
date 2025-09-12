// netlify/functions/fetch-trends.js
const NewsAPI = require('newsapi');
const crypto = require('crypto');
const googleTrends = require('google-trends-api');

const newsapi = new NewsAPI(process.env.NEWS_API_KEY);

// --- CÁC HÀM HELPER (Giữ nguyên) ---
function toDateStr(d) {
    const dt = d ? new Date(d) : new Date();
    return isNaN(dt.getTime()) ? new Date().toISOString().split("T")[0] : dt.toISOString().split("T")[0];
}
function toSortValue(d) {
    const dt = d ? new Date(d) : null;
    return dt && !isNaN(dt.getTime()) ? dt.getTime() : 0;
}
function normalizeNewsApiArticle(article) {
    const { title, description, url, publishedAt, source } = article;
    if (!title || title === "[Removed]" || !url) return null;
    const stableId = crypto.createHash('md5').update(url).digest('hex');
    const baseVotes = Math.floor(Math.random() * 500) + 200;
    return {
        id: stableId, title_en: title, description_en: description || "No description available.",
        title_vi: null, description_vi: null, category: "Search",
        tags: [source.name.replace(/\s/g, '')], votes: baseVotes,
        views: Math.floor(baseVotes * (Math.random() * 10 + 15)),
        interactions: Math.floor(baseVotes * (Math.random() * 3 + 4)),
        searches: Math.floor(baseVotes * (Math.random() * 1 + 1.5)),
        source: url, date: toDateStr(publishedAt), sortKey: toSortValue(publishedAt),
        submitter: source.name || "Unknown Source", region: 'global',
    };
}
function preprocessAndCalculateHotness(trends) {
    if (!trends || trends.length === 0) return [];
    const maxValues = {
        views: Math.max(1, ...trends.map(t => t.views || 0)),
        interactions: Math.max(1, ...trends.map(t => t.interactions || 0)),
        searches: Math.max(1, ...trends.map(t => t.searches || 0)),
        votes: Math.max(1, ...trends.map(t => t.votes || 0)),
    };
    const weights = { views: 0.2, interactions: 0.4, searches: 0.3, votes: 0.1 };
    trends.forEach(trend => {
        const normViews = (trend.views / maxValues.views) || 0;
        const normInteractions = (trend.interactions / maxValues.interactions) || 0;
        const normSearches = (trend.searches / maxValues.searches) || 0;
        const normVotes = (trend.votes / maxValues.votes) || 0;
        trend.hotnessScore = (normViews * weights.views) + (normInteractions * weights.interactions) + (normSearches * weights.searches) + (normVotes * weights.votes);
    });
    return trends;
}
function createVirtualTrendFromGoogle(searchTerm, trendsData) {
    const interestValues = trendsData.map(point => point.value[0]);
    const averageInterest = interestValues.reduce((a, b) => a + b, 0) / (interestValues.length || 1);
    if (averageInterest < 5) {
        console.log(`-> Interest for "${searchTerm}" is too low (${averageInterest.toFixed(2)}). Skipping.`);
        return null;
    }
    const baseMetric = averageInterest * 500;
    return {
        id: crypto.createHash('md5').update(`virtual-${searchTerm}`).digest('hex'),
        title_en: searchTerm,
        description_en: `This is a virtual trend generated based on Google Trends data for the keyword "${searchTerm}". The chart reflects its interest over time.`,
        title_vi: searchTerm,
        description_vi: `Đây là một xu hướng ảo được tạo ra dựa trên dữ liệu Google Trends cho từ khóa "${searchTerm}". Biểu đồ phản ánh mức độ quan tâm theo thời gian.`,
        category: "Google Trends", tags: ['virtual', 'googletrends'],
        votes: Math.round(baseMetric * 0.5), views: Math.round(baseMetric * 10),
        interactions: Math.round(baseMetric * 3), searches: Math.round(baseMetric * 15),
        source: `https://trends.google.com/trends/explore?q=${encodeURIComponent(searchTerm)}`,
        date: new Date().toISOString(), sortKey: new Date().getTime(),
        submitter: "Google Trends", region: 'global', isVirtual: true,
        interestData: trendsData
    };
}

// --- HANDLER CHÍNH ĐÃ ĐƯỢC NÂNG CẤP HOÀN TOÀN ---
exports.handler = async (event) => {
    const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
    
    if (event.httpMethod !== "GET") {
        return { statusCode: 405, headers, body: JSON.stringify({ success: false, message: "Method Not Allowed" }) };
    }

    try {
        const { searchTerm, timeframe: rawTimeframe = '7d' } = event.queryStringParameters;

        if (!searchTerm || searchTerm.trim() === '') {
            return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "searchTerm is required." }) };
        }
        if (!process.env.NEWS_API_KEY) {
            throw new Error("NEWS_API_KEY is not configured.");
        }

        // ================== LOGIC XỬ LÝ TIMEFRAME MỚI, AN TOÀN HƠN ==================
        const TIMEFRAME_MAP_TO_DAYS = {
            '1h': 1, '6h': 1, '24h': 1, // Coi các khung giờ là trong 1 ngày
            '3d': 3,
            '7d': 7,
            '1m': 30,
            '3m': 92,  // GIỚI HẠN: Coi 3 tháng là 30 ngày để đảm bảo API ổn định
            '12m': 365, // GIỚI HẠN: Coi 1 năm là 30 ngày để đảm bảo API ổn định
        };

        // Lấy số ngày từ map, nếu không có thì mặc định là 7
        const daysAgo = TIMEFRAME_MAP_TO_DAYS[rawTimeframe] || 7;
        
        const startTime = new Date();
        startTime.setDate(startTime.getDate() - daysAgo);
        // =======================================================================

        // === BƯỚC 1: TÌM KIẾM TRÊN NEWSAPI VỚI KHUNG THỜI GIAN ĐÃ CHUẨN HÓA ===
        console.log(`🚀 [Primary] Searching NewsAPI for: "${searchTerm}" from ${startTime.toISOString()}`);
        const response = await newsapi.v2.everything({
            q: searchTerm,
            from: startTime.toISOString().split('T')[0], // Định dạng YYYY-MM-DD
            sortBy: 'relevancy',
            pageSize: 20,
            language: 'en'
        });
        
        let searchResults = response.articles.map(normalizeNewsApiArticle).filter(Boolean);
        if (searchResults.length > 0) {
            searchResults = preprocessAndCalculateHotness(searchResults);
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, trends: searchResults }) };
        }
        
        // === BƯỚC 2: TÌM KIẾM TRÊN GOOGLE TRENDS VỚI KHUNG THỜI GIAN ĐÃ CHUẨN HÓA ===
        console.log(`⚠️ [Primary] No articles. Switching to [Fallback] Google Trends API.`);
        try {
            const trendsResponse = await googleTrends.interestOverTime({
                keyword: searchTerm,
                startTime: startTime, // Sử dụng ngày bắt đầu đã tính toán an toàn
            });
            
            const parsedResponse = JSON.parse(trendsResponse);
            const timelineData = parsedResponse.default.timelineData;
            if (!timelineData || timelineData.length === 0) {
                return { statusCode: 200, headers, body: JSON.stringify({ success: true, trends: [] }) };
            }
            const virtualTrend = createVirtualTrendFromGoogle(searchTerm, timelineData);
            if (virtualTrend) {
                let virtualResults = preprocessAndCalculateHotness([virtualTrend]);
                return { statusCode: 200, headers, body: JSON.stringify({ success: true, trends: virtualResults }) };
            } else {
                return { statusCode: 200, headers, body: JSON.stringify({ success: true, trends: [] }) };
            }
        } catch (googleError) {
            console.error(`❌ [Fallback] Google Trends API failed for "${searchTerm}":`, googleError.message);
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, trends: [] }) };
        }

    } catch (err) {
        console.error("fetch-trends handler critical error:", err);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: err.message }) };
    }
};
