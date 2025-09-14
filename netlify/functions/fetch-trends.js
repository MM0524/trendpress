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
    const baseVotes = Math.floor(Math.random() * 500) + 200;
    
    return {
        id: stableId,
        title_en: title,
        description_en: description || "No description available.",
        title_vi: null,
        description_vi: null,
        category: "Search",
        tags: [source.name.replace(/\s/g, '')],
        votes: baseVotes,
        views: Math.floor(baseVotes * (Math.random() * 10 + 15)),
        interactions: Math.floor(baseVotes * (Math.random() * 3 + 4)),
        searches: Math.floor(baseVotes * (Math.random() * 1 + 1.5)),
        source: url,
        date: toDateStr(publishedAt),
        sortKey: toSortValue(publishedAt),
        submitter: source.name || "Unknown Source",
        region: 'global',
        publishedAt: publishedAt // Giữ lại để sắp xếp
    };
}

// Hàm tổng hợp các bài báo thành một chuỗi dữ liệu thời gian (hỗ trợ cả ngày và giờ)
function aggregateArticlesToTimeline(articles, daysAgo, hoursAgo = 0) {
    if (!articles || articles.length === 0) return [];
    
    const counts = new Map();
    const isHourly = hoursAgo > 0;

    // Bước 1: Đếm số lượng bài báo theo ngày hoặc giờ
    articles.forEach(article => {
        const date = new Date(article.publishedAt);
        let key;
        if (isHourly) {
            // Tạo key dạng "YYYY-MM-DDTHH:00:00.000Z" (làm tròn xuống giờ)
            key = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).toISOString();
        } else {
            // Tạo key dạng "YYYY-MM-DD"
            key = date.toISOString().split('T')[0];
        }
        counts.set(key, (counts.get(key) || 0) + 1);
    });

    // Bước 2: Tạo chuỗi thời gian hoàn chỉnh
    const timelineData = [];
    const now = new Date();

    if (isHourly) {
        // Tạo timeline theo giờ
        for (let i = hoursAgo; i >= 0; i--) {
            const date = new Date(now);
            date.setHours(date.getHours() - i);
            const key = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).toISOString();
            const value = (counts.get(key) || 0) * (Math.random() * 50 + 50);
            
            timelineData.push({
                time: Math.floor(date.getTime() / 1000), // Unix timestamp (giây)
                value: [Math.round(value)] // Giữ cấu trúc giống Google Trends
            });
        }
    } else {
        // Tạo timeline theo ngày
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
        if (!searchTerm || !se
