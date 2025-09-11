// netlify/functions/fetch-trends.js
const NewsAPI = require('newsapi');
const crypto = require('crypto');

// Khởi tạo NewsAPI client với API key từ biến môi trường
const newsapi = new NewsAPI(process.env.NEWS_API_KEY);

// Các hàm helper để chuẩn hóa dữ liệu trả về từ NewsAPI
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
    const baseVotes = Math.floor(Math.random() * 500) + 200; // Mock data
    
    return {
        id: stableId,
        title_en: title,
        description_en: description || "No description available.",
        title_vi: null, // Dữ liệu từ API tìm kiếm động mặc định là tiếng Anh
        description_vi: null,
        category: "Search", // Gán một category đặc biệt để nhận biết đây là kết quả tìm kiếm
        tags: [source.name.replace(/\s/g, '')],
        votes: baseVotes,
        views: Math.floor(baseVotes * (Math.random() * 10 + 15)),
        interactions: Math.floor(baseVotes * (Math.random() * 3 + 4)),
        searches: Math.floor(baseVotes * (Math.random() * 1 + 1.5)),
        source: url,
        date: toDateStr(publishedAt),
        sortKey: toSortValue(publishedAt),
        submitter: source.name || "Unknown Source",
        region: 'global', // Kết quả tìm kiếm thường là toàn cầu
    };
}

// Hàm tính toán Hotness Score cho một tập hợp các trends
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

exports.handler = async (event) => {
    const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
    
    if (event.httpMethod !== "GET") {
        return { statusCode: 405, headers, body: JSON.stringify({ success: false, message: "Method Not Allowed" }) };
    }

    try {
        const { searchTerm } = event.queryStringParameters;

        // Nếu không có searchTerm, function này sẽ báo lỗi
        if (!searchTerm || searchTerm.trim() === '') {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ success: false, message: "searchTerm parameter is required." }),
            };
        }

        if (!process.env.NEWS_API_KEY) {
            throw new Error("NEWS_API_KEY is not configured on the server.");
        }

        console.log(`🚀 Performing live search on NewsAPI for: "${searchTerm}"`);

        // Gọi trực tiếp NewsAPI để tìm kiếm bằng endpoint 'everything'
        const response = await newsapi.v2.everything({
            q: searchTerm,
            sortBy: 'relevancy', // Sắp xếp theo độ liên quan
            pageSize: 20,       // Lấy 20 kết quả hàng đầu
            language: 'en'      // Tìm kiếm trên các nguồn tiếng Anh
        });

        if (response.status !== 'ok') {
            throw new Error(response.message || "Failed to fetch from NewsAPI");
        }

        // Chuẩn hóa kết quả trả về
        let searchResults = response.articles
            .map(article => normalizeNewsApiArticle(article))
            .filter(Boolean);

        // Tính toán Hotness Score cho tập kết quả vừa tìm được
        searchResults = preprocessAndCalculateHotness(searchResults);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, trends: searchResults }),
        };

    } catch (err) {
        console.error("fetch-trends handler error:", err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ success: false, error: "Failed to perform search", message: err.message }),
        };
    }
};
