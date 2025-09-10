// netlify/functions/analyze-trend.js

// --- Class GeminiAPIManager ---
class GeminiAPIManager {
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error("Gemini API key is required.");
        }
        this.apiKey = apiKey;
        this.baseURL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`;
        this.maxRetries = 3;
        this.retryDelay = 1000;
    }

    async generateContent(prompt) {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await fetch(this.baseURL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        "contents": [{ "parts": [{ "text": prompt }] }]
                    }),
                });

                if (!response.ok) {
                    const errorBody = await response.json();
                    throw new Error(`API call failed with status ${response.status}: ${errorBody.error?.message || JSON.stringify(errorBody)}`);
                }

                const data = await response.json();
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

                if (!text) {
                    throw new Error("No content generated in API response.");
                }
                return text;

            } catch (error) {
                console.error(`Gemini API call attempt ${attempt} failed: ${error.message}`);
                if (attempt === this.maxRetries) {
                    throw new Error(`Gemini API call failed after ${this.maxRetries} attempts.`);
                }
                await new Promise(res => setTimeout(res, this.retryDelay));
            }
        }
    }
}

// --- Cấu hình API ---
const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiManager = new GeminiAPIManager(geminiApiKey);


// --- Hàm tạo Prompt ---
function createDetailedAnalysisPrompt(trend, language) {
    const trendTitle = trend.title;
    const trendDescription = trend.description;
    if (language === 'vi') {
        return `Bạn là một chuyên gia phân tích xu hướng marketing. Phân tích xu hướng sau đây. Thông tin: Tên="${trendTitle}", Mô tả="${trendDescription}", Lĩnh vực="${trend.category}". Yêu cầu: 1. Tổng quan. 2. Tại sao nổi bật & lan truyền thế nào?. 3. Đối tượng phù hợp. 4. Đề xuất 2 nền tảng & chiến lược nội dung. QUAN TRỌNG: Chỉ trả lời bằng HTML hợp lệ, gói gọn trong các thẻ <div class="ai-section">...</div>.`;
    } else {
        return `You are a marketing trend analyst. Analyze the following trend. Info: Name="${trendTitle}", Description="${trendDescription}", Category="${trend.category}". Requirements: 1. Overview. 2. Why it's trending & how it's spreading. 3. Target audience. 4. Recommend 2 platforms & content strategies. IMPORTANT: Respond ONLY with valid HTML wrapped in <div class="ai-section"> tags.`;
    }
}


// =========================================================================
// HANDLER CHÍNH
// =========================================================================

exports.handler = async (event, context) => {
    const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
    let language = 'en';
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
    if (event.httpMethod === "GET") return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: "AI service is online." }) };
    if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ success: false, message: "Method Not Allowed" }) };

    try {
        const body = JSON.parse(event.body);
        const { trend, analysisType } = body;
        language = body.language || 'en';

        if (!trend) {
            return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "Trend data is missing." }) };
        }

        const trendTitle = (language === 'vi' ? trend.title_vi : trend.title_en) || (language === 'vi' ? trend.title_en : trend.title_vi) || "N/A";
        const trendDescription = (language === 'vi' ? trend.description_vi : trend.description_en) || (language === 'vi' ? trend.description_en : trend.description_vi) || "N/A";

        if (trendTitle === "N/A") {
            const message = language === 'vi' ? "Dữ liệu xu hướng thiếu tiêu đề để phân tích." : "Trend data is missing a title for analysis.";
            return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: message }) };
        }
        
        if (analysisType === 'summary') {
            // Logic summary (giữ nguyên, không thay đổi)
             const successScore = trend.hotnessScore ? (Math.min(99, Math.max(20, trend.hotnessScore * 100))) : (Math.floor(Math.random() * 40) + 60);
            const sentiment = successScore > 75 ? (language === 'vi' ? "tích cực" : "positive") : "neutral";
            const growthPotential = successScore > 80 ? (language === 'vi' ? "tiềm năng tăng trưởng cao" : "high potential for growth") : (language === 'vi' ? "tăng trưởng vừa phải" : "moderate growth");
            const htmlSummary = language === 'vi' ? `<ul style="list-style-type: disc; padding-left: 20px; text-align: left;"><li><strong>Xu hướng:</strong> "${trendTitle}" (Lĩnh vực: ${trend.category}).</li><li><strong>Điểm liên quan:</strong> <strong>${successScore.toFixed(0)}%</strong> (tâm lý ${sentiment}).</li><li><strong>Triển vọng:</strong> Xu hướng này cho thấy ${growthPotential}.</li></ul>` : `<ul style="list-style-type: disc; padding-left: 20px; text-align: left;"><li><strong>Trend:</strong> "${trendTitle}" (Domain: ${trend.category}).</li><li><strong>Relevance Score:</strong> <strong>${successScore.toFixed(0)}%</strong> (${sentiment} sentiment).</li><li><strong>Outlook:</strong> This trend shows ${growthPotential}.</li></ul>`;
            const analysisResult = { successScore: parseFloat(successScore.toFixed(0)), summary: htmlSummary };
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: analysisResult }) };
        }
        
        else if (analysisType === 'detailed') {
            if (!geminiApiKey) {
                throw new Error("Gemini API key is not configured on the server.");
            }
            
            const cleanTrendForAI = { ...trend, title: trendTitle, description: trendDescription };
            const prompt = createDetailedAnalysisPrompt(cleanTrendForAI, language);
            
            // ================== ĐÂY LÀ DÒNG CODE ĐÚNG ==================
            // Gọi AI thông qua class quản lý mới, không dùng "model" nữa
            const detailedAnalysisContent = await geminiManager.generateContent(prompt);
            // ==========================================================
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: detailedAnalysisContent }) };
        }
        
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "Invalid analysisType specified." }) };

    } catch (error) {
        console.error("Error processing analyze-trend request:", error);
        const userFriendlyMessage = language === 'vi' 
            ? `Đã xảy ra lỗi khi tạo phân tích AI. Vui lòng thử lại sau. (Lỗi: ${error.message})`
            : `An error occurred while generating the AI analysis. Please try again later. (Error: ${error.message})`;
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: userFriendlyMessage }) };
    }
};
