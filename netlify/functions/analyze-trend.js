// File: netlify/functions/analyze-trend.js
const fetch = require('node-fetch');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

// --- CẬP NHẬT: Tạo prompt đa ngôn ngữ ---

// Prompt để lấy JSON tóm tắt
const createStructuredSummaryPrompt = (trend, lang = 'en') => {
    const languageInstruction = lang === 'vi' 
        ? "Respond ONLY with a valid JSON object. The 'summary' field MUST be in VIETNAMESE."
        : "Respond ONLY with a valid JSON object. The 'summary' field MUST be in ENGLISH.";

    return `Analyze the trend: "${trend.title}". 
    ${languageInstruction}
    The JSON object must have this structure:
    {
      "successScore": <a number between 0-100 for the trend's potential>,
      "summary": "<a one-paragraph summary in the requested language>",
      "historicalData": [<array of 4 numbers for interest over the last 4 months>],
      "futureProjection": [<array of 1 number for a forecast for the next 7 days>]
    }`;
};

// Prompt để lấy phân tích chi tiết
const createDetailedAnalysisPrompt = (trend, lang = 'en') => {
    const languageInstruction = lang === 'vi'
        ? "Provide a detailed professional analysis in VIETNAMESE."
        : "Provide a detailed professional analysis in ENGLISH.";

    const sections = lang === 'vi'
        ? {
            analysis: "Phân tích Xu hướng",
            suggestions: "Gợi ý Nội dung Viral",
            caseStudies: "Ví dụ Thực tế",
            pitfalls: '"Cạm bẫy" & Giải pháp',
            audience: "Đối tượng Mục tiêu Chính",
            platforms: "Nền tảng Phù hợp nhất"
          }
        : {
            analysis: "Analysis of Trend",
            suggestions: "Actionable Suggestions for Viral Content",
            caseStudies: "Real-World Case Studies",
            pitfalls: '"Horror Stories" & Solutions',
            audience: "Primary Target Audience",
            platforms: "Most Suitable Platforms"
          };

    return `Analyze the trend: "${trend.title}" (Category: ${trend.category}).
    Description: "${trend.description}".
    ${languageInstruction}
    Structure your response using markdown with these EXACT sections:
    ### ${sections.analysis} "${trend.title}"
    <A paragraph explaining the core concept.>
    ### ${sections.suggestions}
    * **${sections.caseStudies}:** <suggestion>
    * **${sections.pitfalls}:** <suggestion>
    ### ${sections.audience}
    * <Audience 1>
    * <Audience 2>
    ### ${sections.platforms}
    * **Platform 1 (e.g., YouTube):** <reason>
    * **Platform 2 (e.g., LinkedIn):** <reason>`;
};


exports.handler = async (event) => {
    const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 204, headers: { "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", ...headers }};
    }
    if (event.httpMethod === 'GET') { return { statusCode: 200, body: JSON.stringify({ status: 'ok' }) }; }
    if (event.httpMethod !== 'POST') { return { statusCode: 405, body: 'Method Not Allowed' }; }

    try {
        if (!event.body) { return { statusCode: 400, body: 'Bad Request: Missing request body.' }; }
        
        // Nhận thêm 'language' từ client
        const { trend, analysisType, language } = JSON.parse(event.body);

        if (!trend) { return { statusCode: 400, body: 'Bad Request: Missing trend data.' }; }

        const isSummary = analysisType === 'summary';
        const prompt = isSummary ? createStructuredSummaryPrompt(trend, language) : createDetailedAnalysisPrompt(trend, language);
        
        const generationConfig = { temperature: 0.7, maxOutputTokens: 2048 };
        if (isSummary) { generationConfig.responseMimeType = "application/json"; }

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error('Gemini API Error:', errorBody);
            return { statusCode: response.status, body: `Gemini API Error: ${errorBody}` };
        }

        const data = await response.json();
        const textContent = data.candidates[0].content.parts[0].text;

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, data: textContent }),
        };
    } catch (error) {
        console.error('Serverless function error:', error);
        return { statusCode: 500, body: JSON.stringify({ success: false, message: 'Internal Server Error' }) };
    }
};
