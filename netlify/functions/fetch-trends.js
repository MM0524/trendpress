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

// Cập nhật hàm này để nó trả về một đối tượng trend hoàn chỉnh
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

// Hàm tổng hợp các bài báo thành một chuỗi dữ liệu thời gian
function aggregateArticlesToTimeline(articles, daysAgo) {
    if (!articles || articles.length === 0) return [];
    
    // Tạo một map để đếm số lượng bài báo mỗi ngày
    const dailyCounts = new Map();
    articles.forEach(article => {
        // Lấy ngày tháng dạng YYYY-MM-DD
        const dateStr = new Date(article.publishedAt).toISOString().split('T')[0];
        dailyCounts.set(dateStr, (dailyCounts.get(dateStr) || 0) + 1);
    });

    // Tạo chuỗi thời gian hoàn chỉnh cho `daysAgo` ngày qua
    const timelineData = [];
    for (let i = daysAgo; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        
        // Giá trị là số bài báo * một hệ số ngẫu nhiên để trông giống "độ hot"
        const value = (dailyCounts.get(dateStr) || 0) * (Math.random() * 50 + 50);
        
        timelineData.push({
            time: Math.floor(date.getTime() / 1000), // Unix timestamp (giây)
            value: [Math.round(value)] // Giữ cấu trúc giống Google Trends
        });
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
        
        const TIMEFRAME_MAP_TO_DAYS = { '1h': 1, '6h': 1, '24h': 1, '3d': 3, '7d': 7, '1m': 30, '3m': 30, '12m': 30 };
        const daysAgo = TIMEFRAME_MAP_TO_DAYS[rawTimeframe] || 7;
        const startTime = new Date();
        startTime.setDate(startTime.getDate() - daysAgo);

        // --- THỰC HIỆN CÁC CUỘC GỌI API SONG SONG ---
        const newsPromise = newsapi.v2.everything({
            q: searchTerm,
            from: startTime.toISOString().split('T')[0],
            sortBy: 'relevancy',
            pageSize: 100, // Lấy tối đa 100 bài để tổng hợp
            language: 'en'
        });

        const relatedQueriesPromise = googleTrends.relatedQueries({
            keyword: searchTerm,
            startTime: startTime,
        });

        // Chạy song song để tiết kiệm thời gian
        const [newsResponse, relatedQueriesResponse] = await Promise.allSettled([newsPromise, relatedQueriesPromise]);
        
        // --- XỬ LÝ KẾT QUẢ ---
        let timelineData = null;
        let topArticles = [];
        let relatedQueries = [];
        let sourceApi = "NewsAPI";

        // Xử lý kết quả từ NewsAPI
        if (newsResponse.status === 'fulfilled' && newsResponse.value.status === 'ok' && newsResponse.value.articles.length > 0) {
            const allArticles = newsResponse.value.articles.map(normalizeNewsApiArticle).filter(Boolean);
            timelineData = aggregateArticlesToTimeline(allArticles, daysAgo);
            // Sắp xếp bài báo theo ngày mới nhất và lấy 5 bài đầu
            topArticles = allArticles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, 5);
        } else {
            // LUỒNG DỰ PHÒNG: GOOGLE TRENDS (NẾU NEWSAPI KHÔNG CÓ KẾT QUẢ)
            sourceApi = "Google Trends";
            try {
                const trendsResponse = await googleTrends.interestOverTime({ keyword: searchTerm, startTime: startTime });
                const parsed = JSON.parse(trendsResponse);
                if (parsed.default.timelineData.length > 0) {
                    // Chuẩn hóa giá trị của Google (0-100) lên thang đo lớn hơn
                    timelineData = parsed.default.timelineData.map(p => ({ ...p, value: [p.value[0] * 1000] }));
                }
            } catch (e) {
                console.error("Interest Over Time failed:", e.message);
            }
        }

        // Xử lý kết quả từ Related Queries
        if (relatedQueriesResponse.status === 'fulfilled') {
            try {
                const parsed = JSON.parse(relatedQueriesResponse.value);
                // Lấy các cụm từ đang tăng trưởng (rising) hoặc top
                const rankedKeywords = parsed.default.rankedKeyword;
                const risingQueries = rankedKeywords.find(k => k.rankedKeyword.every(q => q.value > 0)); // Thường là 'rising'
                if (risingQueries) {
                    relatedQueries = risingQueries.rankedKeyword.slice(0, 5);
                }
            } catch(e) {
                console.error("Parsing related queries failed:", e.message);
            }
        }

        // Nếu không có dữ liệu timeline từ cả hai nguồn, trả về mảng rỗng
        if (!timelineData) {
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, trends: [] }) };
        }

        // Tạo đối tượng trend tổng hợp cuối cùng
        const aggregatedTrend = {
            id: `aggregated-${searchTerm.replace(/\s/g, '-')}-${rawTimeframe}`,
            title_en: searchTerm,
            isAggregated: true,
            submitter: sourceApi,
            timelineData: timelineData,
            topArticles: topArticles,
            relatedQueries: relatedQueries,
        };
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                // Luôn trả về một mảng chứa một trend duy nhất
                trends: [aggregatedTrend]
            }),
        };

    } catch (err) {
        console.error("fetch-trends handler critical error:", err);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: err.message }) };
    }
};
