// netlify/functions/fetch-trends.js
const NewsAPI = require('newsapi');
const crypto = require('crypto');
const googleTrends = require('google-trends-api');

const newsapi = new NewsAPI(process.env.NEWS_API_KEY);

// Hàm helper để tính toán Hotness Score
function calculateHotness(articles) {
    if (!articles || articles.length === 0) return [];
    articles.forEach(article => {
        // Mô phỏng điểm hotness đơn giản cho các bài báo
        article.hotnessScore = Math.random(); 
    });
    return articles;
}

// *** HÀM MỚI QUAN TRỌNG: Tổng hợp các bài báo thành chuỗi thời gian ***
function aggregateArticlesToTimeline(articles, daysAgo) {
    if (!articles || articles.length === 0) return [];
    
    // Tạo một map để đếm số lượng bài báo mỗi ngày
    const dailyCounts = new Map();
    articles.forEach(article => {
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


exports.handler = async (event) => {
    const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
    
    try {
        const { searchTerm, timeframe: rawTimeframe = '7d' } = event.queryStringParameters;

        if (!searchTerm || !searchTerm.trim()) {
            return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "searchTerm is required." }) };
        }

        const TIMEFRAME_MAP_TO_DAYS = {
            '1h': 1, '6h': 1, '24h': 1, '3d': 3, '7d': 7,
            '1m': 30, '3m': 30, '12m': 30,
        };
        const daysAgo = TIMEFRAME_MAP_TO_DAYS[rawTimeframe] || 7;
        const startTime = new Date();
        startTime.setDate(startTime.getDate() - daysAgo);

        // === LUỒNG ƯU TIÊN: NEWSAPI ===
        let timelineData = null;
        let sourceApi = "NewsAPI";

        const response = await newsapi.v2.everything({
            q: searchTerm,
            from: startTime.toISOString().split('T')[0],
            sortBy: 'relevancy', pageSize: 100, language: 'en'
        });

        if (response.status === 'ok' && response.articles.length > 0) {
            // TỔNG HỢP KẾT QUẢ THÀNH TIMELINE
            timelineData = aggregateArticlesToTimeline(response.articles, daysAgo);
        }

        // === LUỒNG DỰ PHÒNG: GOOGLE TRENDS (NẾU NEWSAPI KHÔNG CÓ KẾT QUẢ) ===
        if (!timelineData) {
            console.log(`⚠️ No articles from NewsAPI. Switching to Google Trends API.`);
            sourceApi = "Google Trends";
            try {
                const trendsResponse = await googleTrends.interestOverTime({
                    keyword: searchTerm,
                    startTime: startTime,
                });
                const parsedResponse = JSON.parse(trendsResponse);
                
                if (parsedResponse.default.timelineData.length > 0) {
                    // Chuẩn hóa giá trị của Google Trends (0-100) lên thang đo lớn hơn
                    timelineData = parsedResponse.default.timelineData.map(point => ({
                        ...point,
                        value: [point.value[0] * 1000] // Nhân với 1000
                    }));
                }

            } catch (googleError) {
                console.error(`❌ Google Trends API failed:`, googleError.message);
                timelineData = null; // Đảm bảo trả về rỗng nếu lỗi
            }
        }

        if (!timelineData) {
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, trends: [] }) };
        }

        // === TẠO TREND ẢO DUY NHẤT ĐỂ TRẢ VỀ ===
        const aggregatedTrend = {
            id: `aggregated-${searchTerm}-${rawTimeframe}`,
            title_en: searchTerm,
            isAggregated: true,
            submitter: sourceApi, // Cho biết dữ liệu từ đâu
            timelineData: timelineData, // **Đây là dữ liệu quan trọng nhất**
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
