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
            // Làm tròn xuống giờ để tạo key
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
        if (!searchTerm || !searchTerm.trim()) {
            return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "searchTerm is required." }) };
        }
        // Map cho cả ngày và giờ để xử lý timeframe
        const TIMEFRAME_MAP = {
            '1h': { hours: 1 }, '6h': { hours: 6 }, '24h': { hours: 24 },
            '3d': { days: 3 }, '7d': { days: 7 }, '1m': { days: 30 },
            '3m': { days: 92 }, '12m': { days: 365 }, // Giới hạn timeframe dài về 30 ngày
        };

        const timeConfig = TIMEFRAME_MAP[rawTimeframe] || { days: 7 };
        const startTime = new Date();
        let hoursAgo = 0;
        let daysAgo = 0;

        if (timeConfig.hours) {
            startTime.setHours(startTime.getHours() - timeConfig.hours);
            hoursAgo = timeConfig.hours;
        } else {
            startTime.setDate(startTime.getDate() - timeConfig.days);
            daysAgo = timeConfig.days;
        }
        // --- CUỘC GỌI API SONG SONG ---
        const newsPromise = newsapi.v2.everything({
            q: searchTerm,
            from: startTime.toISOString(), // Gửi thời gian chi tiết (bao gồm cả giờ)
            sortBy: 'relevancy',
            pageSize: 100,
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
            // Truyền cả daysAgo và hoursAgo vào hàm tổng hợp
            timelineData = aggregateArticlesToTimeline(allArticles, daysAgo, hoursAgo);
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
