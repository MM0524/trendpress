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
        return `
            Bạn là một chuyên gia phân tích xu hướng marketing. Phân tích tin tức sau đây.
            Thông tin: Tên="${trendTitle}", Mô tả="${trendDescription}", Lĩnh vực="${trend.category}".
            Yêu cầu:
            1. Tổng quan ngắn gọn về tin tức này.
            2. Tại sao nó lại nổi bật và các kênh lan truyền chính?
            3. Đối tượng khán giả phù hợp nhất với tin tức này là ai?
            4. Đề xuất 2 nền tảng mạng xã hội và chiến lược nội dung phù hợp để tận dụng.
            QUAN TRỌNG: Chỉ trả lời bằng HTML hợp lệ. Mỗi điểm trong 4 điểm trên phải được gói trong một thẻ <div class="ai-section">...</div> và có tiêu đề là thẻ <h4>.
        `;
    } else {
        return `
            You are a marketing trend analystYou are a marketing trend analyst. Analyze the following news item.
            Info: Name="${trendTitle}", Description="${trendDescription}", Category="${trend.category}".
            Requirements:
            1. A brief overview of this news.
            2. Why is it trending & what are the main spreading channels?
            3. Who is the most relevant target audience?
            4. Recommend 2 social media platforms and suitable content strategies to leverage it.
            IMPORTANT: Respond ONLY with valid HTML. Each of the four points must be wrapped in its own <div class="ai-section">...</div> tag with an <h4> title.
            `;
    }
}

function createPredictionPrompt(trend, language) {
    const trendTitle = (language === 'vi' ? trend.title_vi : trend.title_en) || trend.title_en || trend.title_vi;
    const trendDescription = (language === 'vi' ? trend.description_vi : trend.description_en) || trend.description_en || trend.description_vi;

    if (language === 'vi') {
        return `
            Bạn là một nhà phân tích chiến lược và dự báo tương lai. Phân tích tin tức sau đây:
            Tiêu đề: "${trendTitle}"
            Mô tả: "${trendDescription}"
            Lĩnh vực: "${trend.category}"

            Dựa trên thông tin trên, hãy đưa ra dự báo chi tiết về 3 điểm sau:
            1. **Tương lai của các lĩnh vực liên quan:** Dựa trên tin tức này, tương lai tiềm năng của các sản phẩm, công nghệ, hoặc hành vi xã hội liên quan sẽ như thế nào?
            2. **Hậu quả và Cơ hội:** Những hậu quả dài hạn (tích cực hoặc tiêu cực) và các cơ hội lớn để tăng trưởng hoặc đổi mới sáng tạo bắt nguồn từ sự kiện này là gì?
            3. **Tác động đến người dùng:** Người dùng hoặc người tiêu dùng thông thường có thể được hưởng lợi hoặc bị ảnh hưởng tiêu cực trực tiếp từ sự phát triển này trong tương lai gần như thế nào?

            QUAN TRỌNG: Chỉ trả lời bằng HTML hợp lệ. Mỗi điểm trong 3 điểm trên phải được gói trong một thẻ <div class="ai-section">...</div> và có tiêu đề là thẻ <h4>.
            `;
    } else {
        return `
            You are a strategic foresight analyst and futurist. Analyze the following news item:
            Title: "${trendTitle}"
            Description: "${trendDescription}"
            Category: "${trend.category}"

            Based on this information, provide a detailed forecast on the following three points:
            1. **The Future of Related Fields:** Based on this news, what are the potential futures for related products, technologies, or societal behaviors?
            2. **Consequences and Opportunities:** What are the likely long-term consequences (positive or negative) and key opportunities for growth or innovation stemming from this event?
            3. **Impact on Users/Consumers:** How might the average person, user, or consumer be directly benefited or negatively affected by this development in the near future?

            IMPORTANT: Respond ONLY with valid HTML. Each of the three points must be wrapped in its own <div class="ai-section">...</div> tag with an <h4> title.
            `;
    }
}

function createAggregatedAnalysisPrompt(trendData, language) {
    const searchTerm = trendData.title_en;
    // Lấy tối đa 10 tiêu đề để prompt không quá dài
    const articleTitles = trendData.contextArticles.slice(0, 10).map(a => `- "${a.title_en}"`).join('\n');
    const peakValue = trendData.peakEngagement;
    const totalValue = trendData.totalEngagement;

    if (language === 'vi') {
        return `
            Bạn là một nhà phân tích dữ liệu thị trường chuyên nghiệp. Chủ đề cần phân tích là "${searchTerm}".

            Dữ liệu có sẵn:
            - Mức độ quan tâm đỉnh điểm (Peak Engagement): ${peakValue}
            - Tổng mức độ quan tâm (Total Engagement): ${totalValue}
            - Một số tiêu đề bài báo liên quan gần đây:
            ${articleTitles}

            Dựa vào tất cả dữ liệu trên, hãy đưa ra một bản phân tích tổng hợp súc tích, trả lời 3 câu hỏi sau:
            1. **Giải thích Điểm số:** Tại sao chủ đề này lại đạt được mức độ quan tâm như vậy? Các sự kiện hoặc bài báo nào trong danh sách trên có thể là động lực chính thúc đẩy sự quan tâm này?
            2. **Phân tích Xu hướng Phát triển:** Dựa trên các tiêu đề bài báo, xu hướng của chủ đề này đang phát triển theo hướng nào (ví dụ: một sản phẩm mới, một sự kiện văn hóa, một vấn đề kinh tế)? Nó đang ở giai roạn nào (mới nổi, đỉnh điểm, hay suy thoái)?
            3. **Phân tích Đối tượng Quan tâm:** Dựa trên nội dung các tiêu đề, tệp khách hàng hoặc nhóm người nào đang quan tâm nhất đến chủ đề này? (Ví dụ: game thủ, nhà đầu tư, tín đồ thời trang, phụ huynh, v.v.)

            QUAN TRỌNG: Chỉ trả lời bằng HTML hợp lệ. Mỗi câu trả lời cho 3 điểm trên phải được gói trong một thẻ <div class="ai-section">...</div> với tiêu đề tương ứng nằm trong thẻ <h4>.
        `;
    } else {
        return `
            You are a professional market data analyst. The topic to analyze is "${searchTerm}".

            Available data:
            - Peak Engagement Score: ${peakValue}
            - Total Engagement Score: ${totalValue}
            - Sample of recent related article headlines:
            ${articleTitles}

            Based on all the data above, provide a concise, aggregated analysis answering the following three questions:
            1. **Score Explanation:** Why did this topic achieve this level of interest? Which events or articles from the list might be the main drivers behind this engagement?
            2. **Development Trend Analysis:** Based on the article headlines, in which direction is this topic's trend developing (e.g., a new product, a cultural event, an economic issue)? What stage is it in (emerging, peaking, or declining)?
            3. **Audience Analysis:** Based on the content of the headlines, what customer segment or group of people is most interested in this topic? (e.g., gamers, investors, fashion enthusiasts, parents, etc.)

            IMPORTANT: Respond ONLY with valid HTML. Each answer to the three points must be wrapped in its own <div class="ai-section">...</div> tag with a corresponding <h4> title.
        `;
    }
}

function createSuggestionPrompt(searchTerm, language) {
    if (language === 'vi') {
        return `
            Bạn là một chuyên gia phân tích thị trường. Tôi đang nghiên cứu xu hướng cho từ khóa: "${searchTerm}".
            Hãy đề xuất 5 thuật ngữ so sánh có liên quan và sâu sắc. Bao gồm:
            - 1-2 đối thủ cạnh tranh trực tiếp.
            - 1-2 sản phẩm hoặc xu hướng con cụ thể trong lĩnh vực đó.
            - 1 xu hướng vĩ mô hoặc ngành công nghiệp có liên quan.

            QUAN TRỌNG: Chỉ trả về một mảng JSON chứa 5 chuỗi. Ví dụ: ["Đối thủ A", "Sản phẩm B", "Xu hướng C", "Đối thủ D", "Ngành E"]
        `;
    } else {
        return `
            You are an expert market analyst. I am researching the trend for the keyword: "${searchTerm}".
            Please suggest 5 insightful comparison terms. Include:
            - 1-2 direct competitors.
            - 1-2 specific products or sub-trends within that field.
            - 1 related macro-trend or industry.

            IMPORTANT: Respond ONLY with a single JSON array of 5 strings. Example: ["Competitor A", "Product B", "Trend C", "Competitor D", "Industry E"]
        `;
    }
}

function createMyTrendUpdatePrompt(trend, changePercent, language) {
    const trendTitle = (language === 'vi' ? trend.title_vi : trend.title_en) || trend.title_en || trend.title_vi;
    const changeText = changePercent > 0 ? `tăng ${changePercent.toFixed(1)}%` : `giảm ${Math.abs(changePercent).toFixed(1)}%`;
    const changeTextEn = changePercent > 0 ? `increased by ${changePercent.toFixed(1)}%` : `decreased by ${Math.abs(changePercent).toFixed(1)}%`;

    if (language === 'vi') {
        return `
            Bạn là một trợ lý phân tích xu hướng cá nhân. Một xu hướng mà người dùng đang theo dõi, "${trendTitle}", vừa có sự thay đổi về mức độ tương tác khoảng ${changeText}.
            Dựa vào thông tin này, hãy đưa ra một bản phân tích ngắn gọn:
            1. **Phân tích thay đổi:** Lý do khả dĩ cho sự thay đổi này là gì?
            2. **Dự báo ngắn hạn:** Xu hướng này có thể diễn biến thế nào trong vài ngày tới?
            3. **Gợi ý hành động:** Người dùng nên chú ý điều gì hoặc có thể làm gì lúc này?
            QUAN TRỌNG: Chỉ trả lời bằng HTML hợp lệ. Mỗi điểm phải được gói trong thẻ <div class="ai-section">...</div> với tiêu đề là <h4>.
        `;
    } else {
        return `
            You are a personal trend analysis assistant. A trend the user is following, "${trendTitle}", has just seen its engagement change by approximately ${changeTextEn}.
            Based on this, provide a brief analysis:
            1. **Change Analysis:** What are the likely reasons for this change?
            2. **Short-term Forecast:** How might this trend evolve over the next few days?
            3. **Actionable Insight:** What should the user pay attention to or do now?
            IMPORTANT: Respond ONLY with valid HTML. Each point must be wrapped in its own <div class="ai-section">...</div> tag with an <h4> title.
        `;
    }
}

// --- HANDLER CHÍNH ---
// --- HANDLER CHÍNH ĐÃ ĐƯỢC NÂNG CẤP ---
exports.handler = async (event) => {
    const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
    
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
    if (event.httpMethod === "GET") return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: "AI service is online." }) };
    if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ success: false, message: "Method Not Allowed" }) };

    try {
        const body = JSON.parse(event.body);
        const { trend, analysisType, language = 'en', searchTerm, changePercent } = body;

        // **** BẮT ĐẦU THAY ĐỔI ****

        // 1. Xử lý yêu cầu gợi ý TRƯỚC TIÊN, vì nó không cần `trend` object
        if (analysisType === 'suggest_comparisons') {
            if (!searchTerm) {
                return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "searchTerm is required for suggestions." }) };
            }
            if (!geminiApiKey) throw new Error("Gemini API key is not configured.");
            
            const prompt = createSuggestionPrompt(searchTerm, language);
            const suggestionJsonString = await geminiManager.generateContent(prompt);
            
            // Dọn dẹp các ký tự ```json mà AI có thể trả về
            const cleanedJson = suggestionJsonString.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
            
            try {
                // Parse chuỗi JSON thành một mảng JavaScript thực sự
                const suggestions = JSON.parse(cleanedJson);
                return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: suggestions }) };
            } catch(e) {
                console.error("Failed to parse AI suggestion JSON:", cleanedJson);
                throw new Error("AI returned invalid JSON format for suggestions.");
            }
        }

        // 2. Di chuyển khối kiểm tra `trend` xuống đây.
        // Các loại phân tích còn lại đều yêu cầu `trend` object.
        if (!trend) {
            return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "News data is missing for this analysis type." }) };
        }

        // **** KẾT THÚC THAY ĐỔI ****
        
        // Các khối `else if` còn lại giữ nguyên
        if (analysisType === 'aggregated') {
            if (!geminiApiKey) throw new Error("Gemini API key is not configured.");
            const prompt = createAggregatedAnalysisPrompt(trend, language);
            const aggregatedContent = await geminiManager.generateContent(prompt);
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: aggregatedContent }) };
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

        else if (analysisType === 'my_trend_update') {
            if (!trend) return { statusCode: 400, body: JSON.stringify({ success: false, message: "Trend data is missing." }) };
            if (!geminiApiKey) throw new Error("Gemini API key is not configured.");
            
            const prompt = createMyTrendUpdatePrompt(trend, changePercent, language);
            const updateContent = await geminiManager.generateContent(prompt);
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: updateContent }) };
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
