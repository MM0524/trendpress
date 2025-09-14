// netlify/functions/analyze-trend.js

// --- Class Quản lý API Gemini (Đã nâng cấp) ---
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
                        "contents": [{ "parts": [{ "text": prompt }] }],
                        "generationConfig": {
                            "temperature": 0.6,
                            "topK": 1,
                            "topP": 1,
                            "maxOutputTokens": 4096,
                        },
                        // Thêm cài đặt an toàn để giảm bị chặn
                        "safetySettings": [
                            { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE" },
                            { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_MEDIUM_AND_ABOVE" },
                            { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_MEDIUM_AND_ABOVE" },
                            { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE" }
                        ]
                    }),
                });

                if (!response.ok) {
                    const errorBody = await response.json();
                    console.error("Gemini API Error Response:", JSON.stringify(errorBody, null, 2));
                    throw new Error(`API call failed with status ${response.status}: ${errorBody.error?.message || JSON.stringify(errorBody)}`);
                }

                const data = await response.json();
                
                if (data.candidates && data.candidates[0].finishReason === 'SAFETY') {
                    throw new Error("Content generation blocked due to safety settings.");
                }

                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

                if (!text) {
                     console.error("Gemini API No Text Response:", JSON.stringify(data, null, 2));
                    throw new Error("No content generated in API response.");
                }
                return text;

            } catch (error) {
                console.error(`Gemini API call attempt ${attempt} failed: ${error.message}`);
                if (attempt === this.maxRetries) {
                    throw new Error(`Gemini API call failed after ${this.maxRetries} attempts. Final error: ${error.message}`);
                }
                await new Promise(res => setTimeout(res, this.retryDelay));
            }
        }
    }
}

// --- Cấu hình API ---
const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiManager = new GeminiAPIManager(geminiApiKey);

// --- Các hàm tạo Prompt ---

function createDetailedAnalysisPrompt(trend, language) {
    const trendTitle = (language === 'vi' ? trend.title_vi : trend.title_en) || trend.title_en || trend.title_vi;
    const trendDescription = (language === 'vi' ? trend.description_vi : trend.description_en) || trend.description_en || trend.description_vi;

    if (language === 'vi') {
        return `Bạn là một chuyên gia phân tích xu hướng marketing... (prompt chi tiết của bạn)`;
    } else {
        return `You are a marketing trend analyst... (your detailed prompt)`;
    }
}

function createPredictionPrompt(trend, language) {
    const trendTitle = (language === 'vi' ? trend.title_vi : trend.title_en) || trend.title_en || trend.title_vi;
    const trendDescription = (language === 'vi' ? trend.description_vi : trend.description_en) || trend.description_en || trend.description_vi;

    if (language === 'vi') {
        return `Bạn là một nhà phân tích chiến lược và dự báo tương lai... (prompt dự đoán chi tiết của bạn)`;
    } else {
        return `You are a strategic foresight analyst and futurist... (your detailed prediction prompt)`;
    }
}


// --- HANDLER CHÍNH ---
exports.handler = async (event) => {
    const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
    
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
    if (event.httpMethod === "GET") return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: "AI service is online." }) };
    if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ success: false, message: "Method Not Allowed" }) };

    try {
        const body = JSON.parse(event.body);
        const { trend, analysisType, language = 'en' } = body;

        if (!trend) {
            return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "News data is missing." }) };
        }

        if (analysisType === 'summary') {
            const successScore = trend.hotnessScore ? (Math.min(99, Math.max(20, trend.hotnessScore * 100))) : (Math.floor(Math.random() * 40) + 60);
            const sentiment = successScore > 75 ? (language === 'vi' ? "tích cực" : "positive") : "neutral";
            const growthPotential = successScore > 80 ? (language === 'vi' ? "tiềm năng tăng trưởng cao" : "high potential for growth") : (language === 'vi' ? "tăng trưởng vừa phải" : "moderate growth");
            const trendTitle = (language === 'vi' ? trend.title_vi : trend.title_en) || trend.title_en || trend.title_vi || "N/A";
            const htmlSummary = language === 'vi' 
                ? `<ul style="list-style-type: disc; padding-left: 20px; text-align: left;"><li><strong>Tin tức:</strong> "${trendTitle}" (Lĩnh vực: ${trend.category}).</li><li><strong>Điểm liên quan:</strong> <strong>${successScore.toFixed(0)}%</strong> (tâm lý ${sentiment}).</li><li><strong>Triển vọng:</strong> Tin tức này cho thấy ${growthPotential}.</li></ul>` 
                : `<ul style="list-style-type: disc; padding-left: 20px; text-align: left;"><li><strong>News:</strong> "${trendTitle}" (Domain: ${trend.category}).</li><li><strong>Relevance Score:</strong> <strong>${successScore.toFixed(0)}%</strong> (${sentiment} sentiment).</li><li><strong>Outlook:</strong> This news shows ${growthPotential}.</li></ul>`;
            
            const analysisResult = { successScore: parseFloat(successScore.toFixed(0)), summary: htmlSummary };
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: analysisResult }) };
        }
        
        else if (analysisType === 'prediction') {
            if (!geminiApiKey) throw new Error("Gemini API key is not configured.");
            const prompt = createPredictionPrompt(trend, language);
            const predictionContent = await geminiManager.generateContent(prompt);
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: predictionContent }) };
        }
        
        else if (analysisType === 'detailed') {
            if (!geminiApiKey) throw new Error("Gemini API key is not configured.");
            const prompt = createDetailedAnalysisPrompt(trend, language);
            const detailedAnalysisContent = await geminiManager.generateContent(prompt);
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: detailedAnalysisContent }) };
        }

        return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "Invalid analysisType specified." }) };

    } catch (error) {
        console.error("Error processing analyze-trend request:", error);
        const language = event.body ? (JSON.parse(event.body).language || 'en') : 'en';
        const userFriendlyMessage = language === 'vi' 
            ? `Đã xảy ra lỗi khi tạo phân tích AI. Vui lòng thử lại sau. (Lỗi: ${error.message})`
            : `An error occurred while generating the AI analysis. Please try again later. (Error: ${error.message})`;
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ success: false, message: userFriendlyMessage }) 
        };
    }
};
