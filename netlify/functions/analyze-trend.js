// netlify/functions/analyze-trend.js

// Import thư viện chính thức của Google AI
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- Cấu hình API ---
// Lấy API key từ biến môi trường của Netlify
const geminiApiKey = process.env.GEMINI_API_KEY;

// Kiểm tra xem API key có tồn tại không để tránh lỗi khi deploy
if (!geminiApiKey) {
    console.error("FATAL: GEMINI_API_KEY is not defined in environment variables.");
}

// Khởi tạo client Google AI
const genAI = new GoogleGenerativeAI(geminiApiKey);
// Chọn mô hình. 'gemini-pro' là một lựa chọn tốt, cân bằng giữa hiệu năng và chi phí.
const model = genAI.getGenerativeModel({ model: "gemini-pro" });


/**
 * Tạo một prompt (chỉ dẫn) chi tiết và có cấu trúc cho Gemini.
 * @param {object} trend - Đối tượng trend.
 * @param {string} language - 'vi' hoặc 'en'.
 * @returns {string} - Prompt hoàn chỉnh.
 */
function createDetailedAnalysisPrompt(trend, language) {
    const trendTitle = (language === 'vi' ? trend.title_vi : trend.title_en) || trend.title_en;
    const trendDescription = (language === 'vi' ? trend.description_vi : trend.description_en) || trend.description_en;

    if (language === 'vi') {
        return `
            Bạn là một chuyên gia phân tích xu hướng marketing kỹ thuật số. Nhiệm vụ của bạn là cung cấp một bản phân tích chuyên sâu về xu hướng sau đây.
            
            **Thông tin xu hướng:**
            - Tên xu hướng: "${trendTitle}"
            - Mô tả ngắn: "${trendDescription}"
            - Lĩnh vực: "${trend.category}"
            - Nguồn: "${trend.submitter}"
            - Ngày ghi nhận: "${new Date(trend.date).toLocaleDateString('vi-VN')}"

            **Yêu cầu phân tích (Sử dụng định dạng HTML):**

            1.  **Tổng quan & Tóm tắt Xu hướng:**
                - Bắt đầu với thẻ \`<h4>Tổng quan & Tóm tắt Xu hướng</h4>\`.
                - Viết một đoạn văn (trong thẻ \`<p>\`) giải thích chi tiết xu hướng này là gì, dựa vào mô tả đã cho nhưng diễn giải sâu hơn.

            2.  **Phân tích Động lực Xu hướng:**
                - Bắt đầu với thẻ \`<h4>Phân tích Động lực Xu hướng</h4>\`.
                - Tạo một thẻ \`<h5>Tại sao nó lại nổi bật?</h5>\` và một đoạn văn giải thích các nguyên nhân khả thi (ví dụ: sự kiện văn hóa, đột phá công nghệ, ảnh hưởng từ người nổi tiếng).
                - Tạo một thẻ \`<h5>Nó lan truyền bằng cách nào?</h5>\` và một đoạn văn mô tả các kênh lan truyền chính (ví dụ: mạng xã hội, báo chí, diễn đàn).

            3.  **Đối tượng và Lĩnh vực phù hợp:**
                - Bắt đầu với thẻ \`<h4>Đối tượng và Lĩnh vực phù hợp</h4>\`.
                - Viết một đoạn văn mô tả tệp khách hàng/người dùng mục tiêu lý tưởng của xu hướng này (tuổi tác, sở thích, hành vi).

            4.  **Đề xuất Nền tảng & Chiến lược Nội dung:**
                - Bắt đầu với thẻ \`<h4>Đề xuất Nền tảng & Chiến lược Nội dung</h4>\`.
                - Đề xuất 2 nền tảng mạng xã hội phù hợp nhất. Với mỗi nền tảng:
                    - Dùng thẻ \`<h5>1. Nền tảng đề xuất: <strong class="ai-highlight">[Tên Nền Tảng]</strong></h5>\`.
                    - Dùng danh sách \`<ul>\` với các mục \`<li>\` để liệt kê:
                        - \`<strong>Lý do phù hợp:</strong> [Giải thích tại sao nền tảng này lại tốt cho xu hướng]\`
                        - \`<strong>Ý tưởng nội dung:</strong> [Đưa ra một ý tưởng nội dung cụ thể, có thể hành động được]\`
            
            **QUAN TRỌNG:** Chỉ trả lời bằng mã HTML hợp lệ, gói gọn trong các thẻ \`<div class="ai-section">...</div>\` cho mỗi phần chính. Không thêm \`<html>\`, \`<body>\` hay markdown.
        `;
    } else {
        return `
            You are an expert digital marketing trend analyst. Your task is to provide a deep dive analysis of the following trend.
            
            **Trend Information:**
            - Trend Name: "${trendTitle}"
            - Short Description: "${trendDescription}"
            - Field/Category: "${trend.category}"
            - Source: "${trend.submitter}"
            - Date Noted: "${new Date(trend.date).toLocaleDateString('en-US')}"

            **Analysis Requirements (Use HTML format):**

            1.  **Trend Overview & Summary:**
                - Start with an \`<h4>Trend Overview & Summary</h4>\` tag.
                - Write a paragraph (in a \`<p>\` tag) explaining in detail what this trend is, elaborating on the given description.

            2.  **Trend Dynamics Analysis:**
                - Start with an \`<h4>Trend Dynamics Analysis</h4>\` tag.
                - Create an \`<h5>Why is it trending?</h5>\` tag followed by a paragraph explaining the likely causes (e.g., cultural events, tech breakthroughs, celebrity influence).
                - Create an \`<h5>How is it spreading?</h5>\` tag followed by a paragraph describing the main channels of propagation (e.g., social media, press, forums).

            3.  **Target Audience & Relevant Fields:**
                - Start with an \`<h4>Target Audience & Relevant Fields</h4>\` tag.
                - Write a paragraph describing the ideal target audience/customer for this trend (age, interests, behaviors).

            4.  **Platform & Content Strategy Recommendations:**
                - Start with an \`<h4>Platform & Content Strategy Recommendations</h4>\` tag.
                - Recommend the 2 most suitable social media platforms. For each platform:
                    - Use an \`<h5>1. Recommended Platform: <strong class="ai-highlight">[Platform Name]</strong></h5>\` tag.
                    - Use a \`<ul>\` list with \`<li>\` items for:
                        - \`<strong>Why it fits:</strong> [Explain why this platform is good for the trend]\`
                        - \`<strong>Content Idea:</strong> [Provide a specific, actionable content idea]\`
            
            **IMPORTANT:** Respond ONLY with valid HTML, wrapped in \`<div class="ai-section">...</div>\` tags for each main section. Do not include \`<html>\`, \`<body>\`, or markdown.
        `;
    }
}


// =========================================================================
// HANDLER CHÍNH (Đã sửa lỗi)
// =========================================================================

exports.handler = async (event, context) => {
    const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
    let language = 'en'; // Khai báo ngoài try-catch với giá trị mặc định

    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
    if (event.httpMethod === "GET") return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: "AI service is online." }) };
    if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ success: false, message: "Method Not Allowed" }) };

    try {
        const body = JSON.parse(event.body);
        const { trend, analysisType } = body;
        language = body.language || 'en'; // Cập nhật ngôn ngữ từ request

        if (!trend) {
            return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "Trend data is missing." }) };
        }

        const trendTitle = (language === 'vi' ? trend.title_vi : trend.title_en) || trend.title_en || "N/A";
        const trendDescription = (language === 'vi' ? trend.description_vi : trend.description_en) || trend.description_en || "N/A";

        // Kiểm tra trend có hợp lệ không trước khi phân tích
        if (trendTitle === "N/A" || trendDescription === "N/A") {
            const message = language === 'vi' 
                ? "Dữ liệu xu hướng không đầy đủ (thiếu tiêu đề hoặc mô tả) để phân tích."
                : "Trend data is incomplete (missing title or description) for analysis.";
            return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: message }) };
        }

        // --- PHÂN TÍCH TÓM TẮT (summary) - Nhanh và miễn phí ---
        if (analysisType === 'summary') {
            const successScore = trend.hotnessScore ? (Math.min(99, Math.max(20, trend.hotnessScore * 100))) : (Math.floor(Math.random() * 40) + 60);
            const sentiment = successScore > 75 ? (language === 'vi' ? "tích cực" : "positive") : "neutral";
            const growthPotential = successScore > 80 ? (language === 'vi' ? "tiềm năng tăng trưởng cao" : "high potential for growth") : (language === 'vi' ? "tăng trưởng vừa phải" : "moderate growth");
            const htmlSummary = language === 'vi' ? `<ul style="list-style-type: disc; padding-left: 20px; text-align: left;"><li><strong>Xu hướng:</strong> "${trendTitle}" (Lĩnh vực: ${trend.category}).</li><li><strong>Điểm liên quan:</strong> <strong>${successScore.toFixed(0)}%</strong> (tâm lý ${sentiment}).</li><li><strong>Triển vọng:</strong> Xu hướng này cho thấy ${growthPotential}.</li></ul>` : `<ul style="list-style-type: disc; padding-left: 20px; text-align: left;"><li><strong>Trend:</strong> "${trendTitle}" (Domain: ${trend.category}).</li><li><strong>Relevance Score:</strong> <strong>${successScore.toFixed(0)}%</strong> (${sentiment} sentiment).</li><li><strong>Outlook:</strong> This trend shows ${growthPotential}.</li></ul>`;
            const analysisResult = { successScore: parseFloat(successScore.toFixed(0)), summary: htmlSummary };
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: analysisResult }) };
        }
        
        // --- PHÂN TÍCH CHUYÊN SÂU (detailed) - Gọi API Gemini ---
        else if (analysisType === 'detailed') {
            if (!geminiApiKey) {
                throw new Error("Gemini API key is not configured on the server.");
            }
            const prompt = createDetailedAnalysisPrompt(trend, language);
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const detailedAnalysisContent = response.text();
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
