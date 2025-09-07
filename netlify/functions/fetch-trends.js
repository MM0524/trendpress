// netlify/functions/fetch-trends.js
const fetch = require("node-fetch");
// No need for XMLParser, crypto, or individual fetch functions here anymore.

// IMPORTANT: This helper must match the one in index.html for preprocessTrends
function calculateHotnessScore(trend, maxValues) {
    const weights = { views: 0.2, interactions: 0.4, searches: 0.3, votes: 0.1 };
    const normViews = (trend.views / maxValues.views) || 0;
    const normInteractions = (trend.interactions / maxValues.interactions) || 0;
    const normSearches = (trend.searches / maxValues.searches) || 0;
    const normVotes = (trend.votes / maxValues.votes) || 0;
    return (normViews * weights.views) + (normInteractions * weights.interactions) + (normSearches * weights.searches) + (normVotes * weights.votes);
}

function preprocessTrends(trends) {
    if (!trends || trends.length === 0) return [];
    
    // Tính toán maxValues dựa trên TẤT CẢ các trends được truyền vào hàm này
    // (trong trường hợp này là master list từ builder)
    const maxValues = {
        views: Math.max(1, ...trends.map(trendItem => trendItem.views || 0)),
        interactions: Math.max(1, ...trends.map(trendItem => trendItem.interactions || 0)),
        searches: Math.max(1, ...trends.map(trendItem => trendItem.searches || 0)),
        votes: Math.max(1, ...trends.map(trendItem => trendItem.votes || 0)),
    };
    
    trends.forEach((trendItem, i) => {
        // Đảm bảo id có sẵn từ backend
        // trendItem.id = trendItem.id || `temp-id-${i}`; // Không cần tạo ID tạm nữa nếu backend gửi về ổn định
        
        trendItem.hotnessScore = calculateHotnessScore(trendItem, maxValues);
        trendItem.type = trendItem.type || (i % 3 === 0 ? 'topic' : 'query');
    });
    return trends;
}


exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  try {
    const { region, category, timeframe, searchTerm, hashtag, source } = event.queryStringParameters || {}; // CẬP NHẬT: Thêm 'source' filter

    // Gọi Builder Function để lấy danh sách master trends đã được cache (hoặc mới build)
    // Builder function được expose tại /.netlify/builders/trends-builder
    const builderUrl = `${process.env.URL || "http://localhost:8888"}/.netlify/builders/trends-builder`;
    console.log("Calling trends-builder function:", builderUrl);
    
    const builderRes = await fetch(builderUrl);
    
    if (!builderRes.ok) {
        const errorText = await builderRes.text();
        console.error("Error fetching from trends-builder:", builderRes.status, errorText);
        throw new Error(`Failed to fetch master trends list (builder status: ${builderRes.status})`);
    }

    const data = await builderRes.json();
    if (!data.success || !Array.isArray(data.trends)) {
        throw new Error(data.message || "Failed to get valid trends data from builder.");
    }

    // Builder function đã thực hiện preprocess, nhưng chúng ta sẽ preprocess lại
    // trên master list để đảm bảo 'hotnessScore' được tính toán dựa trên tập dữ liệu đầy đủ
    // nếu logic tính toán hotnessScore của client/backend cần giá trị tương đối.
    // Nếu Builder đã gửi về hotnessScore cuối cùng, bước này có thể bỏ qua để tối ưu.
    let allFetchedTrends = preprocessTrends(data.trends);

    // Áp dụng các bộ lọc động từ client
    let filteredTrends = allFetchedTrends;

    if (region && region !== "global") {
      filteredTrends = filteredTrends.filter(t => t.region && t.region.toLowerCase() === region.toLowerCase());
    }
    if (category && category !== "All") { 
      filteredTrends = filteredTrends.filter(t => t.category && t.category.toLowerCase() === category.toLowerCase());
    }
    if (source && source !== "All") { // NEW: Apply source filter
      filteredTrends = filteredTrends.filter(t => t.submitter && t.submitter === source);
    }
    if (timeframe && timeframe !== "all") { // Logic timeframe này giống như ở client-side
      const now = new Date();
      let cutoffDate = new Date(now);
      switch (timeframe) {
        case "1h": cutoffDate.setHours(now.getHours() - 1); break;
        case "6h": cutoffDate.setHours(now.getHours() - 6); break;
        case "24h": cutoffDate.setHours(now.getHours() - 24); break;
        case "3d": cutoffDate.setDate(now.getDate() - 3); break;
        case "7d": cutoffDate.setDate(now.getDate() - 7); break;
        case "1m": cutoffDate.setDate(now.getDate() - 30); break;
        case "3m": cutoffDate.setDate(now.getDate() - 90); break;
        case "12m": cutoffDate.setFullYear(now.getFullYear() - 1); break;
      }
      cutoffDate.setHours(0, 0, 0, 0); // Normalize to start of day
      filteredTrends = filteredTrends.filter(t => {
        const trendDate = new Date(t.date);
        trendDate.setHours(0, 0, 0, 0); // Normalize to start of day
        return trendDate >= cutoffDate;
      });
    }
    if (searchTerm) {
      const termLower = searchTerm.toLowerCase();
      filteredTrends = filteredTrends.filter(t =>
        (t.title_en && t.title_en.toLowerCase().includes(termLower)) ||
        (t.description_en && t.description_en.toLowerCase().includes(termLower)) ||
        (t.title_vi && t.title_vi.toLowerCase().includes(termLower)) ||
        (t.description_vi && t.description_vi.toLowerCase().includes(termLower)) ||
        (t.tags && t.tags.some(tag => tag.toLowerCase().includes(termLower)))
      );
    }
    if (hashtag) {
      const hashtagLower = hashtag.toLowerCase();
      filteredTrends = filteredTrends.filter(t =>
        t.tags && t.tags.some(tag => tag.toLowerCase() === hashtagLower)
      );
    }

    filteredTrends = filteredTrends
      .filter(Boolean)
      .sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, trends: filteredTrends }),
    };
  } catch (err) {
    console.error("fetch-trends handler error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: "Failed to fetch trends", message: err.message }),
    };
  }
};
