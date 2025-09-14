// netlify/functions/fetch-trends.js
const crypto = require('crypto');
const googleTrends = require('google-trends-api');
// Sử dụng node-fetch để gọi API từ một Netlify Function khác
const fetch = require('node-fetch');

// --- HÀM MỚI: CÔNG CỤ TÌM KIẾM NỘI BỘ ---
// Hàm này quét qua danh sách tin tức tổng hợp và tìm các bài báo liên quan nhất.
function findRelatedArticles(searchTerm, masterList) {
    if (!searchTerm || !masterList || masterList.length === 0) {
        return [];
    }

    const searchLower = searchTerm.toLowerCase();
    
    // Chấm điểm liên quan cho mỗi bài báo
    const scoredArticles = masterList.map(article => {
        let relevanceScore = 0;
        const title = (article.title_en || article.title_vi || '').toLowerCase();
        const description = (article.description_en || article.description_vi || '').toLowerCase();
        const tags = (article.tags || []).join(' ').toLowerCase();

        // Tiêu chí chấm điểm:
        if (title.includes(searchLower)) {
            relevanceScore += 10; // Điểm cao nhất cho tiêu đề
        }
        if (description.includes(searchLower)) {
            relevanceScore += 5; // Điểm cao cho mô tả
        }
        if (tags.includes(searchLower)) {
            relevanceScore += 2; // Điểm thưởng cho tag
        }
        
        // Thêm một chút ngẫu nhiên để kết quả không quá tĩnh
        if (relevanceScore > 0) {
            relevanceScore += Math.random(); 
        }
        
        return { ...article, relevanceScore };
    });
    
    // Lọc ra các bài báo có điểm > 0, sắp xếp theo điểm từ cao đến thấp và lấy 5 bài đầu tiên
    return scoredArticles
        .filter(article => article.relevanceScore > 0)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, 5);
}

// --- HANDLER CHÍNH ---
exports.handler = async (event) => {
    const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
    
    try {
        const { searchTerm, timeframe: rawTimeframe = '7d' } = event.queryStringParameters;
        if (!searchTerm || !searchTerm.trim()) {
            return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "searchTerm is required." }) };
        }
        
        // --- BƯỚC 1: TẢI VỀ DANH SÁCH TIN TỨC TỔNG HỢP TỪ BUILDER FUNCTION ---
        // URL này trỏ đến chính builder function của bạn. 
        // `process.env.URL` là biến môi trường do Netlify cung cấp, chứa URL của trang web.
        const builderUrl = `${process.env.URL}/.netlify/builders/trends-builder`;
        let masterList = [];
        try {
            const response = await fetch(builderUrl);
            if(response.ok) {
                const data = await response.json();
                if (data.success && Array.isArray(data.trends)) {
                    masterList = data.trends;
                    console.log(`Successfully fetched ${masterList.length} articles from master list.`);
                }
            } else {
                 console.error(`Failed to fetch master list, status: ${response.status}`);
            }
        } catch (e) {
            console.error("Critical error fetching master trends list:", e.message);
            // Nếu không tải được danh sách chính, chúng ta vẫn có thể tiếp tục với Google Trends
        }

        // --- BƯỚC 2: GỌI CÁC API GOOGLE TRENDS SONG SONG ---
        const TIMEFRAME_MAP = {
            '1h': { hours: 1 }, '6h': { hours: 6 }, '24h': { hours: 24 },
            '3d': { days: 3 }, '7d': { days: 7 }, '1m': { days: 30 },
            '3m': { days: 30 }, '12m': { days: 30 },
        };
        const timeConfig = TIMEFRAME_MAP[rawTimeframe] || { days: 7 };
        const startTime = new Date();
        if (timeConfig.hours) {
            startTime.setHours(startTime.getHours() - timeConfig.hours);
        } else {
            startTime.setDate(startTime.getDate() - timeConfig.days);
        }

        const interestPromise = googleTrends.interestOverTime({ keyword: searchTerm, startTime: startTime });
        const relatedQueriesPromise = googleTrends.relatedQueries({ keyword: searchTerm, startTime: startTime });

        const [interestResult, relatedQueriesResult] = await Promise.allSettled([interestPromise, relatedQueriesPromise]);
        
        // --- BƯỚC 3: XỬ LÝ VÀ GỘP KẾT QUẢ ---
        let timelineData = null;
        let topArticles = [];
        let relatedQueries = [];
        
        // 3.1: Sử dụng công cụ tìm kiếm nội bộ để lấy topArticles
        topArticles = findRelatedArticles(searchTerm, masterList);
        console.log(`Found ${topArticles.length} related articles internally.`);

        // 3.2: Xử lý timeline từ Google Trends
        if (interestResult.status === 'fulfilled') {
            try {
                const parsed = JSON.parse(interestResult.value);
                if (parsed.default.timelineData && parsed.default.timelineData.length > 0) {
                    timelineData = parsed.default.timelineData.map(p => ({ ...p, value: [p.value[0] * 1000] }));
                }
            } catch (e) { console.error("Parsing interestOverTime failed:", e.message); }
        }
        
        // 3.3: Xử lý related queries từ Google Trends
        if (relatedQueriesResult.status === 'fulfilled') {
            try {
                const parsed = JSON.parse(relatedQueriesResult.value);
                const risingQueries = parsed.default.rankedKeyword.find(k => k.rankedKeyword.every(q => q.value > 0));
                if (risingQueries) relatedQueries = risingQueries.rankedKeyword.slice(0, 5);
            } catch (e) { console.error("Parsing related queries failed:", e.message); }
        }

        // Nếu không có BẤT KỲ dữ liệu nào (timeline, articles, queries), trả về mảng rỗng
        if (!timelineData && topArticles.length === 0 && relatedQueries.length === 0) {
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, trends: [] }) };
        }

        // Tạo đối tượng trend tổng hợp cuối cùng
        const aggregatedTrend = {
            id: `aggregated-${searchTerm.replace(/\s/g, '-')}-${rawTimeframe}`,
            title_en: searchTerm,
            isAggregated: true,
            submitter: "Multiple Sources", // Nguồn giờ là tổng hợp
            timelineData: timelineData || [], // Đảm bảo luôn là mảng
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
